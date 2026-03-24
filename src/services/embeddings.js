const logger = require('../../config/logger');
const CoreProxyProvider = require('./embeddings/coreProxyProvider');
const OllamaProvider = require('./embeddings/ollamaProvider');

function createEmbeddingsProvider(config = {}) {
  const providerName = (config.embeddingProvider || process.env.EMBEDDING_PROVIDER || 'ollama-direct')
    .trim()
    .toLowerCase();

  switch (providerName) {
    case 'ollama-direct':
      return new OllamaProvider(config);
    case 'core-proxy':
      return new CoreProxyProvider(config);
    default:
      throw new Error(`Unsupported embedding provider: ${providerName}`);
  }
}

class EmbeddingsService {
  constructor(config = {}) {
    this.provider = createEmbeddingsProvider(config);
    this.providerName = this.provider.name;
    this.model = this.provider.model;
    this.dimension = this.provider.getDimension();
  }

  async embed(text, preferredHost = null) {
    return this.provider.embed(text, preferredHost);
  }

  async embedBatch(texts, preferredHost = null) {
    return this.provider.embedBatch(texts, preferredHost);
  }

  async embedTextBatch(texts, preferredHost = null) {
    return this.embedBatch(texts, preferredHost);
  }

  getDimension() {
    return this.provider.getDimension();
  }

  async testConnection() {
    return this.provider.testConnection();
  }

  destroy() {
    if (typeof this.provider.destroy === 'function') {
      this.provider.destroy();
    }
  }

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
    logger.info('EmbeddingsService initialized', {
      model: embeddingsServiceInstance.model,
      provider: embeddingsServiceInstance.providerName
    });
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
  createEmbeddingsProvider,
  getEmbeddingsService,
  resetEmbeddingsService,
};
