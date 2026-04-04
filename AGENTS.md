# AgentX RAG — Agent Integration Guide

> Full API reference: see `API.md` in this directory.

## Service Purpose

agentx-rag is the knowledge retrieval service for the AgentX ecosystem. It accepts documents, chunks them, generates vector embeddings, and serves semantic search results. Other services (especially agentx-core's chat pipeline) consume it for context augmentation.

**Base URL:** `http://localhost:3082`
**Dashboard:** `http://localhost:3082/` (browser UI for documents, search, ingest, metrics)

## Quick Start for Agents

### 1. Check health before using RAG

Always verify the service is reachable and its dependencies are healthy before making API calls.

```bash
curl -s http://localhost:3082/health
```

Expected response (HTTP 200):

```json
{ "status": "ok", "service": "agentx-rag", "port": 3082, "db": "connected" }
```

For deeper dependency checks (Qdrant, embedding provider, MongoDB):

```bash
curl -s http://localhost:3082/api/rag/status
```

Expected response:

```json
{
  "ok": true,
  "data": {
    "documentCount": 12,
    "chunkCount": 340,
    "vectorDimension": 768,
    "vectorStore": { "healthy": true, "type": "qdrant" },
    "dependencies": {
      "mongodb": { "healthy": true },
      "embedding": { "healthy": true, "provider": "ollama-direct", "model": "nomic-embed-text:v1.5" },
      "qdrant": { "healthy": true }
    },
    "healthy": true
  }
}
```

If `data.healthy` is false, check `data.dependencies` to identify which component is down. RAG cannot serve search results if the embedding provider or vector store is unavailable.

### 2. Ingest a document

```bash
curl -s -X POST http://localhost:3082/api/rag/ingest \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "AgentX is a local-first AI operations platform. It provides inference proxying, model management, cluster scheduling, and knowledge retrieval.",
    "source": "my-agent",
    "tags": ["code", "docs"]
  }'
```

Expected response:

```json
{
  "ok": true,
  "data": { "documentId": "a1b2c3d4e5f6", "chunkCount": 1, "status": "ok" }
}
```

To re-ingest a document (update it), pass the same `documentId`:

```bash
curl -s -X POST http://localhost:3082/api/rag/ingest \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "Updated content...",
    "source": "my-agent",
    "documentId": "a1b2c3d4e5f6"
  }'
```

### 3. Search for relevant context

```bash
curl -s -X POST http://localhost:3082/api/rag/search \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "How does the alert system work?",
    "topK": 5,
    "minScore": 0.3
  }'
```

Expected response:

```json
{
  "ok": true,
  "data": {
    "results": [
      {
        "text": "The alert system monitors host metrics and triggers notifications when thresholds are exceeded...",
        "score": 0.87,
        "metadata": { "source": "docs", "documentId": "abc123", "chunkIndex": 2 }
      }
    ],
    "count": 1
  }
}
```

For higher-quality results at the cost of latency, enable advanced search features:

```bash
curl -s -X POST http://localhost:3082/api/rag/search \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "How does the alert system work?",
    "topK": 5,
    "hybrid": true,
    "rerank": true
  }'
```

### 4. List indexed documents

```bash
curl -s "http://localhost:3082/api/rag/documents?limit=10&offset=0"
```

Expected response:

```json
{
  "ok": true,
  "data": {
    "documents": [
      { "documentId": "abc123", "source": "docs", "chunkCount": 7, "tags": ["api"] }
    ],
    "total": 1,
    "limit": 10,
    "offset": 0
  }
}
```

### 5. Delete a document

```bash
curl -s -X DELETE http://localhost:3082/api/rag/documents/abc123
```

Expected response:

```json
{ "ok": true, "data": { "documentId": "abc123" } }
```

## How to Use RAG from Core Chat Pipeline

This is the HTTP call pattern for augmenting a chat response with RAG context. A calling service (e.g. core) should:

**Step 1 — Verify RAG is available (cache this for ~60s):**

```bash
curl -sf http://localhost:3082/health > /dev/null && echo "RAG is up"
```

**Step 2 — Search for context using the user's message:**

```bash
curl -s -X POST http://localhost:3082/api/rag/search \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "What models are available on UGClawdX?",
    "topK": 5,
    "minScore": 0.3
  }'
```

**Step 3 — Inject results into the system prompt:**

```
Given the following context from the knowledge base:

---
[Chunk 1, score 0.87] The alert system monitors host metrics...
[Chunk 2, score 0.72] UGClawdX runs an RTX 3090 with 24GB...
---

Answer the user's question using the context above when relevant.
```

**Step 4 — Send to Ollama with the augmented prompt.**

If RAG is unreachable in step 1, proceed without context augmentation (graceful degradation). Never block the chat pipeline on a RAG failure.

## Response Envelope

All endpoints return:

```json
{
  "ok": true,
  "data": { ... },
  "meta": { "durationMs": 42 }
}
```

On error:

```json
{
  "ok": false,
  "error": "ERROR_CODE or message",
  "detail": "Human-readable explanation"
}
```

### Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `VECTOR_STORE_UNAVAILABLE` | 503 | Qdrant is not reachable |
| `EMBEDDING_SERVICE_UNAVAILABLE` | 503 | Embedding provider (Ollama) is down |
| `SCAN_ALREADY_RUNNING` | 409 | An ingest-scan job is already in progress |
| `REINDEX_ALREADY_RUNNING` | 409 | A reindex migration is already in progress |
| `CONFIRMATION_REQUIRED` | 400 | Destructive operation needs `confirm: true` |
| Validation messages | 400 | Bad request (missing text, query, etc.) |

## Integration Patterns

### For chat context augmentation (core)

1. Call `POST /api/rag/search` with the user's query
2. Use `results[].text` as context chunks
3. Use `results[].metadata.source` for citation attribution
4. Use `results[].score` to filter low-relevance results (suggest threshold: 0.3)

### For document automation (scanners, watchers)

1. Generate a `documentId` from `source + filePath` for stable identity
2. Call `POST /api/rag/ingest` with `text`, `source`, `tags`, and `documentId`
3. Re-ingesting with the same `documentId` replaces the previous version

### For bulk ingestion

Use the batch endpoint to ingest up to 50 documents in a single request:

```bash
curl -s -X POST http://localhost:3082/api/rag/ingest/batch \
  -H 'Content-Type: application/json' \
  -d '{
    "documents": [
      { "text": "First document...", "source": "scanner", "tags": ["auto"] },
      { "text": "Second document...", "source": "scanner", "tags": ["auto"] }
    ]
  }'
```

## Constraints

- Max text length per document: 2,000,000 chars
- Max query length: 10,000 chars
- Max chunks per document: 10,000
- Max search results (topK): 20
- Chunk size range: 50-10,000 chars (default 500)
- Chunk overlap: 0 to chunkSize/2 (default 50)
- Vector dimension: 768 (nomic-embed-text:v1.5)
- Batch ingest max: 50 documents per request
