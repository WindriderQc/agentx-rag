'use strict';
/**
 * RAG Store Utilities — pure helper functions.
 */

const crypto = require('crypto');
const logger = require('../../config/logger');

function generateDocumentId(source, filePath) {
  const combined = `${source}:${filePath}`;
  return crypto.createHash('md5').update(combined).digest('hex');
}

function hashText(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

function splitIntoChunks(text, chunkSize, chunkOverlap) {
  const chunks = [];
  let start = 0;
  const MAX_CHUNKS = 10000;

  while (start < text.length) {
    if (chunks.length >= MAX_CHUNKS) {
      logger.error('Chunking safety limit reached', {
        chunkCount: chunks.length, chunkSize, chunkOverlap, textLength: text.length
      });
      break;
    }

    let end = Math.min(start + chunkSize, text.length);

    if (end < text.length) {
      const breakPoint = text.lastIndexOf('. ', end);
      if (breakPoint > start && breakPoint > start + chunkSize * 0.5) {
        end = breakPoint + 1;
      }
    }

    const chunk = text.substring(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    if (end >= text.length) {
      break;
    }

    const minAdvance = Math.max(50, Math.floor(chunkSize * 0.1));
    const overlap = Math.min(chunkOverlap, chunkSize - minAdvance);
    const nextStart = end - overlap;

    if (nextStart <= start) {
      const oldStart = start;
      start = oldStart + minAdvance;
      logger.warn('Chunking forced advance', {
        oldStart, newStart: start, chunkSize, chunkOverlap, minAdvance
      });
    } else {
      start = nextStart;
    }

    if (start >= text.length) break;
  }

  return chunks;
}

module.exports = { generateDocumentId, hashText, splitIntoChunks };
