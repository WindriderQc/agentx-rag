jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');
const QdrantVectorStore = require('../../src/services/vectorStore/QdrantVectorStore');

describe('QdrantVectorStore.getStats', () => {
  beforeEach(() => {
    fetch.mockReset();
  });

  it('includes a deduplicated document count for status consumers', async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            points_count: 4,
            status: 'green',
            config: { params: { vectors: { size: 768 } } }
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            points: [
              { payload: { documentId: 'doc-a' } },
              { payload: { documentId: 'doc-a' } },
              { payload: { documentId: 'doc-b' } },
              { payload: { documentId: 'doc-c' } }
            ]
          }
        })
      });

    const store = new QdrantVectorStore({
      qdrantUrl: 'http://qdrant:6333',
      collectionName: 'agentx_embeddings'
    });

    await expect(store.getStats()).resolves.toEqual({
      documentCount: 3,
      chunkCount: 4,
      vectorDimension: 768,
      status: 'green'
    });
  });
});
