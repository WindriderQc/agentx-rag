/**
 * Abstract Vector Store Interface
 */

class VectorStoreAdapter {
  constructor(config = {}) {
    if (this.constructor === VectorStoreAdapter) {
      throw new Error('VectorStoreAdapter is an abstract class');
    }
    this.config = config;
  }

  async upsertDocument(_documentId, _metadata, _chunks) {
    throw new Error('upsertDocument() must be implemented');
  }

  async searchSimilar(_queryEmbedding, _options = {}) {
    throw new Error('searchSimilar() must be implemented');
  }

  async getDocument(_documentId) {
    throw new Error('getDocument() must be implemented');
  }

  async listDocuments(_filters = {}, _pagination = {}) {
    throw new Error('listDocuments() must be implemented');
  }

  async getDocumentChunks(_documentId) {
    throw new Error('getDocumentChunks() must be implemented');
  }

  async deleteDocument(_documentId) {
    throw new Error('deleteDocument() must be implemented');
  }

  async getStats() {
    throw new Error('getStats() must be implemented');
  }

  async healthCheck() {
    throw new Error('healthCheck() must be implemented');
  }
}

module.exports = VectorStoreAdapter;
