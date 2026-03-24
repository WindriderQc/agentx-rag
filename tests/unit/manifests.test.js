/**
 * Unit tests for manifest pipeline, document operations, and hash-based unchanged detection.
 */

const mongoose = require('mongoose');

// ── Mock vector store ────────────────────────────────────

const mockVectorStore = {
  getDocument: jest.fn(),
  getDocumentChunks: jest.fn(),
  listDocuments: jest.fn(),
  deleteDocument: jest.fn(),
  upsertDocument: jest.fn(),
  searchSimilar: jest.fn(),
  getStats: jest.fn().mockResolvedValue({ documentCount: 0, chunkCount: 0 }),
  healthCheck: jest.fn().mockResolvedValue({ healthy: true }),
};

// ── Mock embeddings ──────────────────────────────────────

jest.mock('../../src/services/embeddings', () => ({
  getEmbeddingsService: () => ({
    embedTextBatch: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]])
  })
}));

jest.mock('../../src/services/vectorStore/factory', () => ({
  createVectorStore: () => mockVectorStore
}));

// ── Mock mongoose model (RagManifest) ────────────────────

const mockManifestDoc = {
  _id: new mongoose.Types.ObjectId(),
  source: 'test-source',
  root: '/data/test',
  files: [
    { path: 'file1.txt', sha256: 'abc', size: 100 },
    { path: 'file2.txt', sha256: 'def', size: 200 }
  ],
  stats: { fileCount: 2, totalBytes: 300 },
  generatedAt: new Date()
};

jest.mock('../../models/RagManifest', () => {
  const mock = {
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
  };
  return mock;
});

const RagManifest = require('../../models/RagManifest');
const { RagStore, resetRagStore } = require('../../src/services/ragStore');

// ── Express test setup ───────────────────────────────────

const express = require('express');
const request = require('supertest');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/rag', require('../../routes/manifest.routes'));
  app.use('/api/rag', require('../../routes/document.routes'));
  return app;
}

// ── Tests ────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  resetRagStore();
});

