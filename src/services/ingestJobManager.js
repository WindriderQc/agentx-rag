/**
 * Ingest Job Manager
 *
 * In-memory job store for async ingest-scan operations.
 * Caps concurrent scans to 1 and tracks progress for polling.
 */

const crypto = require('crypto');
const logger = require('../../config/logger');

/** @type {Map<string, object>} */
const jobs = new Map();

/** @type {string|null} ID of the currently running job */
let activeJobId = null;

/**
 * Create a new ingest-scan job. Returns null if a scan is already running.
 * @param {object} params - The scan parameters (limit, roots)
 * @returns {{ jobId: string, job: object } | null}
 */
function createJob(params = {}) {
  if (activeJobId) {
    return null; // concurrent scan rejected
  }

  const jobId = crypto.randomUUID();
  const job = {
    jobId,
    status: 'running',
    progress: { processed: 0, total: 0, errors: 0 },
    params,
    startedAt: new Date().toISOString(),
    completedAt: null,
    summary: null,
    error: null
  };

  jobs.set(jobId, job);
  activeJobId = jobId;
  return { jobId, job };
}

/**
 * Get a job by ID.
 * @param {string} jobId
 * @returns {object|null}
 */
function getJob(jobId) {
  return jobs.get(jobId) || null;
}

/**
 * Update job progress (called by the background scan).
 * @param {string} jobId
 * @param {{ processed: number, total: number, errors: number }} progress
 */
function updateProgress(jobId, progress) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.progress = { ...job.progress, ...progress };
}

/**
 * Mark a job as completed successfully.
 * @param {string} jobId
 * @param {object} summary - Final scan summary counts
 */
function completeJob(jobId, summary) {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = 'completed';
  job.completedAt = new Date().toISOString();
  job.summary = summary;

  if (activeJobId === jobId) {
    activeJobId = null;
  }
}

/**
 * Mark a job as failed.
 * @param {string} jobId
 * @param {string} errorMessage
 */
function failJob(jobId, errorMessage) {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = 'failed';
  job.completedAt = new Date().toISOString();
  job.error = errorMessage;

  if (activeJobId === jobId) {
    activeJobId = null;
  }
}

/**
 * Cancel a running job.
 * @param {string} jobId
 * @returns {boolean} true if the job was cancelled, false if not found or not running
 */
function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'running') {
    return false;
  }

  job.status = 'cancelled';
  job.completedAt = new Date().toISOString();

  if (activeJobId === jobId) {
    activeJobId = null;
  }

  return true;
}

/**
 * Check if a scan is currently running.
 * @returns {boolean}
 */
function isRunning() {
  return activeJobId !== null;
}

/**
 * Get the active job ID (if any).
 * @returns {string|null}
 */
function getActiveJobId() {
  return activeJobId;
}

/**
 * Reset all state (for testing).
 */
function _reset() {
  jobs.clear();
  activeJobId = null;
}

module.exports = {
  createJob,
  getJob,
  updateProgress,
  completeJob,
  failJob,
  cancelJob,
  isRunning,
  getActiveJobId,
  _reset
};
