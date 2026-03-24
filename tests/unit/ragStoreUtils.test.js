const { splitIntoChunks } = require('../../src/services/ragStoreUtils');

describe('splitIntoChunks', () => {
  it('does not emit a duplicate tail chunk when the last chunk reaches the end', () => {
    const chunks = splitIntoChunks('a'.repeat(1200), 500, 50);

    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.length)).toEqual([500, 500, 300]);
  });

  it('still returns at least one chunk for short text', () => {
    const chunks = splitIntoChunks('hello world', 500, 50);

    expect(chunks).toEqual(['hello world']);
  });
});