describe('POST /api/rag/manifests', () => {
  it('creates a manifest and auto-computes stats', async () => {
    RagManifest.findOneAndUpdate.mockResolvedValue(mockManifestDoc);
    const app = buildApp();

    const res = await request(app)
      .post('/api/rag/manifests')
      .send({
        source: 'test-source',
        root: '/data/test',
        files: [
          { path: 'file1.txt', sha256: 'abc', size: 100 },
          { path: 'file2.txt', sha256: 'def', size: 200 }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.source).toBe('test-source');
    expect(res.body.data.stats).toEqual({ fileCount: 2, totalBytes: 300 });

    // Verify auto-computed stats were passed to the DB call
    const updateCall = RagManifest.findOneAndUpdate.mock.calls[0];
    expect(updateCall[1].stats).toEqual({ fileCount: 2, totalBytes: 300 });
  });

  it('rejects if source is missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/rag/manifests')
      .send({ root: '/data', files: [] });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('rejects if files is not an array', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/rag/manifests')
      .send({ source: 'x', root: '/data', files: 'bad' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/rag/deletion-preview', () => {
  it('returns stale documents not in manifest', async () => {
    const sortMock = { lean: jest.fn().mockResolvedValue(mockManifestDoc) };
    RagManifest.findOne.mockReturnValue({ sort: () => sortMock });

    mockVectorStore.listDocuments.mockResolvedValue([
      { documentId: 'doc1', source: 'file1.txt', chunkCount: 3 },
      { documentId: 'doc2', source: 'file3.txt', chunkCount: 2 }  // stale — not in manifest
    ]);

    const app = buildApp();
    const res = await request(app).get('/api/rag/deletion-preview?source=test-source');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.manifestFiles).toBe(2);
    expect(res.body.data.indexedDocs).toBe(2);
    expect(res.body.data.stale).toHaveLength(1);
    expect(res.body.data.stale[0].documentId).toBe('doc2');
    expect(res.body.data.fresh).toBe(1);
  });

  it('requires source query param', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/rag/deletion-preview');

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

describe('POST /api/rag/cleanup', () => {
  const setupStaleMocks = () => {
    const sortMock = { lean: jest.fn().mockResolvedValue(mockManifestDoc) };
    RagManifest.findOne.mockReturnValue({ sort: () => sortMock });

    mockVectorStore.listDocuments.mockResolvedValue([
      { documentId: 'doc1', source: 'file1.txt', chunkCount: 3 },
      { documentId: 'doc-stale', source: 'gone.txt', chunkCount: 1 }
    ]);
    mockVectorStore.deleteDocument.mockResolvedValue(true);
  };

  it('dry-run returns what would be deleted without deleting', async () => {
    setupStaleMocks();
    const app = buildApp();

    const res = await request(app)
      .post('/api/rag/cleanup')
      .send({ source: 'test-source', dryRun: true });

    expect(res.status).toBe(200);
    expect(res.body.data.dryRun).toBe(true);
    expect(res.body.data.deleted).toBe(1);
    expect(mockVectorStore.deleteDocument).not.toHaveBeenCalled();
  });

  it('actual cleanup deletes stale documents', async () => {
    setupStaleMocks();
    const app = buildApp();

    const res = await request(app)
      .post('/api/rag/cleanup')
      .send({ source: 'test-source', dryRun: false });

    expect(res.status).toBe(200);
    expect(res.body.data.dryRun).toBe(false);
    expect(res.body.data.deleted).toBe(1);
    expect(mockVectorStore.deleteDocument).toHaveBeenCalledWith('doc-stale');
  });

  it('defaults to dry-run when dryRun not specified', async () => {
    setupStaleMocks();
    const app = buildApp();

    const res = await request(app)
      .post('/api/rag/cleanup')
      .send({ source: 'test-source' });

    expect(res.body.data.dryRun).toBe(true);
    expect(mockVectorStore.deleteDocument).not.toHaveBeenCalled();
  });
});

describe('GET /api/rag/documents/:id', () => {
  it('returns document metadata with chunk count', async () => {
    mockVectorStore.getDocument.mockResolvedValue({
      documentId: 'doc1', source: 'test', tags: ['a'], hash: 'xyz'
    });
    mockVectorStore.getDocumentChunks.mockResolvedValue([
      { text: 'chunk0', chunkIndex: 0 },
      { text: 'chunk1', chunkIndex: 1 }
    ]);

    const app = buildApp();
    const res = await request(app).get('/api/rag/documents/doc1');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.documentId).toBe('doc1');
    expect(res.body.data.chunkCount).toBe(2);
    expect(res.body.data.metadata.hash).toBe('xyz');
  });

  it('returns 404 for unknown document', async () => {
    mockVectorStore.getDocument.mockResolvedValue(null);
    const app = buildApp();

    const res = await request(app).get('/api/rag/documents/unknown');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/rag/documents/:id/chunks', () => {
  it('returns ordered chunks for a document', async () => {
    mockVectorStore.getDocument.mockResolvedValue({
      documentId: 'doc1', source: 'test', tags: []
    });
    mockVectorStore.getDocumentChunks.mockResolvedValue([
      { text: 'first chunk', chunkIndex: 0 },
      { text: 'second chunk', chunkIndex: 1 }
    ]);

    const app = buildApp();
    const res = await request(app).get('/api/rag/documents/doc1/chunks');

    expect(res.status).toBe(200);
    expect(res.body.data.chunks).toHaveLength(2);
    expect(res.body.data.chunks[0].chunkIndex).toBe(0);
    expect(res.body.data.chunks[1].text).toBe('second chunk');
  });
});

describe('Content hash unchanged detection', () => {
  it('skips re-ingestion when hash matches existing document', async () => {
    mockVectorStore.getDocument.mockResolvedValue({
      documentId: 'doc1', source: 'test', tags: [], hash: 'same-hash'
    });

    const store = new RagStore();
    const result = await store.upsertDocumentWithChunks('some text', {
      source: 'test',
      documentId: 'doc1',
      hash: 'same-hash'
    });

    expect(result).toEqual({ unchanged: true, documentId: 'doc1' });
    expect(mockVectorStore.upsertDocument).not.toHaveBeenCalled();
  });

  it('re-ingests when hash differs', async () => {
    mockVectorStore.getDocument.mockResolvedValue({
      documentId: 'doc1', source: 'test', tags: [], hash: 'old-hash'
    });
    mockVectorStore.upsertDocument.mockResolvedValue({
      documentId: 'doc1', chunkCount: 1, status: 'created'
    });

    const store = new RagStore();
    const result = await store.upsertDocumentWithChunks('updated text', {
      source: 'test',
      documentId: 'doc1',
      hash: 'new-hash'
    });

    expect(result.documentId).toBe('doc1');
    expect(mockVectorStore.upsertDocument).toHaveBeenCalled();
    // Verify hash is passed in metadata
    const metaArg = mockVectorStore.upsertDocument.mock.calls[0][1];
    expect(metaArg.hash).toBe('new-hash');
  });

  it('ingests normally when no hash provided', async () => {
    mockVectorStore.upsertDocument.mockResolvedValue({
      documentId: 'doc1', chunkCount: 1, status: 'created'
    });

    const store = new RagStore();
    const result = await store.upsertDocumentWithChunks('text', {
      source: 'test',
      documentId: 'doc1'
    });

    expect(result.documentId).toBe('doc1');
    expect(mockVectorStore.getDocument).not.toHaveBeenCalled();
  });
});
