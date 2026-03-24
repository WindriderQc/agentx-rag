# AgentX RAG — Agent Integration Guide

## Service Purpose

agentx-rag is the knowledge retrieval service for the AgentX ecosystem. It accepts documents, chunks them, generates vector embeddings, and serves semantic search results. Other services (especially agentx-core's chat pipeline) consume it for context augmentation.

## Quick Start for Agents

### 1. Check if the service is healthy

```bash
curl http://localhost:3082/api/rag/status
```

Response: `{ ok: true, data: { documentCount, chunkCount, vectorDimension, vectorStore: { healthy, type } } }`

If `ok` is false or the service is unreachable, RAG cannot serve search results.

### 2. Ingest a document

```bash
curl -X POST http://localhost:3082/api/rag/ingest \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "Your document content here...",
    "source": "my-agent",
    "tags": ["code", "docs"]
  }'
```

Response: `{ ok: true, data: { documentId, chunkCount, status } }`

### 3. Search for relevant context

```bash
curl -X POST http://localhost:3082/api/rag/search \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "How does the alert system work?",
    "topK": 5
  }'
```

Response: `{ ok: true, data: { results: [{ text, score, metadata }], count } }`

### 4. List indexed documents

```bash
curl http://localhost:3082/api/rag/documents
```

Response: `{ ok: true, data: { documents: [...], count } }`

### 5. Delete a document

```bash
curl -X DELETE http://localhost:3082/api/rag/documents/<documentId>
```

Response: `{ ok: true, data: { documentId } }`

## Response Envelope

All endpoints return:

```json
{
  "ok": true,
  "data": { ... }
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
| `EMBEDDING_SERVICE_UNAVAILABLE` | 503 | Embedding provider (core proxy or Ollama) is down |
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

## Constraints

- Max text length for embedding: 8,000 chars (truncated silently)
- Max chunks per document: 10,000
- Max search results (topK): 20
- Chunk size default: 500 chars, overlap: 50 chars
- Vector dimension: 768 (nomic-embed-text:v1.5)
