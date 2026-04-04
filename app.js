const cors = require('cors');
const express = require('express');
const path = require('path');
const logger = require('./config/logger');

const app = express();

const defaultAllowedOrigins = [
  'http://localhost:3080',
  'http://127.0.0.1:3080',
  'http://localhost:3082',
  'http://127.0.0.1:3082'
];
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
  : defaultAllowedOrigins;

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.svg'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/index.html'));

app.get('/health', (req, res) => {
  const dbReady = require('mongoose').connection.readyState === 1;
  const status = dbReady ? 'ok' : 'degraded';
  res.status(dbReady ? 200 : 503).json({
    status,
    service: 'agentx-rag',
    port: parseInt(process.env.PORT, 10) || 3082,
    db: dbReady ? 'connected' : 'disconnected'
  });
});

// ── Request-timing middleware (after /health, before API routes) ──
app.use('/api/rag', (req, res, next) => {
  req.startTime = Date.now();
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (body && typeof body === 'object' && req.startTime) {
      const durationMs = Date.now() - req.startTime;
      body.meta = { ...(body.meta || {}), durationMs };
    }
    return originalJson(body);
  };
  next();
});

app.use('/api/rag', require('./routes/rag'));
app.use('/api/rag', require('./routes/document.routes'));
app.use('/api/rag', require('./routes/manifest.routes'));
app.use('/api/rag', require('./routes/migration.routes'));
app.use('/api/rag', require('./routes/metrics.routes'));
app.use('/api/rag', require('./routes/telemetry.routes'));

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

module.exports = app;
