/**
 * Buddy proxy — forwards /api/buddy/* to core (port 3080).
 *
 * Stream-oriented: SSE works through the proxy because the response is
 * piped raw and req.body is never parsed before forwarding. Must be mounted
 * BEFORE express.json() so POST bodies stay as raw streams.
 *
 * Why this exists: buddy's event bus and persistence live in core. Without
 * a proxy, a rag tab loading buddy.js would hit /api/buddy/* on port 3082
 * and 404 — the widget would show but never react to platform activity.
 * Same-origin proxy avoids cross-origin SSE/CORS complexity.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const CORE_URL = new URL(process.env.CORE_URL || process.env.CORE_PROXY_URL || 'http://localhost:3080');
const transport = CORE_URL.protocol === 'https:' ? https : http;
const DEFAULT_PORT = CORE_URL.protocol === 'https:' ? 443 : 80;

function buddyProxy(req, res) {
  const opts = {
    hostname: CORE_URL.hostname,
    port: CORE_URL.port || DEFAULT_PORT,
    method: req.method,
    path: req.originalUrl,
    headers: { ...req.headers, host: CORE_URL.host },
    agent: false,
  };

  const proxyReq = transport.request(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({ error: 'buddy_proxy_error', message: err.message });
    } else {
      res.end();
    }
  });

  // Pipe POST/PUT/PATCH bodies; GET/HEAD just close the upstream request.
  // Piping a body-less Express req has been observed to leave the upstream
  // request hanging until the proxy reports "socket hang up".
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  if (hasBody) {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }

  // If the client disconnects mid-stream (SSE tab close, page nav), tear
  // down the upstream request so core's req.on('close') cleanup fires.
  res.on('close', () => {
    if (!proxyReq.destroyed) proxyReq.destroy();
  });
}

module.exports = buddyProxy;
