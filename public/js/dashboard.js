/**
 * RAG Dashboard — fetches health + status and updates the DOM.
 * Depends on: js/api.js (window.RAG)
 */

(function () {
  'use strict';

  var REFRESH_INTERVAL = 30000; // 30 seconds
  var refreshInFlight = false;

  // ── DOM refs (resolved once on load) ──────────────────────

  var els = {};

  function cacheElements() {
    els.serviceStatus   = document.getElementById('service-status');
    els.serviceDot      = document.getElementById('service-dot');
    els.depMongo        = document.getElementById('dep-mongo');
    els.depQdrant       = document.getElementById('dep-qdrant');
    els.depEmbedding    = document.getElementById('dep-embedding');
    els.statDocs        = document.getElementById('stat-docs');
    els.statChunks      = document.getElementById('stat-chunks');
    els.statDimension   = document.getElementById('stat-dimension');
    els.lastUpdated     = document.getElementById('last-updated');
  }

  // ── Render helpers ────────────────────────────────────────

  function renderDot(healthy) {
    return healthy ? 'ok' : 'error';
  }

  function normalizeState(state) {
    if (state === 'warn') return 'warn';
    if (state === true || state === 'ok') return 'ok';
    return 'error';
  }

  function renderHealthSuccess(health) {
    var isOk = health.status === 'ok';

    if (els.serviceDot) {
      els.serviceDot.className = 'status-dot ' + (isOk ? 'ok' : 'error');
    }

    if (els.serviceStatus) {
      els.serviceStatus.textContent = isOk ? 'ok' : 'degraded';
      els.serviceStatus.className = isOk ? 'status-ok' : 'status-error';
    }

    var dbOk = health.db === 'connected';
    renderDepRow(els.depMongo, 'MongoDB', dbOk, dbOk ? 'connected' : 'disconnected');
  }

  function renderHealthFailure() {
    if (els.serviceDot) els.serviceDot.className = 'status-dot error';
    if (els.serviceStatus) {
      els.serviceStatus.textContent = 'unavailable';
      els.serviceStatus.className = 'status-error';
    }
    renderDepRow(els.depMongo, 'MongoDB', false, 'unavailable');
  }

  function renderStatusSuccess(data) {
    var qdrantOk = data.vectorStore && data.vectorStore.healthy;
    var qdrantDetail = qdrantOk
      ? (data.vectorStore.type || 'qdrant')
      : (data.vectorStore && data.vectorStore.error ? data.vectorStore.error : 'unhealthy');
    renderDepRow(els.depQdrant, 'Qdrant', qdrantOk, qdrantDetail);

    var emb = data.dependencies && data.dependencies.embedding ? data.dependencies.embedding : null;
    var embModel = data.embeddingModel || '';
    var embOk = !!(emb && emb.healthy === true);
    var embChecking = !!(emb && emb.checking === true);
    var embState = embChecking ? 'warn' : (embOk ? 'ok' : 'error');
    var embDetail = embOk
      ? formatEmbeddingDetail(emb, embModel)
      : ((emb && emb.error) || 'unavailable');
    renderDepRow(els.depEmbedding, 'Embedding Provider', embState, embDetail);

    if (els.statDocs) els.statDocs.textContent = formatNumber(data.documentCount);
    if (els.statChunks) els.statChunks.textContent = formatNumber(data.chunkCount);
    if (els.statDimension) els.statDimension.textContent = data.vectorDimension || '--';
  }

  function renderStatusFailure() {
    renderDepRow(els.depQdrant, 'Qdrant', false, 'unavailable');
    renderDepRow(els.depEmbedding, 'Embedding Provider', false, 'unavailable');
    if (els.statDocs) els.statDocs.textContent = '--';
    if (els.statChunks) els.statChunks.textContent = '--';
    if (els.statDimension) els.statDimension.textContent = '--';
  }

  function renderDepRow(el, label, state, detail) {
    if (!el) return;
    var dotClass = normalizeState(state);
    var textClass = dotClass === 'ok'
      ? 'status-ok'
      : (dotClass === 'warn' ? 'status-warn' : 'status-error');
    el.innerHTML =
      '<td class="dep-name">' + escapeHtml(label) + '</td>' +
      '<td class="dep-status">' +
        '<span class="status-dot ' + dotClass + '"></span> ' +
        '<span class="' + textClass + '">' +
          escapeHtml(detail) +
        '</span>' +
      '</td>';
  }

  function formatEmbeddingDetail(embedding, fallbackModel) {
    if (!embedding) {
      return fallbackModel || 'not configured';
    }

    var provider = embedding.provider || 'unknown';
    var model = embedding.model || fallbackModel || 'unknown';
    var hosts = Array.isArray(embedding.hosts) ? embedding.hosts : [];
    var endpoint = embedding.endpoint || (hosts.length > 0 ? hosts[0] : '');
    var extraHosts = hosts.length > 1 ? ' (+' + (hosts.length - 1) + ' more)' : '';
    var detail = model;

    if (endpoint) {
      detail += ' via ' + endpoint + extraHosts;
    }

    if (provider) {
      detail += ' [' + provider + ']';
    }

    return detail;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Main refresh ──────────────────────────────────────────

  async function refreshDashboard() {
    if (refreshInFlight) {
      return;
    }

    refreshInFlight = true;

    try {
      var healthPromise = window.RAG.getHealth()
        .then(function (health) {
          renderHealthSuccess(health);
        })
        .catch(function () {
          renderHealthFailure();
        });

      var statusPromise = window.RAG.getStatus()
        .then(function (status) {
          renderStatusSuccess(status.data);
        })
        .catch(function () {
          renderStatusFailure();
        });

      await Promise.allSettled([healthPromise, statusPromise]);

      if (els.lastUpdated) {
        els.lastUpdated.textContent = new Date().toLocaleTimeString();
      }
    } finally {
      refreshInFlight = false;
    }
  }

  function formatNumber(n) {
    if (n == null) return '--';
    return Number(n).toLocaleString();
  }

  // ── Init ──────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    cacheElements();
    refreshDashboard();
    setInterval(refreshDashboard, REFRESH_INTERVAL);
  });
})();
