/**
 * Manifest Routes — folder scan snapshots and cleanup operations.
 *
 * POST   /manifests          — Store a folder scan snapshot
 * GET    /manifests/latest   — Get most recent manifest
 * GET    /deletion-preview   — Compare manifest against indexed documents
 * POST   /cleanup            — Delete stale documents (dry-run by default)
 */

const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const RagManifest = require('../models/RagManifest');
const { getRagStore } = require('../src/services/ragStore');

// ── POST /manifests ──────────────────────────────────────

router.post('/manifests', async (req, res) => {
  try {
    const { source, root, scanId, files } = req.body;

    if (!source || typeof source !== 'string') {
      return res.status(400).json({ ok: false, error: 'source is required and must be a string' });
    }
    if (!root || typeof root !== 'string') {
      return res.status(400).json({ ok: false, error: 'root is required and must be a string' });
    }
    if (!Array.isArray(files)) {
      return res.status(400).json({ ok: false, error: 'files must be an array' });
    }

    const stats = {
      fileCount: files.length,
      totalBytes: files.reduce((sum, f) => sum + (f.size || 0), 0)
    };

    const manifest = await RagManifest.findOneAndUpdate(
      { source, root },
      { source, root, scanId, files, stats, generatedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      ok: true,
      data: { manifestId: manifest._id, source: manifest.source, stats: manifest.stats }
    });
  } catch (err) {
    logger.error('Create manifest error:', err);
    res.status(500).json({ ok: false, error: 'Failed to create manifest', detail: err.message });
  }
});

// ── GET /manifests/latest ────────────────────────────────

router.get('/manifests/latest', async (req, res) => {
  try {
    const query = {};
    if (req.query.source) query.source = req.query.source;

    const manifest = await RagManifest.findOne(query).sort({ generatedAt: -1 }).lean();
    res.json({ ok: true, data: manifest || null });
  } catch (err) {
    logger.error('Get latest manifest error:', err);
    res.status(500).json({ ok: false, error: 'Failed to get manifest', detail: err.message });
  }
});

// ── GET /deletion-preview ────────────────────────────────

async function computeStaleDocs(source) {
  const manifest = await RagManifest.findOne({ source }).sort({ generatedAt: -1 }).lean();
  if (!manifest) return { manifest: null };

  const ragStore = getRagStore();
  const indexedDocs = await ragStore.listDocuments({ source });

  const manifestPaths = new Set(manifest.files.map(f => f.path));
  const stale = indexedDocs.filter(doc => !manifestPaths.has(doc.documentId));
  const fresh = indexedDocs.length - stale.length;

  return { manifest, indexedDocs, stale, fresh };
}

router.get('/deletion-preview', async (req, res) => {
  try {
    const { source } = req.query;
    if (!source) {
      return res.status(400).json({ ok: false, error: 'source query parameter is required' });
    }

    const { manifest, indexedDocs, stale, fresh } = await computeStaleDocs(source);
    if (!manifest) {
      return res.json({ ok: true, data: { source, manifestFiles: 0, indexedDocs: 0, stale: [], fresh: 0 } });
    }

    res.json({
      ok: true,
      data: {
        source,
        manifestFiles: manifest.files.length,
        indexedDocs: indexedDocs.length,
        stale,
        fresh
      }
    });
  } catch (err) {
    logger.error('Deletion preview error:', err);
    res.status(500).json({ ok: false, error: 'Failed to compute deletion preview', detail: err.message });
  }
});

// ── POST /cleanup ────────────────────────────────────────

router.post('/cleanup', async (req, res) => {
  try {
    const { source, dryRun = true } = req.body;
    if (!source) {
      return res.status(400).json({ ok: false, error: 'source is required' });
    }

    const { manifest, stale } = await computeStaleDocs(source);
    if (!manifest) {
      return res.json({ ok: true, data: { dryRun, deleted: 0, documents: [] } });
    }

    if (dryRun) {
      return res.json({ ok: true, data: { dryRun: true, deleted: stale.length, documents: stale } });
    }

    const ragStore = getRagStore();
    for (const doc of stale) {
      await ragStore.deleteDocument(doc.documentId);
    }

    res.json({ ok: true, data: { dryRun: false, deleted: stale.length, documents: stale } });
  } catch (err) {
    logger.error('Cleanup error:', err);
    res.status(500).json({ ok: false, error: 'Cleanup failed', detail: err.message });
  }
});

module.exports = router;
