/**
 * Qdrant Vector Store — production vector store adapter.
 */

const VectorStoreAdapter = require('./VectorStoreAdapter');
const fetch = require('node-fetch');
const logger = require('../../../config/logger');

class QdrantVectorStore extends VectorStoreAdapter {
  constructor(config = {}) {
    super(config);
    this.qdrantUrl = config.qdrantUrl || process.env.QDRANT_URL || 'http://localhost:6333';
    this.collectionName = config.collectionName || process.env.QDRANT_COLLECTION || 'agentx_embeddings';
  }

  async _ensureCollection(vectorSize) {
    try {
      const res = await fetch(`${this.qdrantUrl}/collections/${this.collectionName}`);
      if (res.ok) return;
    } catch (e) { /* doesn't exist yet */ }

    const body = {
      vectors: { size: vectorSize, distance: 'Cosine' }
    };
    const res = await fetch(`${this.qdrantUrl}/collections/${this.collectionName}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create Qdrant collection: ${res.status} ${text}`);
    }
    logger.info(`Created Qdrant collection "${this.collectionName}" with vector size ${vectorSize}`);
  }

  _generatePointId(documentId, chunkIndex) {
    let hash = 0;
    const str = `${documentId}:${chunkIndex}`;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash);
  }

  _buildMustFilters(filters) {
    const must = [];
    if (!filters) return must;
    Object.keys(filters).forEach(key => {
      if (key === 'tags' && Array.isArray(filters.tags)) {
        filters.tags.forEach(tag => {
          must.push({ key: 'tags', match: { value: tag } });
        });
      } else {
        must.push({ key, match: { value: filters[key] } });
      }
    });
    return must;
  }

  async upsertDocument(documentId, metadata, chunks) {
    if (!chunks.length) return { documentId, chunkCount: 0, status: 'empty' };

    const vectorSize = chunks[0].embedding.length;
    await this._ensureCollection(vectorSize);

    // Delete existing chunks for this document first
    await this._deleteByDocumentId(documentId);

    const points = chunks.map(chunk => ({
      id: this._generatePointId(documentId, chunk.chunkIndex),
      vector: chunk.embedding,
      payload: {
        documentId,
        text: chunk.text,
        chunkIndex: chunk.chunkIndex,
        ...metadata
      }
    }));

    const batchSize = 100;
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      const res = await fetch(`${this.qdrantUrl}/collections/${this.collectionName}/points`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: batch })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Qdrant upsert failed: ${res.status} ${text}`);
      }
    }

    return { documentId, chunkCount: chunks.length, status: 'created' };
  }

  async searchSimilar(queryEmbedding, options = {}) {
    const topK = Math.min(options.topK || 5, 20);
    const minScore = options.minScore !== undefined ? options.minScore : 0.0;
    const filters = options.filters || {};
    const must = this._buildMustFilters(filters);

    const body = {
      vector: queryEmbedding,
      limit: topK,
      score_threshold: minScore,
      with_payload: true,
    };
    if (must.length > 0) body.filter = { must };

    const res = await fetch(`${this.qdrantUrl}/collections/${this.collectionName}/points/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Qdrant search failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    return (data.result || []).map(hit => ({
      text: hit.payload.text,
      score: hit.score,
      metadata: hit.payload
    }));
  }

  async getDocument(documentId) {
    const results = await this._scrollByFilter({ key: 'documentId', match: { value: documentId } }, 1);
    if (results.length === 0) return null;
    const payload = results[0].payload;
    return { documentId, source: payload.source, tags: payload.tags };
  }

  async listDocuments(filters = {}) {
    const must = this._buildMustFilters(filters);
    const allPoints = await this._scrollByFilter(must.length === 1 ? must[0] : null, 10000, must.length > 1 ? { must } : null);

    const docMap = new Map();
    for (const pt of allPoints) {
      const docId = pt.payload.documentId;
      if (!docMap.has(docId)) {
        docMap.set(docId, {
          documentId: docId,
          source: pt.payload.source,
          tags: pt.payload.tags,
          chunkCount: 0
        });
      }
      docMap.get(docId).chunkCount++;
    }
    return Array.from(docMap.values());
  }

  async getDocumentChunks(documentId) {
    const points = await this._scrollByFilter({ key: 'documentId', match: { value: documentId } }, 10000);
    return points
      .map(pt => ({ text: pt.payload.text, chunkIndex: pt.payload.chunkIndex || 0 }))
      .sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  async deleteDocument(documentId) {
    return this._deleteByDocumentId(documentId);
  }

  async _deleteByDocumentId(documentId) {
    const res = await fetch(`${this.qdrantUrl}/collections/${this.collectionName}/points/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filter: { must: [{ key: 'documentId', match: { value: documentId } }] }
      })
    });
    return res.ok;
  }

  async _scrollByFilter(singleFilter, limit, fullFilter) {
    const body = { limit: limit || 100, with_payload: true };
    if (fullFilter) {
      body.filter = fullFilter;
    } else if (singleFilter) {
      body.filter = { must: [singleFilter] };
    }

    const res = await fetch(`${this.qdrantUrl}/collections/${this.collectionName}/points/scroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.result?.points || [];
  }

  async getStats() {
    try {
      const res = await fetch(`${this.qdrantUrl}/collections/${this.collectionName}`);
      if (!res.ok) return { documentCount: 0, chunkCount: 0 };
      const data = await res.json();
      const info = data.result;
      return {
        chunkCount: info.points_count || 0,
        vectorDimension: info.config?.params?.vectors?.size || 0,
        status: info.status
      };
    } catch (e) {
      return { error: e.message };
    }
  }

  async healthCheck() {
    try {
      const res = await fetch(`${this.qdrantUrl}/collections`);
      return { healthy: res.ok, type: 'qdrant', url: this.qdrantUrl };
    } catch (e) {
      return { healthy: false, type: 'qdrant', error: e.message };
    }
  }
}

module.exports = QdrantVectorStore;
