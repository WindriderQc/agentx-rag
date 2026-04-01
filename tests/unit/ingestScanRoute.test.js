jest.mock('mongoose', () => ({
  connection: {
    readyState: 1
  }
}));

jest.mock('../../src/services/ingestWorker', () => ({
  runIngestScan: jest.fn(),
  getConfiguredRoots: jest.fn().mockReturnValue(['/mnt/datalake/RAG', '/mnt/datalake/Finance']),
  isPathUnderRoot: jest.fn((filePath, root) => {
    const resolved = require('path').resolve(filePath);
    const resolvedRoot = require('path').resolve(root);
    return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}/`);
  })
}));

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');

const { runIngestScan } = require('../../src/services/ingestWorker');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/rag', require('../../routes/rag'));
  return app;
}

describe('POST /api/rag/ingest-scan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mongoose.connection.readyState = 1;
  });

  it('runs the ingest worker and returns summary counts (no results array)', async () => {
    runIngestScan.mockResolvedValue({
      totalCandidates: 2,
      processed: 2,
      ingested: 1,
      updated: 1,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      results: [{ status: 'ingested' }, { status: 'updated' }]
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/rag/ingest-scan')
      .send({ limit: 10, roots: ['/mnt/datalake/RAG'] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.processed).toBe(2);
    expect(res.body.data.results).toBeUndefined();
    expect(runIngestScan).toHaveBeenCalledWith({
      limit: 10,
      roots: ['/mnt/datalake/RAG']
    });
  });

  it('returns 503 when MongoDB is not connected', async () => {
    mongoose.connection.readyState = 0;

    const app = buildApp();
    const res = await request(app)
      .post('/api/rag/ingest-scan')
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('MONGODB_UNAVAILABLE');
    expect(runIngestScan).not.toHaveBeenCalled();
  });

  it('rejects roots outside configured paths', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/rag/ingest-scan')
      .send({ roots: ['/etc/passwd'] });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('INVALID_ROOTS');
    expect(runIngestScan).not.toHaveBeenCalled();
  });

  it('caps limit at 5000', async () => {
    runIngestScan.mockResolvedValue({
      totalCandidates: 0, processed: 0, ingested: 0,
      updated: 0, unchanged: 0, skipped: 0, failed: 0, results: []
    });

    const app = buildApp();
    await request(app)
      .post('/api/rag/ingest-scan')
      .send({ limit: 99999 });

    expect(runIngestScan).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5000 })
    );
  });
});
