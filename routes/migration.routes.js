/**
 * Embedding Migration Routes
 *
 * GET    /embedding-migration/status          — Check dimension mismatch between current model and stored vectors
 * POST   /embedding-migration/reindex         — Re-embed all documents with the current model (async, 202 + jobId)
 * GET    /embedding-migration/reindex/:jobId  — Poll reindex job progress
 */

const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { getRagStore } = require('../src/services/ragStore');
const { getEmbeddingsService } = require('../src/services/embeddings');
const { sendError } = require('../src/utils/response');

// In-memory job store — acceptable for v1. PM2 restart loses running job state.
// A future version could persist to MongoDB if durability is needed.
const jobs = new Map();
const MAX_ERRORS = 100;

/**
 * Compute the current embedding migration status.
 *
 * Shared helper consumed by:
 *   - GET  /embedding-migration/status  — exposes the shape to clients
 *   - POST /embedding-migration/reindex — guards against no-op reindexes
 *
 * Both endpoints MUST derive `migrationNeeded` from the same source so the
 * UI signal and the backend guard can never disagree.
 *
 * @returns {Promise<{
 *   currentModel: string,
 *   currentDimension: number,
 *   storedDimension: number,
 *   dimensionMatch: boolean,
 *   documentCount: number,
 *   chunkCount: number,
 *   migrationNeeded: boolean,
 *   note?: string
 * }>}
 */
async function computeMigrationStatus() {
  const ragStore = getRagStore();
  const embeddingsService = getEmbeddingsService();

  const stats = await ragStore.getStats();
  const currentDimension = embeddingsService.getDimension();
  const currentModel = embeddingsService.model;
  const storedDimension = stats.vectorDimension || 0;
  const documentCount = stats.documentCount || 0;
  const chunkCount = stats.chunkCount || 0;

  const dimensionMatch = storedDimension === 0 || currentDimension === storedDimension;
  // Migration needed: dimensions differ AND there are documents to migrate
  const migrationNeeded = !dimensionMatch && documentCount > 0;

  const data = {
    currentModel,
    currentDimension,
    storedDimension,
    dimensionMatch,
    documentCount,
    chunkCount,
    migrationNeeded,
  };

  // Warn about dimension change requiring collection recreation
  if (migrationNeeded) {
    data.note = 'Dimension change requires collection recreation. Back up data before proceeding.';
  }

  return data;
}

// ── GET /embedding-migration/status ─────────────────────

router.get('/embedding-migration/status', async (req, res) => {
  try {
    const data = await computeMigrationStatus();
    res.json({ ok: true, data });
  } catch (err) {
    logger.error('Embedding migration status error:', err);
    sendError(res, 500, 'Failed to check migration status', err.message);
  }
});

// ── POST /embedding-migration/reindex ───────────────────

