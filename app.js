const cors = require('cors');
const express = require('express');

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

app.use('/api/rag', require('./routes/rag'));
app.use('/api/rag', require('./routes/document.routes'));
app.use('/api/rag', require('./routes/manifest.routes'));

module.exports = app;
