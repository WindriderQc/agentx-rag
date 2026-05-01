jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');
const QdrantVectorStore = require('../../src/services/vectorStore/QdrantVectorStore');

function makeStore(overrides = {}) {
  return new QdrantVectorStore({
    qdrantUrl: 'http://qdrant:6333',
    collectionName: 'test_embeddings',
    ...overrides,
  });
}

function okJson(data) {
  return { ok: true, json: async () => data, text: async () => JSON.stringify(data) };
}

function failRes(status, body = 'error') {
  return { ok: false, status, text: async () => body };
}

beforeEach(() => fetch.mockReset());

// ── Constructor ──────────────────────────────────────────

describe('QdrantVectorStore constructor', () => {
  it('uses provided config values', () => {
    const store = makeStore();
    expect(store.qdrantUrl).toBe('http://qdrant:6333');
    expect(store.collectionName).toBe('test_embeddings');
  });

  it('falls back to defaults when no config given', () => {
    const store = new QdrantVectorStore();
    expect(store.qdrantUrl).toBe(process.env.QDRANT_URL || 'http://localhost:6333');
  });
});

// ── _generatePointId ─────────────────────────────────────

describe('_generatePointId', () => {
  it('returns a non-negative integer', () => {
    const store = makeStore();
    const id = store._generatePointId('doc1', 0);
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic', () => {
    const store = makeStore();
    expect(store._generatePointId('doc1', 3)).toBe(store._generatePointId('doc1', 3));
  });

  it('differs for different inputs', () => {
    const store = makeStore();
    expect(store._generatePointId('doc1', 0)).not.toBe(store._generatePointId('doc1', 1));
    expect(store._generatePointId('doc1', 0)).not.toBe(store._generatePointId('doc2', 0));
  });
});

// ── _buildMustFilters ────────────────────────────────────

describe('_buildMustFilters', () => {
  let store;
  beforeEach(() => { store = makeStore(); });

  it('returns empty array for null/undefined', () => {
    expect(store._buildMustFilters(null)).toEqual([]);
    expect(store._buildMustFilters(undefined)).toEqual([]);
  });

  it('builds a simple key-value filter', () => {
    expect(store._buildMustFilters({ source: 'docs' })).toEqual([
      { key: 'source', match: { value: 'docs' } },
    ]);
  });

  it('expands tags array into individual filters', () => {
    const result = store._buildMustFilters({ tags: ['a', 'b'] });
    expect(result).toEqual([
      { key: 'tags', match: { value: 'a' } },
      { key: 'tags', match: { value: 'b' } },
    ]);
  });

  it('combines source and tags', () => {
    const result = store._buildMustFilters({ source: 'docs', tags: ['x'] });
    expect(result).toHaveLength(2);
  });
});

// ── _ensureCollection ────────────────────────────────────

describe('_ensureCollection', () => {
  it('skips creation when collection already exists', async () => {
    fetch.mockResolvedValueOnce({ ok: true });
    const store = makeStore();
    await store._ensureCollection(768);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain('/collections/test_embeddings');
  });

  it('creates collection when it does not exist', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    const store = makeStore();
    await store._ensureCollection(768);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, opts] = fetch.mock.calls[1];
    expect(url).toContain('/collections/test_embeddings');
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body);
    expect(body.vectors.size).toBe(768);
    expect(body.vectors.distance).toBe('Cosine');
  });

  it('throws when collection creation fails', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce(failRes(500, 'internal error'));
    const store = makeStore();
    await expect(store._ensureCollection(768)).rejects.toThrow('Failed to create Qdrant collection');
  });
});

// ── upsertDocument ───────────────────────────────────────

