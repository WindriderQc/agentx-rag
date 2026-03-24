# AgentX RAG — Knowledge Service

> Standalone retrieval-augmented generation service for the AgentX ecosystem. Ingests documents, generates embeddings, stores vectors, and serves semantic search.

See parent `../CLAUDE.md` for shared infrastructure (MongoDB, Ollama hosts, conventions).

## Service Info

- **Port:** 3082
- **Entry:** `server.js`
- **Database:** shared `agentx` (collection-level ownership)

---

## Current API

All responses use the envelope: `{ ok: true/false, data?: ..., error?: "message", detail?: "..." }`

### Ingestion

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rag/ingest` | POST | Ingest a text document with chunking + embedding |
| `/api/rag/documents` | POST | Alias for `/ingest` |

**Ingest body:**
```json
{
  "text": "document content (required)",
  "source": "source-name (default: 'api')",
  "tags": ["optional", "array"],
  "documentId": "optional-override",
  "chunkSize": 500,
  "chunkOverlap": 50
}
```

### Search

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rag/search` | POST | Semantic vector search across chunks |

**Search body:**
```json
{
  "query": "search text (required)",
  "topK": 5,
  "minScore": 0.0,
  "filters": { "source": "docs", "tags": ["tag1"] }
}
```

### Documents

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rag/documents` | GET | List documents (filterable: `?source=X&tags=a,b`) |
| `/api/rag/documents/:id` | DELETE | Delete a document and its chunks |

### Status

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Basic liveness check |
| `/api/rag/status` | GET | Service stats (document count, chunk count, vector store health) |

---

## Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| **Embeddings provider** | **CRITICAL** | Currently: core proxy (`CORE_PROXY_URL/api/inference/embed`). Being migrated to pluggable provider with direct Ollama support. |
| MongoDB | Shared DB | Connected; `RagManifest` model exists but manifest routes are being added |
| Qdrant | Production store | Vector store when `VECTOR_STORE_TYPE=qdrant`; falls back to in-memory |

## Collection Ownership

Per ecosystem CLAUDE.md, RAG owns:
- `ragmanifests` — Folder scan manifests
- `embeddingcachestats` — Cache performance counters (planned)

RAG must NOT write to collections owned by other services.

## Architecture

- **RagStore** (`src/services/ragStore.js`) — Thin orchestrator: coordinates embeddings + vector store
- **EmbeddingsService** (`src/services/embeddings.js`) — Generates vector embeddings (provider-based)
- **VectorStore** (`src/services/vectorStore/`) — Pluggable storage: in-memory (dev) or Qdrant (prod)
- **ragStoreUtils** (`src/services/ragStoreUtils.js`) — Chunking with sentence-boundary awareness, document ID generation

### Document Identity

- Default: MD5 of `source:filePath` (via `generateDocumentId`)
- Override: caller-provided `documentId`
- Chunks stored with `documentId + chunkIndex` as compound identity

### Chunking

- Default chunk size: 500 chars, overlap: 50 chars
- Sentence-boundary aware (breaks at `. ` when possible)
- Safety limit: 10,000 chunks max per document

## Directory Structure

```
rag/
├── server.js                    — Bootstrap, Mongo init, error handlers
├── app.js                       — CORS, /health, route mounting
├── package.json
├── .env / .env.example
├── CLAUDE.md                    — This file
├── AGENTS.md                    — Agent integration guide
├── config/
│   ├── db.js                    — MongoDB connection
│   └── logger.js                — Winston logger (console + file)
├── models/
│   └── RagManifest.js           — Mongoose schema for folder scan manifests
├── routes/
│   └── rag.js                   — Core RAG API endpoints
├── src/
│   ├── services/
│   │   ├── embeddings.js        — Embedding provider facade
│   │   ├── ragStore.js          — Orchestrator (embed + store)
│   │   └── ragStoreUtils.js     — Chunking + hashing utilities
│   ├── services/vectorStore/
│   │   ├── VectorStoreAdapter.js    — Abstract interface (8 methods)
│   │   ├── InMemoryVectorStore.js   — Dev/test adapter
│   │   ├── QdrantVectorStore.js     — Production Qdrant adapter
│   │   └── factory.js               — Store factory
│   └── utils/
│       └── cosineSimilarity.js      — Shared cosine similarity function
└── tests/
    └── unit/
        ├── ragStoreUtils.test.js
        └── qdrantVectorStore.test.js
```

## Environment Variables

```env
PORT=3082
MONGODB_URI=mongodb://192.168.2.33:27017/agentx
VECTOR_STORE_TYPE=qdrant              # qdrant | memory
QDRANT_URL=http://192.168.2.33:6333
QDRANT_COLLECTION=agentx_embeddings
EMBEDDING_MODEL=nomic-embed-text:v1.5
EMBEDDING_DIMENSION=768
CORE_PROXY_URL=http://localhost:3080
CORS_ORIGINS=http://localhost:3080,http://localhost:3082
```

## Running

```bash
# Production (via PM2 from parent)
pm2 start ecosystem.config.js

# Development
cd rag && npm run dev

# Tests
cd rag && npm test
```