router.post('/embedding-migration/reindex', async (req, res) => {
  try {
    const { confirm, force, acceptContentDrift } = req.body || {};
    if (confirm !== true) {
      return sendError(res, 400, 'CONFIRMATION_REQUIRED', 'Send { "confirm": true } to start reindex');
    }

    // Guard: refuse no-op reindex when dimensions already match.
    // The reindex walks the entire corpus and re-embeds every chunk — burning
    // GPU time for zero benefit. Combined with the deferred overlap-duplication
    // bug, repeated no-op reindexes actively corrupt the corpus. Callers who
    // still want to force a reindex (e.g. to recover from a different corruption)
    // may pass { force: true }.
    const status = await computeMigrationStatus();
    if (status.migrationNeeded === false && force !== true) {
      return sendError(
        res,
        400,
        'MIGRATION_NOT_NEEDED',
        'Stored and current embedding dimensions match; no reindex required. Send { force: true } to override.'
      );
    }

    // Holding-pattern gate (0164 — Architect B §6 stopgap).
    // Reindex currently reconstructs text by concatenating overlapping chunks,
    // which inflates overlap regions on every run (bug: rag#reindex-overlap-content-duplication).
    // Until Architect B T1–T6 replaces chunk-concat with real originalText retrieval,
    // any reindex — including force-overrides — must explicitly acknowledge the drift.
    // This gate is removed in T6 once originalText backfill is complete.
    //
    // NOTE: we hand-build this 400 instead of going through sendError() so the
    // diagnostic `message` field is preserved in production (sendError hides
    // `detail` when NODE_ENV=production). The operator-facing prose — including
    // the bug handle `rag#reindex-overlap-content-duplication` — must be
    // visible in live responses so a forced reindex is truly informed consent.
    if (acceptContentDrift !== true) {
      return res.status(400).json({
        ok: false,
        error: 'CONTENT_DRIFT_NOT_ACCEPTED',
        message: 'Reindex currently reconstructs text from overlapping chunks, which inflates overlap regions on every run. This is a known issue tracked as rag#reindex-overlap-content-duplication. Set acceptContentDrift: true to proceed anyway, e.g. for a one-time dimension migration where retrieval quality can be re-verified afterward.',
      });
    }

    logger.warn('[reindex] proceeding with acceptContentDrift=true — known content-drift bug (rag#reindex-overlap-content-duplication)', {
      migrationNeeded: status.migrationNeeded,
      force: force === true,
      currentModel: status.currentModel,
      currentDimension: status.currentDimension,
      storedDimension: status.storedDimension,
      documentCount: status.documentCount,
      chunkCount: status.chunkCount,
    });

    // Check if a reindex job is already running
    for (const [, job] of jobs) {
      if (job.status === 'running') {
        return res.status(409).json({ ok: false, error: 'REINDEX_ALREADY_RUNNING', data: { activeJobId: job.jobId } });
      }
    }

    const jobId = `reindex-${Date.now()}`;
    const job = {
      jobId,
      status: 'running',
      startedAt: new Date(),
      completedAt: null,
      progress: { total: 0, processed: 0, succeeded: 0, failed: 0, errors: [] },
      currentDocument: null,
    };
    jobs.set(jobId, job);

    // Fire-and-forget: run reindex in background
    _runReindex(job).catch((err) => {
      logger.error('Reindex unhandled error:', err);
      job.status = 'failed';
      job.completedAt = new Date();
      if (job.progress.errors.length < MAX_ERRORS) {
        job.progress.errors.push({ documentId: null, error: err.message });
      }
    });

    res.status(202).json({ ok: true, data: { jobId, status: 'running' } });
  } catch (err) {
    logger.error('Embedding migration reindex error:', err);
    sendError(res, 500, 'Failed to start reindex', err.message);
  }
});

// ── GET /embedding-migration/reindex/:jobId ─────────────

router.get('/embedding-migration/reindex/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ ok: false, error: 'Job not found' });
  }

  res.json({
    ok: true,
    data: {
      jobId: job.jobId,
      status: job.status,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      progress: job.progress,
      currentDocument: job.currentDocument,
    },
  });
});

// ── Background reindex worker ───────────────────────────

async function _runReindex(job) {
  const ragStore = getRagStore();
  const vectorStore = ragStore.vectorStore;

  const { documents } = await ragStore.listDocuments();

  if (documents.length === 0) {
    job.status = 'completed';
    job.completedAt = new Date();
    return;
  }

  job.progress.total = documents.length;

  for (const doc of documents) {
    const docId = doc.documentId;
    job.currentDocument = docId;

    try {
      // Retrieve chunks from vector store to reconstruct full text
      const chunks = await vectorStore.getDocumentChunks(docId);
      const fullText = chunks.map((c) => c.text).join('');

      // Retrieve document metadata
      const metadata = await vectorStore.getDocument(docId);

      // Re-embed and upsert with current model
      await ragStore.upsertDocumentWithChunks(fullText, {
        documentId: docId,
        source: metadata?.source || 'unknown',
        tags: metadata?.tags || [],
      });

      job.progress.succeeded++;
    } catch (err) {
      job.progress.failed++;
      if (job.progress.errors.length < MAX_ERRORS) {
        job.progress.errors.push({ documentId: docId, error: err.message });
      }
      logger.warn(`Reindex failed for document "${docId}":`, err.message);
    }

    job.progress.processed++;
  }

  job.status = 'completed';
  job.completedAt = new Date();
  job.currentDocument = null;
}

// Expose for testing
router._jobs = jobs;
router._runReindex = _runReindex;

module.exports = router;
