/**
 * Buddy assets proxy — forwards a fixed set of static buddy paths to core.
 *
 * Why this exists: rag tabs render the bubble + mini-chat UI, which are
 * owned by core. Without this, rag would either need its own copy of the
 * files (drift risk) or rely on the express.static fallback to
 * ../core/public.
 *
 * Mounted BEFORE express.static so the proxy match wins. Local stale
 * copies in rag/public/, if any, are bypassed.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const CORE_URL = new URL(process.env.CORE_URL || process.env.CORE_PROXY_URL || 'http://localhost:3080');
const transport = CORE_URL.protocol === 'https:' ? https : http;
const DEFAULT_PORT = CORE_URL.protocol === 'https:' ? 443 : 80;

const PROXIED_PATHS = new Set([
  '/js/components/buddy-sprites.js',
  '/js/components/buddy-personality.js',
  '/js/components/buddy-data.js',
  '/js/components/buddy-widget-dom.js',
  '/js/components/buddy-page-hooks.js',
  '/js/components/buddy-minichat.js',
  '/js/components/buddy.js',
  '/css/buddy.css',
]);

function buddyAssetsProxy(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!PROXIED_PATHS.has(req.path)) return next();

  const opts = {
    hostname: CORE_URL.hostname,
    port: CORE_URL.port || DEFAULT_PORT,
    method: req.method,
    path: req.path,
    headers: { ...req.headers, host: CORE_URL.host },
    agent: false,
  };

  const proxyReq = transport.request(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    if (!res.headersSent) next();
  });

  proxyReq.end();

  res.on('close', () => {
    if (!proxyReq.destroyed) proxyReq.destroy();
  });
}

module.exports = buddyAssetsProxy;
module.exports.PROXIED_PATHS = PROXIED_PATHS;
