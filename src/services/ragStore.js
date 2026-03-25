/**
 * RAG Store — orchestrates embeddings + vector store for document ingestion and search.
 */

const logger = require('../../config/logger');
const { getEmbeddingsService } = require('./embeddings');
const { createVectorStore } = require('./vectorStore/factory');
const { generateDocumentId, splitIntoChunks } = require('./ragStoreUtils');

let instance = null;

class RagStore {
  constructor(config = {}) {
    this.vectorStore = createVectorStore(config);
    this.embeddingsService = getEmbeddingsService();
    this.defaultChunkSize = config.chunkSize || 500;
    this.defaultChunkOverlap = config.chunkOverlap || 50;
  }

  async upsertDocumentWithChunks(text, metadata = {}) {
    const documentId = metadata.documentId || generateDocumentId(metadata.source || 'unknown', text);
    const chunkSize = metadata.chunkSize || this.defaultChunkSize;
    const chunkOverlap = metadata.chunkOverlap || this.defaultChunkOverlap;

    // Content hash unchanged detection — skip re-ingestion if hash matches
    if (metadata.hash) {
      const existing = await this.vectorStore.getDocument(documentId);
      if (existing && existing.hash === metadata.hash) {
        logger.info(`Document "${documentId}" unchanged (hash match) — skipping ingestion`);
        return { unchanged: true, documentId };
      }
    }

    const textChunks = splitIntoChunks(text, chunkSize, chunkOverlap);
    if (textChunks.length === 0) {
      throw new Error('No chunks generated from text');
    }

    // Get embeddings for all chunks
    const embeddings = await this.embeddingsService.embedTextBatch(textChunks);

    const chunks = textChunks.map((chunkText, i) => ({
      text: chunkText,
      embedding: embeddings[i],
      chunkIndex: i
    }));

    const result = await this.vectorStore.upsertDocument(documentId, {
      source: metadata.source,
      tags: metadata.tags || [],
      ...(metadata.hash ? { hash: metadata.hash } : {}),
    }, chunks);

    logger.info(`Upserted document "${documentId}" — ${chunks.length} chunks`);
    return result;
  }

  async searchSimilarChunks(query, options = {}) {
    const [queryEmbedding] = await this.embeddingsService.embedTextBatch([query]);
    return this.vectorStore.searchSimilar(queryEmbedding, options);
  }

  async listDocuments(filters = {}) {
    return this.vectorStore.listDocuments(filters);
  }

  async deleteDocument(documentId) {
    return this.vectorStore.deleteDocument(documentId);
  }

  async getStats() {
    const storeStats = await this.vectorStore.getStats();
    const health = await this.vectorStore.healthCheck();
    return {
      ...storeStats,
      embeddingModel: this.embeddingsService.model,
      vectorStore: health,
    };
  }
}

function getRagStore(config) {
  if (!instance) {
    instance = new RagStore(config);
  }
  return instance;
}

function resetRagStore() {
  instance = null;
}

module.exports = { RagStore, getRagStore, resetRagStore };
