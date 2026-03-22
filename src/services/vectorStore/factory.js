/**
 * Vector Store Factory — creates the configured vector store instance.
 */

const logger = require('../../../config/logger');

function createVectorStore(config = {}) {
  const type = config.type || process.env.VECTOR_STORE_TYPE || 'memory';

  if (type === 'qdrant') {
    const QdrantVectorStore = require('./QdrantVectorStore');
    logger.info('Using Qdrant vector store');
    return new QdrantVectorStore(config);
  }

  const InMemoryVectorStore = require('./InMemoryVectorStore');
  logger.info('Using in-memory vector store (data will not persist across restarts)');
  return new InMemoryVectorStore(config);
}

module.exports = { createVectorStore };
