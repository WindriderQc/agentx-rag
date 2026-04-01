jest.mock('mongoose', () => ({
  connection: {
    readyState: 1
  }
}));

jest.mock('../../src/services/ingestWorker', () => ({
  runIngestScan: jest.fn()
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

  it('runs the ingest worker and returns its summary', async () => {
    runIngestScan.mockResolvedValue({
      totalCandidates: 2,
      processed: 2,
      ingested: 1,
      updated: 1,
      unchanged: 0,
      skipped: 0,
      failed: 0
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/rag/ingest-scan')
      .send({ limit: 10, roots: ['/mnt/datalake/RAG'] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.processed).toBe(2);
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
});
