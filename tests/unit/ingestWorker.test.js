jest.mock('fs/promises', () => ({
  readFile: jest.fn()
}));

jest.mock('mammoth', () => ({
  extractRawText: jest.fn()
}));

jest.mock('pdf-parse', () => jest.fn());

const fs = require('fs/promises');

const {
  IngestWorker,
  buildTags,
  deriveSourceTag,
  describeSkip,
  needsReindex
} = require('../../src/services/ingestWorker');

describe('ingestWorker utilities', () => {
  it('derives a stable source tag and tags from the first folder beneath the configured root', () => {
    const filePath = '/mnt/datalake/RAG/finance-docs/2026/plan.md';
    const roots = ['/mnt/datalake/RAG', '/mnt/datalake/Finance'];

    expect(deriveSourceTag(filePath, roots)).toBe('finance-docs');
    expect(buildTags(filePath, roots)).toEqual(['auto-ingested', 'finance-docs']);
  });

  it('marks records for reindex when mtime is newer than indexed_at', () => {
    expect(needsReindex({
      mtime: 1710000000,
      indexed_at: '2024-03-08T15:59:59.000Z'
    })).toBe(true);

    expect(needsReindex({
      mtime: 1710000000,
      indexed_at: '2024-03-09T17:00:01.000Z'
    })).toBe(false);
  });

  it('skips keys directories and oversized files', () => {
    expect(describeSkip({
      path: '/mnt/datalake/RAG/agentx-docs/keys/private.txt',
      ext: 'txt',
      size: 128
    }, {
      roots: ['/mnt/datalake/RAG'],
      maxFileSizeBytes: 1024
    })).toEqual({ skip: true, reason: 'skip directory' });

    expect(describeSkip({
      path: '/mnt/datalake/RAG/agentx-docs/big.txt',
      ext: 'txt',
      size: 4096
    }, {
      roots: ['/mnt/datalake/RAG'],
      maxFileSizeBytes: 1024
    })).toEqual({ skip: true, reason: 'file too large: 4096 bytes' });
  });
});

describe('IngestWorker', () => {
  let collection;
  let db;

  beforeEach(() => {
    jest.clearAllMocks();

    collection = {
      find: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 })
    };

    db = {
      collection: jest.fn().mockReturnValue(collection)
    };
  });

  it('ingests new files and updates indexed_at metadata in nas_files', async () => {
    const record = {
      _id: 'doc-1',
      path: '/mnt/datalake/RAG/finance-docs/report.md',
      ext: 'md',
      size: 512,
      mtime: 1710000000
    };

    collection.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([record])
      })
    });
    fs.readFile.mockResolvedValue('# Quarterly update');

    const ingestDocument = jest.fn().mockResolvedValue({
      documentId: record.path,
      chunkCount: 2,
      status: 'created'
    });

    const worker = new IngestWorker({
      db,
      roots: ['/mnt/datalake/RAG'],
      ingestDocument,
      batchDelayMs: 0
    });

    const summary = await worker.run();

    expect(summary.totalCandidates).toBe(1);
    expect(summary.ingested).toBe(1);
    expect(summary.failed).toBe(0);
    expect(ingestDocument).toHaveBeenCalledWith(expect.objectContaining({
      text: '# Quarterly update',
      source: 'finance-docs',
      tags: ['auto-ingested', 'finance-docs'],
      documentId: record.path
    }));
    expect(collection.updateOne).toHaveBeenCalledWith(
      { _id: 'doc-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          indexed_status: 'ingested',
          indexed_document_id: record.path,
          indexed_source: 'finance-docs',
          indexed_tags: ['auto-ingested', 'finance-docs'],
          indexed_error: null
        })
      })
    );
  });

  it('re-ingests changed files and reports them as updated', async () => {
    const record = {
      _id: 'doc-2',
      path: '/mnt/datalake/RAG/agentx-docs/guide.txt',
      ext: 'txt',
      size: 64,
      mtime: 1710001000,
      indexed_at: '2024-03-09T15:00:00.000Z'
    };

    collection.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([record])
      })
    });
    fs.readFile.mockResolvedValue('Updated guide content');

    const worker = new IngestWorker({
      db,
      roots: ['/mnt/datalake/RAG'],
      ingestDocument: jest.fn().mockResolvedValue({
        documentId: record.path,
        chunkCount: 1,
        status: 'created'
      }),
      batchDelayMs: 0
    });

    const summary = await worker.run();

    expect(summary.updated).toBe(1);
    expect(summary.ingested).toBe(0);
    expect(collection.updateOne).toHaveBeenCalledWith(
      { _id: 'doc-2' },
      expect.objectContaining({
        $set: expect.objectContaining({
          indexed_status: 'updated'
        })
      })
    );
  });

  it('records extraction errors and continues instead of throwing', async () => {
    const record = {
      _id: 'doc-3',
      path: '/mnt/datalake/RAG/agentx-docs/broken.json',
      ext: 'json',
      size: 32,
      mtime: 1710002000
    };

    fs.readFile.mockRejectedValue(new Error('ENOENT'));

    const worker = new IngestWorker({
      db,
      roots: ['/mnt/datalake/RAG'],
      ingestDocument: jest.fn(),
      batchDelayMs: 0
    });

    const result = await worker.processRecord(record);

    expect(result).toEqual(expect.objectContaining({
      status: 'failed',
      reason: 'ENOENT',
      path: record.path,
      source: 'agentx-docs'
    }));
    expect(collection.updateOne).toHaveBeenCalledWith(
      { _id: 'doc-3' },
      expect.objectContaining({
        $set: expect.objectContaining({
          indexed_error: 'ENOENT',
          indexed_document_id: record.path
        })
      })
    );
  });
});
