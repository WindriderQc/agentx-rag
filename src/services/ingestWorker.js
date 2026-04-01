const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');

const mammoth = require('mammoth');
const mongoose = require('mongoose');
const fetch = require('node-fetch');

const logger = require('../../config/logger');
const { getRagStore } = require('./ragStore');

const execFileAsync = promisify(execFile);
let pdfParseModule = null;

const DEFAULT_ROOTS = ['/mnt/datalake/RAG', '/mnt/datalake/Finance'];
const DEFAULT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_BATCH_DELAY_MS = 100;

const SUPPORTED_EXTENSIONS = new Set(['md', 'txt', 'pdf', 'docx', 'json']);
const SKIP_EXTENSIONS = new Set([
  '7z',
  'avi',
  'bin',
  'blend',
  'bmp',
  'csv',
  'dll',
  'doc',
  'dmg',
  'exe',
  'gif',
  'gz',
  'heic',
  'iso',
  'jpeg',
  'jpg',
  'm4a',
  'mkv',
  'mov',
  'mp3',
  'mp4',
  'nfo',
  'obj',
  'ogg',
  'otf',
  'pages',
  'png',
  'rar',
  'rtf',
  'sqlite',
  'stl',
  'tar',
  'tif',
  'tiff',
  'ttf',
  'wav',
  'webm',
  'webp',
  'xls',
  'xlsx',
  'xml',
  'yaml',
  'yml',
  'zip'
]);
const SKIP_DIRECTORY_NAMES = new Set(['keys']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeRoots(input) {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];

  return Array.from(
    new Set(
      raw
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .map((entry) => path.resolve(entry))
    )
  );
}

function getConfiguredRoots(value = process.env.INGEST_ROOTS) {
  if (!value || !String(value).trim()) {
    return DEFAULT_ROOTS.slice();
  }
  return normalizeRoots(value);
}

function normalizeExt(ext, filePath = '') {
  const raw = String(ext || path.extname(filePath).slice(1) || '').trim().toLowerCase();
  return raw.startsWith('.') ? raw.slice(1) : raw;
}

