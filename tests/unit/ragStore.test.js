const { RagStore, resetRagStore } = require('../../src/services/ragStore');
const { resetEmbeddingsService } = require('../../src/services/embeddings');

describe('RagStore (in-memory, mocked embeddings)', () => {
  let store;
  const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];

  beforeEach(() => {
    resetRagStore();
    resetEmbeddingsService();

    store = new RagStore({ type: 'memory' });
    // Mock the embeddings service to avoid network calls
    store.embeddingsService = {
      embedTextBatch: jest.fn(async (texts) =>
        texts.map(() => [...mockEmbedding])
      ),
    };
  });

  test('upsertDocumentWithChunks creates chunks and returns result', async () => {
    const result = await store.upsertDocumentWithChunks('Hello world. This is a test document.', {
      source: 'test-source',
      tags: ['unit-test'],
    });

    expect(result.documentId).toBeDefined();
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
    expect(result.status).toBe('created');
  });

  test('upsertDocumentWithChunks with custom documentId', async () => {
    const result = await store.upsertDocumentWithChunks('Some content', {
      source: 'test',
      documentId: 'custom-id-123',
    });

    expect(result.documentId).toBe('custom-id-123');
  });

  test('searchSimilarChunks returns results', async () => {
    await store.upsertDocumentWithChunks('Test content for search', {
      source: 'test',
    });

    const results = await store.searchSimilarChunks('test query', { topK: 3 });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]).toHaveProperty('text');
    expect(results[0]).toHaveProperty('score');
  });

  test('listDocuments returns ingested docs', async () => {
    await store.upsertDocumentWithChunks('Doc one', { source: 'src-a' });
    await store.upsertDocumentWithChunks('Doc two', { source: 'src-b' });

    const docs = await store.listDocuments();
    expect(docs).toHaveLength(2);
  });

  test('deleteDocument removes a document', async () => {
    await store.upsertDocumentWithChunks('To be deleted', {
      source: 'test',
      documentId: 'delete-me',
    });

    const deleted = await store.deleteDocument('delete-me');
    expect(deleted).toBe(true);

    const docs = await store.listDocuments();
    expect(docs).toHaveLength(0);
  });

  test('getStats returns store statistics', async () => {
    await store.upsertDocumentWithChunks('Stats test content', { source: 'test' });

    const stats = await store.getStats();
    expect(stats.documentCount).toBe(1);
    expect(stats.chunkCount).toBeGreaterThanOrEqual(1);
    expect(stats).toHaveProperty('vectorStore');
  });

  test('throws on empty text', async () => {
    await expect(
      store.upsertDocumentWithChunks('', { source: 'test' })
    ).rejects.toThrow();
  });

  test('embeddings service called with chunk texts', async () => {
    await store.upsertDocumentWithChunks('A short doc', { source: 'test' });

    expect(store.embeddingsService.embedTextBatch).toHaveBeenCalledTimes(1);
    const callArg = store.embeddingsService.embedTextBatch.mock.calls[0][0];
    expect(Array.isArray(callArg)).toBe(true);
    expect(callArg.length).toBeGreaterThanOrEqual(1);
  });

  test('hash match returns unchanged without re-ingesting', async () => {
    // First ingest to populate
    await store.upsertDocumentWithChunks('Original text', {
      source: 'test',
      documentId: 'hash-test',
      hash: 'abc123'
    });

    // Second ingest with same hash
    const result = await store.upsertDocumentWithChunks('Same text', {
      source: 'test',
      documentId: 'hash-test',
      hash: 'abc123'
    });

    expect(result).toEqual({ unchanged: true, documentId: 'hash-test' });
    // embeddings should only be called once (first ingest)
    expect(store.embeddingsService.embedTextBatch).toHaveBeenCalledTimes(1);
  });
});
