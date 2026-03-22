/**
 * Embeddings Service for AgentX RAG
 *
 * Generates vector embeddings by proxying through core's inference endpoint.
 * Does NOT call Ollama directly — all embedding requests go through
 * CORE_PROXY_URL/api/inference/embed.
 */

const fetch = require('node-fetch');
const logger = require('../../config/logger');

class EmbeddingsService {
  constructor(config = {}) {
    this.coreProxyUrl = config.coreProxyUrl || process.env.CORE_PROXY_URL || 'http://localhost:3080';
    this.model = config.embeddingModel || process.env.EMBEDDING_MODEL || 'nomic-embed-text:v1.5';
    this.dimension = config.dimension || Number(process.env.EMBEDDING_DIMENSION) || 768;
    this.batchSize = 10;
  }

  async embedTextBatch(texts, ollamaHost = null) {
    if (!Array.isArray(texts) || texts.length === 0) {
      throw new Error('texts must be a non-empty array');
    }

    const results = [];

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const batchResults = await Promise.all(
        batch.map(text => this._embedSingle(text, ollamaHost))
      );
      results.push(...batchResults);
    }

    return results;
  }

  async _embedSingle(text, ollamaHost = null) {
    if (!text || typeof text !== 'string') {
      throw new Error('text must be a non-empty string');
    }

    const truncatedText = text.length > 8000 ? text.substring(0, 8000) : text;
    return this._generateEmbedding(truncatedText, ollamaHost);
  }

  async _generateEmbedding(text, ollamaHost) {
    const url = `${this.coreProxyUrl}/api/inference/embed`;

    try {
      const body = {
        model: this.model,
        prompt: text,
      };
      if (ollamaHost) {
        body.ollamaHost = ollamaHost;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Core embed proxy error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      if (!data.embedding || !Array.isArray(data.embedding)) {
        throw new Error('Invalid response from core embed proxy');
      }

      return data.embedding;
    } catch (error) {
      logger.error('Error generating embedding via core proxy', { error: error.message });
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  getDimension() {
    return this.dimension;
  }

  async testConnection() {
    try {
      const embedding = await this._embedSingle('test');
      return Array.isArray(embedding) && embedding.length === this.dimension;
    } catch (error) {
      logger.error('Embeddings connection test failed', { error: error.message });
      return false;
    }
  }

  destroy() {}

  static cosineSimilarity(vec1, vec2) {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }
}

let embeddingsServiceInstance = null;

function getEmbeddingsService(config = {}) {
  if (!embeddingsServiceInstance) {
    embeddingsServiceInstance = new EmbeddingsService(config);
    logger.info('EmbeddingsService initialized (core proxy mode)', { model: embeddingsServiceInstance.model });
  }
  return embeddingsServiceInstance;
}

function resetEmbeddingsService() {
  if (!embeddingsServiceInstance) return;
  embeddingsServiceInstance.destroy();
  embeddingsServiceInstance = null;
}

module.exports = {
  EmbeddingsService,
  getEmbeddingsService,
  resetEmbeddingsService,
};
