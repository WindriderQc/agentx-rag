/**
 * Maintenance Page — Drift & Cleanup + Embedding Migration Status.
 * Depends on js/api.js (window.RAG namespace).
 */

(function () {
  'use strict';

  // ── DOM references ────────────────────────────────────────

  var sourceInput       = document.getElementById('drift-source');
  var btnCheckManifest  = document.getElementById('btn-check-manifest');
  var manifestSummary   = document.getElementById('manifest-summary');
  var driftActions      = document.getElementById('drift-actions');
  var btnCheckDrift     = document.getElementById('btn-check-drift');
  var driftResults      = document.getElementById('drift-results');
  var cleanupActions    = document.getElementById('cleanup-actions');
  var btnCleanup        = document.getElementById('btn-cleanup');
  var cleanupResult     = document.getElementById('cleanup-result');
  var migrationStatus   = document.getElementById('migration-status');
  var reindexActions    = document.getElementById('reindex-actions');
  var btnReindex        = document.getElementById('btn-reindex');
  var reindexResult     = document.getElementById('reindex-result');

  // ── State ─────────────────────────────────────────────────

  var currentSource = '';
  var staleCount = 0;

  // ── Helpers ───────────────────────────────────────────────

  function esc(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
  }

  function formatDate(dateStr) {
    if (!dateStr) return '--';
    var d = new Date(dateStr);
    return d.toLocaleString();
  }

  function showBannerInfo(container, message) {
    container.innerHTML = '<div class="banner-info">' + esc(message) + '</div>';
  }

  function showError(container, message) {
    container.innerHTML = '<div class="error-state">' + esc(message) + '</div>';
  }

  // ── Drift Panel ───────────────────────────────────────────

  async function checkManifest(source) {
    manifestSummary.style.display = 'block';
    manifestSummary.innerHTML = '<p class="loading">Loading manifest...</p>';
    driftActions.style.display = 'none';
    driftResults.innerHTML = '';
    cleanupActions.style.display = 'none';
    cleanupResult.innerHTML = '';
    staleCount = 0;

    try {
      var res = await RAG.getLatestManifest(source);
      var data = res.data;

      if (!data) {
        manifestSummary.innerHTML = '<p class="empty-state" style="padding:12px 0;">No manifest found for source "' + esc(source) + '"</p>';
        return;
      }

      var stats = data.stats || {};
      manifestSummary.innerHTML =
        '<div class="manifest-summary">' +
          '<strong>Source:</strong> ' + esc(data.source) + '<br>' +
          '<strong>Root:</strong> ' + esc(data.root || '--') + '<br>' +
          '<strong>Files:</strong> ' + (stats.fileCount || 0) + '<br>' +
          '<strong>Total size:</strong> ' + formatBytes(stats.totalBytes) + '<br>' +
          '<strong>Generated:</strong> ' + formatDate(data.generatedAt) +
        '</div>';

      driftActions.style.display = 'block';
    } catch (err) {
      if (err.status === 404) {
        showBannerInfo(manifestSummary, 'Manifest API not available');
      } else {
        showError(manifestSummary, 'Failed to load manifest: ' + (err.message || 'Unknown error'));
      }
    }
  }

  async function checkDrift(source) {
    driftResults.innerHTML = '<p class="loading">Checking drift...</p>';
    cleanupActions.style.display = 'none';
    cleanupResult.innerHTML = '';
    staleCount = 0;

    try {
      var res = await RAG.getDeletionPreview(source);
      var data = res.data;

      var manifestFiles = data.manifestFiles || 0;
      var indexedDocs = data.indexedDocs || 0;
      var staleList = data.stale || [];
      var freshCount = data.fresh || 0;
      staleCount = staleList.length;

      // Comparison stats
      var html =
        '<div class="stat-comparison">' +
          '<div class="stat-box"><div class="stat-value mono">' + manifestFiles + '</div><div class="stat-label">Manifest Files</div></div>' +
          '<span class="stat-arrow">&#8594;</span>' +
          '<div class="stat-box"><div class="stat-value mono">' + indexedDocs + '</div><div class="stat-label">Indexed Docs</div></div>' +
          '<span class="stat-arrow">&#8594;</span>' +
          '<div class="stat-box"><div class="stat-value mono">' + freshCount + '</div><div class="stat-label">Fresh</div></div>' +
          '<span class="stat-arrow">&#8594;</span>' +
          '<div class="stat-box"><div class="stat-value mono">' + staleCount + '</div><div class="stat-label">Stale</div></div>' +
        '</div>';

      if (staleCount === 0) {
        html += '<p class="sync-ok">No stale documents — index is in sync with manifest</p>';
      } else {
        html += '<p class="stale-header">' + staleCount + ' stale document' + (staleCount !== 1 ? 's' : '') + ' found</p>';
        html += '<table class="data-table"><thead><tr><th>Document ID</th><th>Source</th></tr></thead><tbody>';
        for (var i = 0; i < staleList.length; i++) {
          var doc = staleList[i];
          html += '<tr><td class="mono">' + esc(doc.documentId || '--') + '</td><td>' + esc(doc.source || '--') + '</td></tr>';
        }
        html += '</tbody></table>';
      }

      driftResults.innerHTML = html;

      if (staleCount > 0) {
        cleanupActions.style.display = 'block';
      }
    } catch (err) {
      if (err.status === 404) {
        showBannerInfo(driftResults, 'Deletion preview API not available');
      } else {
        showError(driftResults, 'Failed to check drift: ' + (err.message || 'Unknown error'));
      }
    }
  }

  async function performCleanup(source) {
    if (!confirm('This will permanently delete ' + staleCount + ' stale document' + (staleCount !== 1 ? 's' : '') + '. Proceed?')) {
      return;
    }

    cleanupResult.innerHTML = '<p class="loading">Cleaning up...</p>';
    btnCleanup.disabled = true;

    try {
      var res = await RAG.runCleanup(source, false);
      var data = res.data;
      var stats = data.stats || {};
      var succeeded = stats.succeeded || 0;
      var failed = stats.failed || 0;

      var msg = 'Deleted ' + succeeded + ' document' + (succeeded !== 1 ? 's' : '');
      if (failed > 0) {
        msg += ' (' + failed + ' failed)';
      }

      cleanupResult.innerHTML = '<div class="result-success">' + esc(msg) + '</div>';
      cleanupActions.style.display = 'none';

      // Refresh drift check
      await checkDrift(source);
    } catch (err) {
      if (err.status === 404) {
        showBannerInfo(cleanupResult, 'Cleanup API not available');
      } else {
        showError(cleanupResult, 'Cleanup failed: ' + (err.message || 'Unknown error'));
      }
    } finally {
      btnCleanup.disabled = false;
    }
  }

  // ── Migration Panel ───────────────────────────────────────

  async function loadMigrationStatus() {
    migrationStatus.innerHTML = '<p class="loading">Loading migration status...</p>';
    reindexActions.style.display = 'none';
    reindexResult.innerHTML = '';

    try {
      var res = await RAG.getStatus();
      var data = res.data || {};

      var embeddingModel = '--';
      var embeddingProvider = '--';
      var embeddingEndpoint = '--';
      if (data.dependencies && data.dependencies.embedding) {
        embeddingModel = data.dependencies.embedding.model || '--';
        embeddingProvider = data.dependencies.embedding.provider || '--';
        embeddingEndpoint = data.dependencies.embedding.endpoint || '--';
      } else if (data.embeddingModel) {
        embeddingModel = data.embeddingModel;
      }

      var storedDimension = data.vectorDimension || 0;

      var html =
        '<div class="migration-row"><span class="migration-label">Embedding Provider</span><span class="migration-value">' + esc(String(embeddingProvider)) + '</span></div>' +
        '<div class="migration-row"><span class="migration-label">Configured Model</span><span class="migration-value">' + esc(String(embeddingModel)) + '</span></div>' +
        '<div class="migration-row"><span class="migration-label">Embedding Endpoint</span><span class="migration-value">' + esc(String(embeddingEndpoint)) + '</span></div>' +
        '<div class="migration-row"><span class="migration-label">Stored Vector Dimension</span><span class="migration-value">' + storedDimension + '</span></div>';

      // Assess mismatch state
      var assessment = assessMismatch(storedDimension);
      html += '<div style="margin-top:12px;">' + assessment.html + '</div>';

      migrationStatus.innerHTML = html;

      // Show reindex button
      reindexActions.style.display = 'block';
      btnReindex.disabled = !assessment.mismatch;
    } catch (err) {
      if (err.status === 404) {
        showBannerInfo(migrationStatus, 'Status API not available');
      } else {
        showError(migrationStatus, 'Failed to load status: ' + (err.message || 'Unknown error'));
      }
    }
  }

  function assessMismatch(storedDim) {
    if (storedDim === 0) {
      return {
        mismatch: false,
        html: '<span class="mismatch-neutral">No vectors stored yet</span>'
      };
    }

    // We only have the stored dimension from Qdrant.
    // Without a separate "configured dimension" from the API, we show the stored
    // dimension as current and indicate the state as healthy.
    return {
      mismatch: false,
      html: '<span class="mismatch-ok">Dimensions available (' + storedDim + 'd)</span>'
    };
  }

  async function triggerReindex() {
    if (!confirm('This will reindex all documents with the current embedding model. This can take significant time. Proceed?')) {
      return;
    }

    reindexResult.innerHTML = '<p class="loading">Triggering reindex...</p>';
    btnReindex.disabled = true;

    try {
      await RAG.triggerReindex();
      reindexResult.innerHTML = '<div class="result-success">Reindex triggered successfully.</div>';
    } catch (err) {
      if (err.status === 404) {
        showBannerInfo(reindexResult, 'Reindex API not available yet — this feature requires task implementation');
      } else {
        showError(reindexResult, 'Reindex failed: ' + (err.message || 'Unknown error'));
      }
    } finally {
      btnReindex.disabled = false;
    }
  }

  // ── Event Bindings ────────────────────────────────────────

  btnCheckManifest.addEventListener('click', function () {
    var source = sourceInput.value.trim();
    if (!source) {
      sourceInput.focus();
      return;
    }
    currentSource = source;
    checkManifest(source);
  });

  sourceInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      btnCheckManifest.click();
    }
  });

  btnCheckDrift.addEventListener('click', function () {
    if (currentSource) {
      checkDrift(currentSource);
    }
  });

  btnCleanup.addEventListener('click', function () {
    if (currentSource) {
      performCleanup(currentSource);
    }
  });

  btnReindex.addEventListener('click', function () {
    triggerReindex();
  });

  // ── Init ──────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    loadMigrationStatus();
  });

  // Also fire immediately in case DOMContentLoaded already fired
  if (document.readyState !== 'loading') {
    loadMigrationStatus();
  }
})();