describe('upsertDocument', () => {
  it('returns empty status for zero chunks', async () => {
    const store = makeStore();
    const result = await store.upsertDocument('doc1', {}, []);
    expect(result).toEqual({ documentId: 'doc1', chunkCount: 0, status: 'empty' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('deletes existing points then upserts new ones', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true }) // _ensureCollection check
      .mockResolvedValueOnce({ ok: true }) // _deleteByDocumentId
      .mockResolvedValueOnce({ ok: true }); // upsert points

    const store = makeStore();
    const chunks = [
      { embedding: [0.1, 0.2], text: 'chunk0', chunkIndex: 0 },
      { embedding: [0.3, 0.4], text: 'chunk1', chunkIndex: 1 },
    ];

    const result = await store.upsertDocument('doc1', { source: 'test' }, chunks);
    expect(result).toEqual({ documentId: 'doc1', chunkCount: 2, status: 'created' });

    // 3rd call is the PUT with points
    const [url, opts] = fetch.mock.calls[2];
    expect(url).toContain('/points');
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body);
    expect(body.points).toHaveLength(2);
    expect(body.points[0].payload.documentId).toBe('doc1');
  });

  it('batches points in groups of 100', async () => {
    fetch.mockResolvedValue({ ok: true });

    const store = makeStore();
    const chunks = Array.from({ length: 150 }, (_, i) => ({
      embedding: [0.1], text: `chunk${i}`, chunkIndex: i,
    }));

    await store.upsertDocument('bigdoc', { source: 'test' }, chunks);
    // 1 ensureCollection + 1 delete + 2 upsert batches = 4
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('throws when upsert request fails', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true }) // ensureCollection
      .mockResolvedValueOnce({ ok: true }) // delete
      .mockResolvedValueOnce(failRes(500, 'disk full'));

    const store = makeStore();
    const chunks = [{ embedding: [0.1], text: 'c', chunkIndex: 0 }];
    await expect(store.upsertDocument('d', {}, chunks)).rejects.toThrow('Qdrant upsert failed');
  });
});

// ── searchSimilar ────────────────────────────────────────

describe('searchSimilar', () => {
  it('returns mapped results from Qdrant', async () => {
    fetch.mockResolvedValueOnce(okJson({
      result: [
        { payload: { text: 'hello', source: 'docs' }, score: 0.95 },
        { payload: { text: 'world', source: 'docs' }, score: 0.80 },
      ],
    }));

    const store = makeStore();
    const results = await store.searchSimilar([0.1, 0.2], { topK: 5 });
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ text: 'hello', score: 0.95, metadata: { text: 'hello', source: 'docs' } });
  });

  it('caps topK at 20', async () => {
    fetch.mockResolvedValueOnce(okJson({ result: [] }));
    const store = makeStore();
    await store.searchSimilar([0.1], { topK: 100 });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.limit).toBe(20);
  });

  it('includes filters in the request', async () => {
    fetch.mockResolvedValueOnce(okJson({ result: [] }));
    const store = makeStore();
    await store.searchSimilar([0.1], { filters: { source: 'api' } });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.filter.must).toEqual([{ key: 'source', match: { value: 'api' } }]);
  });

  it('throws on non-ok response', async () => {
    fetch.mockResolvedValueOnce(failRes(500, 'search error'));
    const store = makeStore();
    await expect(store.searchSimilar([0.1])).rejects.toThrow('Qdrant search failed');
  });

  it('returns empty array when result is missing', async () => {
    fetch.mockResolvedValueOnce(okJson({}));
    const store = makeStore();
    const results = await store.searchSimilar([0.1]);
    expect(results).toEqual([]);
  });
});

// ── getDocument ──────────────────────────────────────────

describe('getDocument', () => {
  it('returns null when no points found', async () => {
    fetch.mockResolvedValueOnce(okJson({ result: { points: [] } }));
    const store = makeStore();
    expect(await store.getDocument('missing')).toBeNull();
  });

  it('returns document metadata from first point', async () => {
    fetch.mockResolvedValueOnce(okJson({
      result: {
        points: [{ payload: { documentId: 'doc1', source: 'api', tags: ['a'], hash: 'h1' } }],
      },
    }));
    const store = makeStore();
    const doc = await store.getDocument('doc1');
    expect(doc).toEqual({ documentId: 'doc1', source: 'api', tags: ['a'], hash: 'h1' });
  });
});