function isPathUnderRoot(filePath, root) {
  const resolvedPath = path.resolve(filePath);
  const resolvedRoot = path.resolve(root);
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${path.sep}`);
}

function getMatchingRoot(filePath, roots) {
  const normalizedRoots = normalizeRoots(roots);
  const matches = normalizedRoots.filter((root) => isPathUnderRoot(filePath, root));
  if (!matches.length) {
    return null;
  }
  return matches.sort((a, b) => b.length - a.length)[0];
}

function hasSkippedDirectory(filePath) {
  const segments = path.resolve(filePath).split(path.sep).filter(Boolean);
  return segments.some((segment) => SKIP_DIRECTORY_NAMES.has(segment.toLowerCase()));
}

function normalizeMtimeMs(mtime) {
  if (mtime === null || mtime === undefined) {
    return null;
  }
  if (mtime instanceof Date) {
    return mtime.getTime();
  }
  const numericMtime = Number(mtime);
  if (!Number.isFinite(numericMtime)) {
    return null;
  }
  return numericMtime > 1e12 ? numericMtime : numericMtime * 1000;
}

function needsReindex(record) {
  if (!record || !record.indexed_at) {
    return true;
  }
  const indexedAt = new Date(record.indexed_at);
  if (Number.isNaN(indexedAt.getTime())) {
    return true;
  }
  const mtimeMs = normalizeMtimeMs(record.mtime);
  return mtimeMs === null ? false : mtimeMs > indexedAt.getTime();
}

function slugifySegment(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'auto-ingested';
}

function deriveSourceTag(filePath, roots = []) {
  const matchedRoot = getMatchingRoot(filePath, roots);
  if (matchedRoot) {
    const relativePath = path.relative(matchedRoot, filePath);
    const segments = relativePath.split(path.sep).filter(Boolean);
    if (segments.length > 1) {
      return slugifySegment(segments[0]);
    }
    const rootName = path.basename(matchedRoot);
    return slugifySegment(rootName);
  }
  return slugifySegment(path.basename(path.dirname(filePath)));
}

function buildTags(filePath, roots = []) {
  const source = deriveSourceTag(filePath, roots);
  return Array.from(new Set(['auto-ingested', source]));
}

function describeSkip(record, options = {}) {
  const filePath = record?.path || '';
  const ext = normalizeExt(record?.ext, filePath);
  const roots = options.roots || [];
  const maxFileSizeBytes = Number(options.maxFileSizeBytes || DEFAULT_MAX_FILE_SIZE_BYTES);

  if (!filePath) {
    return { skip: true, reason: 'missing path' };
  }
  if (roots.length && !getMatchingRoot(filePath, roots)) {
    return { skip: true, reason: 'outside configured roots' };
  }
  if (hasSkippedDirectory(filePath)) {
    return { skip: true, reason: 'skip directory' };
  }
  if (SKIP_EXTENSIONS.has(ext)) {
    return { skip: true, reason: `skip extension: .${ext}` };
  }
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return { skip: true, reason: `unsupported extension: .${ext || 'unknown'}` };
  }
  if (Number(record?.size || 0) > maxFileSizeBytes) {
    return { skip: true, reason: `file too large: ${record.size} bytes` };
  }
  return { skip: false };
}

async function extractPdfText(filePath, options = {}) {
  const commandRunner = options.commandRunner || execFileAsync;
  const parser = options.pdfParser || getPdfParser();

  try {
    const { stdout } = await commandRunner('pdftotext', ['-layout', '-nopgbrk', filePath, '-'], {
      maxBuffer: DEFAULT_MAX_FILE_SIZE_BYTES * 4
    });
    if (stdout && stdout.trim()) {
      return stdout;
    }
  } catch (error) {
    logger.warn('pdftotext unavailable, falling back to pdf-parse', {
      filePath,
      error: error.message
    });
  }

  const buffer = await fs.readFile(filePath);
  const parsed = await parser(buffer);
  return parsed.text || '';
}

async function extractJsonText(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch (_error) {
    return raw;
  }
}

async function extractTextFromFile(filePath, ext, options = {}) {
  switch (normalizeExt(ext, filePath)) {
    case 'md':
    case 'txt':
      return fs.readFile(filePath, 'utf8');
    case 'json':
      return extractJsonText(filePath);
    case 'pdf':
      return extractPdfText(filePath, options);
    case 'docx': {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || '';
    }
    default:
      throw new Error(`Unsupported extension: .${normalizeExt(ext, filePath)}`);
  }
}

function createDirectIngestClient(options = {}) {
  const ragStore = options.ragStore || getRagStore();
  return async (payload) => ragStore.upsertDocumentWithChunks(payload.text, {
    source: payload.source,
    tags: payload.tags,
    documentId: payload.documentId,
    chunkSize: payload.chunkSize,
    chunkOverlap: payload.chunkOverlap,
    hash: payload.hash
  });
}

function getPdfParser() {
  if (!pdfParseModule) {
    pdfParseModule = require('pdf-parse');
  }
  return pdfParseModule;
}

function createIngestApiClient(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = String(options.baseUrl || process.env.RAG_API_URL || `http://127.0.0.1:${process.env.PORT || 3082}`)
    .replace(/\/+$/, '');
  const ingestPath = options.ingestPath || '/api/rag/ingest';

  return async (payload) => {
    const response = await fetchImpl(`${baseUrl}${ingestPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    let body = {};
    try {
      body = await response.json();
    } catch (_error) {
      body = {};
    }

    if (!response.ok || body.ok === false) {
      const message = body?.detail || body?.error || `Ingest API failed with status ${response.status}`;
      throw new Error(message);
    }

    return body.data;
  };
}

class IngestWorker {
  constructor(options = {}) {
    this.db = options.db || mongoose.connection.db;
    this.logger = options.logger || logger;
    this.roots = normalizeRoots(options.roots || getConfiguredRoots());
    this.maxFileSizeBytes = Number(
      options.maxFileSizeBytes || process.env.INGEST_MAX_FILE_SIZE_BYTES || DEFAULT_MAX_FILE_SIZE_BYTES
    );
    this.batchDelayMs = Number(
      options.batchDelayMs || process.env.INGEST_BATCH_DELAY_MS || DEFAULT_BATCH_DELAY_MS
    );
    this.ingestDocument = options.ingestDocument || createDirectIngestClient(options);
    this.commandRunner = options.commandRunner || execFileAsync;
    this.pdfParser = options.pdfParser || null;
  }

  get collection() {
    if (!this.db) {
      throw new Error('MongoDB is not connected');
    }
    return this.db.collection('nas_files');
  }

  async getCandidateRecords(options = {}) {
    const limit = Number(options.limit || 0);
    const query = { ext: { $in: Array.from(SUPPORTED_EXTENSIONS) } };

    if (this.roots.length) {
      query.$or = this.roots.map((root) => ({
        path: { $regex: `^${escapeRegExp(root)}` }
      }));
    }

    const records = await this.collection
      .find(query)
      .sort({ scan_seen_at: -1, path: 1 })
      .toArray();

    const eligible = records.filter((record) => {
      if (describeSkip(record, { roots: this.roots, maxFileSizeBytes: this.maxFileSizeBytes }).skip) {
        return false;
      }
      return needsReindex(record);
    });

    return limit > 0 ? eligible.slice(0, limit) : eligible;
  }

  async processRecord(record) {
    const skip = describeSkip(record, {
      roots: this.roots,
      maxFileSizeBytes: this.maxFileSizeBytes
    });
    if (skip.skip) {
      return { status: 'skipped', reason: skip.reason, path: record.path };
    }

    const source = deriveSourceTag(record.path, this.roots);
    const tags = buildTags(record.path, this.roots);
    const updateFilter = record._id ? { _id: record._id } : { path: record.path };

    try {
      const text = await extractTextFromFile(record.path, record.ext, {
        commandRunner: this.commandRunner,
        pdfParser: this.pdfParser
      });

      if (!text || !text.trim()) {
        await this.collection.updateOne(updateFilter, {
          $set: {
            indexed_at: new Date(),
            indexed_status: 'skipped-empty',
            indexed_source: source,
            indexed_tags: tags,
            indexed_document_id: record.path,
            indexed_error: null
          }
        });
        return { status: 'skipped', reason: 'empty extracted text', path: record.path, source };
      }

      const ingestResult = await this.ingestDocument({
        text,
        source,
        tags,
        documentId: record.path,
        hash: record.sha256
      });

      const resultStatus = ingestResult?.unchanged
        ? 'unchanged'
        : record.indexed_at
          ? 'updated'
          : 'ingested';

      await this.collection.updateOne(updateFilter, {
        $set: {
          indexed_at: new Date(),
          indexed_status: resultStatus,
          indexed_source: source,
          indexed_tags: tags,
          indexed_document_id: record.path,
          indexed_error: null
        }
      });

      return {
        status: resultStatus,
        source,
        path: record.path,
        documentId: record.path,
        chunkCount: ingestResult?.chunkCount || 0
      };
    } catch (error) {
      await this.collection.updateOne(updateFilter, {
        $set: {
          indexed_error: error.message,
          indexed_error_at: new Date(),
          indexed_source: source,
          indexed_tags: tags,
          indexed_document_id: record.path
        }
      });

      this.logger.warn('RAG ingest worker failed for file', {
        path: record.path,
        error: error.message
      });

      return { status: 'failed', reason: error.message, path: record.path, source };
    }
  }

  async run(options = {}) {
    const startedAt = new Date();
    const candidates = await this.getCandidateRecords(options);
    const results = [];
    const summary = {
      startedAt,
      finishedAt: null,
      roots: this.roots,
      totalCandidates: candidates.length,
      processed: 0,
      ingested: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      results
    };

    for (const [index, record] of candidates.entries()) {
      const result = await this.processRecord(record);
      results.push(result);
      summary.processed += 1;

      if (result.status === 'ingested') summary.ingested += 1;
      else if (result.status === 'updated') summary.updated += 1;
      else if (result.status === 'unchanged') summary.unchanged += 1;
      else if (result.status === 'failed') summary.failed += 1;
      else summary.skipped += 1;

      if (index < candidates.length - 1 && this.batchDelayMs > 0) {
        await sleep(this.batchDelayMs);
      }
    }

    summary.finishedAt = new Date();
    this.logger.info('RAG ingest worker finished', {
      totalCandidates: summary.totalCandidates,
      processed: summary.processed,
      ingested: summary.ingested,
      updated: summary.updated,
      unchanged: summary.unchanged,
      skipped: summary.skipped,
      failed: summary.failed
    });

    return summary;
  }
}

async function runIngestScan(options = {}) {
  const worker = options.worker || new IngestWorker(options);
  return worker.run(options);
}

module.exports = {
  DEFAULT_BATCH_DELAY_MS,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  DEFAULT_ROOTS,
  IngestWorker,
  SKIP_DIRECTORY_NAMES,
  SKIP_EXTENSIONS,
  SUPPORTED_EXTENSIONS,
  buildTags,
  createDirectIngestClient,
  createIngestApiClient,
  deriveSourceTag,
  describeSkip,
  extractPdfText,
  extractTextFromFile,
  getConfiguredRoots,
  getMatchingRoot,
  getPdfParser,
  hasSkippedDirectory,
  needsReindex,
  normalizeExt,
  normalizeMtimeMs,
  normalizeRoots,
  runIngestScan,
  sleep
};
