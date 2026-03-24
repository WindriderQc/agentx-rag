jest.mock('node-fetch', () => jest.fn());

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('Embeddings providers', () => {
  const originalEnv = process.env;
  let fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    fetch = require('node-fetch');
    fetch.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('selects the direct Ollama provider by default', () => {
    process.env.OLLAMA_HOSTS = 'alpha:11434';

    const { getEmbeddingsService, resetEmbeddingsService } = require('../../src/services/embeddings');
    const service = getEmbeddingsService();

    expect(service.providerName).toBe('ollama-direct');
    expect(typeof service.embed).toBe('function');

    resetEmbeddingsService();
  });

  it('selects the core proxy provider when configured', () => {
    process.env.EMBEDDING_PROVIDER = 'core-proxy';

    const { getEmbeddingsService, resetEmbeddingsService } = require('../../src/services/embeddings');
    const service = getEmbeddingsService();

    expect(service.providerName).toBe('core-proxy');

    resetEmbeddingsService();
  });

  it('rotates Ollama hosts in round-robin order', async () => {
    const OllamaProvider = require('../../src/services/embeddings/ollamaProvider');

    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] })
    });

    const provider = new OllamaProvider({
      ollamaHosts: 'alpha:11434,beta:11434,gamma:11434'
    });

    await provider.embed('first');
    await provider.embed('second');
    await provider.embed('third');

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://alpha:11434/api/embeddings',
      'http://beta:11434/api/embeddings',
      'http://gamma:11434/api/embeddings'
    ]);
  });

  it('falls back to the next Ollama host when the current one fails', async () => {
    const OllamaProvider = require('../../src/services/embeddings/ollamaProvider');

    fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'boom'
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: [1, 2, 3] })
      });

    const provider = new OllamaProvider({
      ollamaHosts: 'alpha:11434,beta:11434'
    });

    await expect(provider.embed('hello')).resolves.toEqual([1, 2, 3]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://alpha:11434/api/embeddings',
      'http://beta:11434/api/embeddings'
    ]);
  });

  it('splits batch embedding work into groups of 10', async () => {
    const OllamaProvider = require('../../src/services/embeddings/ollamaProvider');
    const deferredResponses = [];

    fetch.mockImplementation(() => new Promise((resolve) => {
      deferredResponses.push(resolve);
    }));

    const provider = new OllamaProvider({ ollamaHosts: 'alpha:11434' });
    const batchPromise = provider.embedBatch(
      Array.from({ length: 25 }, (_, index) => `text-${index}`)
    );

    await flushPromises();
    expect(fetch).toHaveBeenCalledTimes(10);

    deferredResponses.splice(0, 10).forEach((resolve) => resolve({
      ok: true,
      json: async () => ({ embedding: [1, 2, 3] })
    }));

    await flushPromises();
    expect(fetch).toHaveBeenCalledTimes(20);

    deferredResponses.splice(0, 10).forEach((resolve) => resolve({
      ok: true,
      json: async () => ({ embedding: [1, 2, 3] })
    }));

    await flushPromises();
    expect(fetch).toHaveBeenCalledTimes(25);

    deferredResponses.splice(0, 5).forEach((resolve) => resolve({
      ok: true,
      json: async () => ({ embedding: [1, 2, 3] })
    }));

    await expect(batchPromise).resolves.toHaveLength(25);
  });

  it('truncates text to 8000 characters before requesting embeddings', async () => {
    const OllamaProvider = require('../../src/services/embeddings/ollamaProvider');

    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] })
    });

    const provider = new OllamaProvider({ ollamaHosts: 'alpha:11434' });

    await provider.embed('x'.repeat(9000));

    const [, options] = fetch.mock.calls[0];
    expect(JSON.parse(options.body).prompt).toHaveLength(8000);
  });
});
