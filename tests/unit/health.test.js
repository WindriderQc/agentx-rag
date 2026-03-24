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
