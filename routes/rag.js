/**
 * RAG API Routes
 *
 * POST   /ingest          — Ingest a document (text + metadata)
 * POST   /documents       — Alias for /ingest
 * POST   /ingest-scan     — Trigger NAS file scan + ingestion
 * POST   /search          — Search similar chunks
 * GET    /documents       — List ingested documents
 * DELETE /documents/:id   — Delete a document by ID
 * GET    /status          — RAG service status + stats
 */

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const logger = require('../config/logger');
const { getRagStore } = require('../src/services/ragStore');
const { runIngestScan, getConfiguredRoots, isPathUnderRoot } = require('../src/services/ingestWorker');

// ── Helpers ──────────────────────────────────────────────

function classifyRagAvailabilityError(err) {
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('econnrefused') || msg.includes('fetch failed')) {
    return { status: 503, code: 'VECTOR_STORE_UNAVAILABLE', detail: 'Vector store is not reachable' };
  }
  if (msg.includes('embedding') || msg.includes('core proxy') || msg.includes('502') || msg.includes('503')) {
    return { status: 503, code: 'EMBEDDING_SERVICE_UNAVAILABLE', detail: 'Embedding service (core proxy) is not reachable' };
  }
  return null;
}

// ── POST /ingest (alias: POST /documents) ────────────────

async function handleIngest(req, res) {
  try {
    const { text, source, tags, chunkSize, chunkOverlap, documentId } = req.body;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'text is required and must be a non-empty string' });
    }
    if (source && typeof source !== 'string') {
      return res.status(400).json({ ok: false, error: 'source must be a string' });
    }
    if (tags && !Array.isArray(tags)) {
      return res.status(400).json({ ok: false, error: 'tags must be an array' });
    }

    const ragStore = getRagStore();
    const result = await ragStore.upsertDocumentWithChunks(text, {
      source: source || 'api',
      tags: tags || [],
      chunkSize,
      chunkOverlap,
      documentId
    });

    res.json({ ok: true, data: result });
  } catch (err) {
    const classified = classifyRagAvailabilityError(err);
    if (classified) {
      logger.warn(`Ingest blocked: ${classified.code} — ${err.message}`);
      return res.status(classified.status).json({ ok: false, error: classified.code, detail: classified.detail });
    }
    logger.error('Ingest error:', err);
    res.status(500).json({ ok: false, error: 'Ingest failed', detail: err.message });
  }
}

router.post('/ingest', handleIngest);
router.post('/documents', handleIngest);

// ── POST /ingest-scan ───────────────────────────────────

router.post('/ingest-scan', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        ok: false,
        error: 'MONGODB_UNAVAILABLE',
        detail: 'MongoDB must be connected before running ingest scan'
      });
    }

    const { limit, roots } = req.body || {};
    const allowedRoots = getConfiguredRoots();

    if (Array.isArray(roots)) {
      const invalid = roots.filter((r) => !allowedRoots.some((allowed) => isPathUnderRoot(r, allowed)));
      if (invalid.length) {
        return res.status(400).json({
          ok: false,
          error: 'INVALID_ROOTS',
          detail: `Roots not under configured paths: ${invalid.join(', ')}`
        });
      }
    }

    const summary = await runIngestScan({
      limit: Math.min(Number(limit || 0) || 5000, 5000) || undefined,
      roots: Array.isArray(roots) ? roots : undefined
    });

    const { results, ...counts } = summary;
    res.json({ ok: true, data: counts });
  } catch (err) {
    logger.error('Ingest scan error:', err);
    res.status(500).json({ ok: false, error: 'Ingest scan failed', detail: err.message });
  }
});

// ── POST /search ─────────────────────────────────────────

router.post('/search', async (req, res) => {
  try {
    const { query, topK, minScore, filters } = req.body;
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'query is required and must be a non-empty string' });
    }

    const ragStore = getRagStore();
    const results = await ragStore.searchSimilarChunks(query, {
      topK: topK || 5,
      minScore,
      filters
    });

    res.json({ ok: true, data: { results, count: results.length } });
  } catch (err) {
    const classified = classifyRagAvailabilityError(err);
    if (classified) {
      logger.warn(`Search blocked: ${classified.code} — ${err.message}`);
      return res.status(classified.status).json({ ok: false, error: classified.code, detail: classified.detail });
    }
    logger.error('Search error:', err);
    res.status(500).json({ ok: false, error: 'Search failed', detail: err.message });
  }
});

// ── GET /documents ───────────────────────────────────────

router.get('/documents', async (req, res) => {
  try {
    const filters = {};
    if (req.query.source) filters.source = req.query.source;
    if (req.query.tags) filters.tags = req.query.tags.split(',');

    const ragStore = getRagStore();
    const documents = await ragStore.listDocuments(filters);
    res.json({ ok: true, data: { documents, count: documents.length } });
  } catch (err) {
    logger.error('List documents error:', err);
    res.status(500).json({ ok: false, error: 'Failed to list documents', detail: err.message });
  }
});

// ── DELETE /documents/:documentId ────────────────────────

router.delete('/documents/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    if (!documentId) {
      return res.status(400).json({ ok: false, error: 'documentId is required' });
    }

    const ragStore = getRagStore();
    const deleted = await ragStore.deleteDocument(documentId);
    if (!deleted) {
      return res.status(404).json({ ok: false, error: 'Document not found' });
    }
    res.json({ ok: true, data: { documentId } });
  } catch (err) {
    logger.error('Delete document error:', err);
    res.status(500).json({ ok: false, error: 'Failed to delete document', detail: err.message });
  }
});

// ── GET /status ──────────────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    const ragStore = getRagStore();
    const stats = await ragStore.getStats();
    res.json({ ok: true, data: stats });
  } catch (err) {
    logger.error('Status error:', err);
    res.status(500).json({ ok: false, error: 'Status check failed', detail: err.message });
  }
});

module.exports = router;
