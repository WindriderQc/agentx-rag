'use strict';

jest.mock('../../config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { generateDocumentId, hashText, splitIntoChunks } = require('../../src/services/ragStoreUtils');
const logger = require('../../config/logger');

describe('generateDocumentId', () => {
  it('returns a 32-char hex MD5 hash', () => {
    const id = generateDocumentId('docs', '/path/to/file.md');
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic for the same inputs', () => {
    const a = generateDocumentId('src', 'foo.js');
    const b = generateDocumentId('src', 'foo.js');
    expect(a).toBe(b);
  });

  it('produces different IDs for different sources', () => {
    const a = generateDocumentId('src-a', 'file.js');
    const b = generateDocumentId('src-b', 'file.js');
    expect(a).not.toBe(b);
  });

  it('produces different IDs for different paths', () => {
    const a = generateDocumentId('src', 'a.js');
    const b = generateDocumentId('src', 'b.js');
    expect(a).not.toBe(b);
  });
});

describe('hashText', () => {
  it('returns a 32-char hex MD5 hash', () => {
    expect(hashText('hello world')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic', () => {
    expect(hashText('test')).toBe(hashText('test'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashText('aaa')).not.toBe(hashText('bbb'));
  });
});

describe('splitIntoChunks', () => {
  it('returns at least one chunk for short text', () => {
    const chunks = splitIntoChunks('hello world', 500, 50);
    expect(chunks).toEqual(['hello world']);
  });

  it('does not emit a duplicate tail chunk when the last chunk reaches the end', () => {
    const chunks = splitIntoChunks('a'.repeat(1200), 500, 50);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 300]);
  });

  it('handles text exactly equal to chunkSize', () => {
    const text = 'x'.repeat(500);
    const chunks = splitIntoChunks(text, 500, 50);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it('produces overlapping chunks', () => {
    const text = 'abcdefghij'.repeat(20); // 200 chars
    const chunks = splitIntoChunks(text, 80, 20);
    expect(chunks.length).toBeGreaterThan(1);
    // Verify overlap: tail of chunk N appears at start of chunk N+1
    for (let i = 0; i < chunks.length - 1; i++) {
      const tail = chunks[i].slice(-20);
      expect(chunks[i + 1].startsWith(tail)).toBe(true);
    }
  });

  it('breaks at sentence boundaries when possible', () => {
    const text = 'First sentence here. Second sentence here. Third sentence here. Fourth one.';
    const chunks = splitIntoChunks(text, 45, 0);
    // Should break at ". " rather than mid-word
    expect(chunks[0]).toMatch(/\.$/);
  });

  it('trims whitespace from chunks', () => {
    const text = '   hello   ';
    const chunks = splitIntoChunks(text, 500, 0);
    expect(chunks[0]).toBe('hello');
  });

  it('skips empty chunks after trimming', () => {
    const text = '   ';
    const chunks = splitIntoChunks(text, 500, 0);
    expect(chunks).toHaveLength(0);
  });

  it('enforces the 10000 chunk safety limit', () => {
    const text = 'a'.repeat(20000);
    const chunks = splitIntoChunks(text, 1, 0);
    expect(chunks.length).toBeLessThanOrEqual(10000);
  });

  it('handles overlap larger than chunkSize gracefully via forced advance', () => {
    const text = 'a'.repeat(200);
    const chunks = splitIntoChunks(text, 10, 100);
    // Should not loop forever; forced advance kicks in
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(200);
  });
});
