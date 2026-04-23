const cors = require('cors');
const express = require('express');
const path = require('path');
const logger = require('./config/logger');

const app = express();

// EJS templating — shared layouts from core, local pages
app.set('view engine', 'ejs');
app.set('views', [
  path.join(__dirname, 'views'),
  path.join(__dirname, '..', 'core', 'views')
]);

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

// Expose request hostname to all templates (for cross-service nav links).
// The shared nav (rendered from core/views/partials/nav.ejs) uses reqHost
// to build absolute URLs to core (3080) and benchmark (3081).
app.use((req, res, next) => {
  res.locals.reqHost = req.hostname;
  next();
});

app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.svg'));
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, '..', 'core', 'public')));

// ── Page routes (EJS) ────────────────────────────────────────────────────────
const ragHeadCss = '<link rel="stylesheet" href="/css/style.css">';

const dashboardPageView = path.resolve(__dirname, 'views/pages/dashboard');
const documentsPageView = path.resolve(__dirname, 'views/pages/documents');
const searchPageView    = path.resolve(__dirname, 'views/pages/search');
const uploadPageView    = path.resolve(__dirname, 'views/pages/upload');
const maintenancePageView = path.resolve(__dirname, 'views/pages/maintenance');

app.get('/', (req, res) => {
  res.render('layouts/main', {
    pageView: dashboardPageView,
    title: 'AgentX RAG — Dashboard',
    service: 'rag',
    activePage: 'rag',
    bodyClass: 'dashboard-body',
    headCss: ragHeadCss,
    footerJs: '<script src="/js/api.js"></script>\n<script src="/js/dashboard.js"></script>'
  });
});

app.get('/documents', (req, res) => {
  res.render('layouts/main', {
    pageView: documentsPageView,
    title: 'AgentX RAG — Documents',
    service: 'rag',
    activePage: 'rag',
    headCss: ragHeadCss,
    footerJs: '<script src="/js/api.js"></script>\n<script src="/js/documents.js"></script>'
  });
});

app.get('/search', (req, res) => {
  res.render('layouts/main', {
    pageView: searchPageView,
    title: 'AgentX RAG — Search Playground',
    service: 'rag',
    activePage: 'rag',
    headCss: ragHeadCss,
    footerJs: '<script src="/js/api.js"></script>\n<script src="/js/search.js"></script>'
  });
});

app.get('/upload', (req, res) => {
  res.render('layouts/main', {
    pageView: uploadPageView,
    title: 'AgentX RAG — Upload',
    service: 'rag',
    activePage: 'rag',
    headCss: ragHeadCss,
    footerJs: '<script src="/js/api.js"></script>\n<script src="/js/upload.js"></script>'
  });
});

app.get('/maintenance', (req, res) => {
  res.render('layouts/main', {
    pageView: maintenancePageView,
    title: 'AgentX RAG — Maintenance',
    service: 'rag',
    activePage: 'rag',
    headCss: ragHeadCss,
    footerJs: '<script src="/js/api.js"></script>\n<script src="/js/maintenance.js"></script>'
  });
});

// ── Legacy .html redirects ───────────────────────────────────────────────────
app.get('/index.html',       (req, res) => res.redirect(301, '/'));
app.get('/documents.html',   (req, res) => res.redirect(301, '/documents'));
app.get('/search.html',      (req, res) => res.redirect(301, '/search'));
app.get('/upload.html',      (req, res) => res.redirect(301, '/upload'));
app.get('/maintenance.html', (req, res) => res.redirect(301, '/maintenance'));

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
app.use('/api/rag', require('./routes/snapshots.routes'));

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

module.exports = app;
