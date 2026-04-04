const request = require('supertest');
const app = require('../../app');

describe('GET /health', () => {
  it('returns 503 with degraded when DB is not connected', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.db).toBe('disconnected');
  });
});

describe('GET /favicon.ico', () => {
  it('serves the shared favicon asset', async () => {
    const res = await request(app).get('/favicon.ico');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
  });
});
