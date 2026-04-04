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

// ── GET /embedding-migration/status ─────────────────────

router.get('/embedding-migration/status', async (req, res) => {
  try {
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

    res.json({ ok: true, data });
  } catch (err) {
    logger.error('Embedding migration status error:', err);
    sendError(res, 500, 'Failed to check migration status', err.message);
  }
});

// ── POST /embedding-migration/reindex ───────────────────

router.post('/embedding-migration/reindex', async (req, res) => {
  try {
    const { confirm } = req.body || {};
    if (confirm !== true) {
      return sendError(res, 400, 'CONFIRMATION_REQUIRED', 'Send { "confirm": true } to start reindex');
    }

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