// ── getDocumentChunks ────────────────────────────────────

describe('getDocumentChunks', () => {
  it('returns chunks sorted by chunkIndex', async () => {
    fetch.mockResolvedValueOnce(okJson({
      result: {
        points: [
          { payload: { text: 'second', chunkIndex: 1 } },
          { payload: { text: 'first', chunkIndex: 0 } },
        ],
      },
    }));
    const store = makeStore();
    const chunks = await store.getDocumentChunks('doc1');
    expect(chunks).toEqual([
      { text: 'first', chunkIndex: 0 },
      { text: 'second', chunkIndex: 1 },
    ]);
  });
});

// ── deleteDocument ───────────────────────────────────────

describe('deleteDocument', () => {
  it('returns true on success', async () => {
    fetch.mockResolvedValueOnce({ ok: true });
    const store = makeStore();
    expect(await store.deleteDocument('doc1')).toBe(true);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.filter.must[0].key).toBe('documentId');
  });

  it('returns false on failure', async () => {
    fetch.mockResolvedValueOnce({ ok: false });
    const store = makeStore();
    expect(await store.deleteDocument('doc1')).toBe(false);
  });
});

// ── listDocuments ────────────────────────────────────────

describe('listDocuments', () => {
  it('deduplicates points into unique documents with chunk counts', async () => {
    fetch.mockResolvedValueOnce(okJson({
      result: {
        points: [
          { payload: { documentId: 'a', source: 's', tags: [] } },
          { payload: { documentId: 'a', source: 's', tags: [] } },
          { payload: { documentId: 'b', source: 's', tags: [] } },
        ],
      },
    }));
    const store = makeStore();
    const docs = await store.listDocuments();
    expect(docs).toHaveLength(2);
    expect(docs.find((d) => d.documentId === 'a').chunkCount).toBe(2);
    expect(docs.find((d) => d.documentId === 'b').chunkCount).toBe(1);
  });
});

// ── getStats ─────────────────────────────────────────────

describe('getStats', () => {
  it('includes deduplicated document count', async () => {
    fetch
      .mockResolvedValueOnce(okJson({
        result: {
          points_count: 4,
          status: 'green',
          config: { params: { vectors: { size: 768 } } },
        },
      }))
      .mockResolvedValueOnce(okJson({
        result: {
          points: [
            { payload: { documentId: 'doc-a' } },
            { payload: { documentId: 'doc-a' } },
            { payload: { documentId: 'doc-b' } },
            { payload: { documentId: 'doc-c' } },
          ],
        },
      }));

    const store = makeStore();
    const stats = await store.getStats();
    expect(stats).toEqual({
      documentCount: 3,
      chunkCount: 4,
      vectorDimension: 768,
      status: 'green',
    });
  });

  it('returns zeroes when collection fetch fails', async () => {
    fetch.mockResolvedValueOnce(failRes(404));
    const store = makeStore();
    const stats = await store.getStats();
    expect(stats).toEqual({ documentCount: 0, chunkCount: 0 });
  });

  it('returns error on network failure', async () => {
    fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const store = makeStore();
    const stats = await store.getStats();
    expect(stats).toEqual({ error: 'ECONNREFUSED' });
  });
});

// ── healthCheck ──────────────────────────────────────────

describe('healthCheck', () => {
  it('returns healthy when Qdrant responds ok', async () => {
    fetch.mockResolvedValueOnce({ ok: true });
    const store = makeStore();
    const health = await store.healthCheck();
    expect(health).toEqual({ healthy: true, type: 'qdrant', url: 'http://qdrant:6333' });
  });

  it('returns unhealthy on network error', async () => {
    fetch.mockRejectedValueOnce(new Error('timeout'));
    const store = makeStore();
    const health = await store.healthCheck();
    expect(health).toEqual({ healthy: false, type: 'qdrant', error: 'timeout' });
  });
});
