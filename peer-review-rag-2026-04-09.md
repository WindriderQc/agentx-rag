# AgentX RAG Service -- Deep Peer Review
**Date:** 2026-04-09 | **Reviewer:** Claude Opus 4.6 | **Scope:** Full RAG service (`rag/`)

---

## I. FILE SIZE AUDIT

### Backend Source Files (excluding `node_modules/` and `tests/`)

| File | Lines | Status |
|------|------:|--------|
| `src/services/ingestWorker.js` | 549 | APPROACHING (limit: 700) |
| `routes/rag.js` | 548 | APPROACHING (limit: 1000) |
| `src/services/vectorStore/QdrantVectorStore.js` | 354 | OK |
| `src/services/ragCompression.js` | 273 | OK |
| `routes/manifest.routes.js` | 243 | OK |
| `src/services/ragStore.js` | 213 | OK |
| `src/services/embeddings.js` | 191 | OK |
| `routes/migration.routes.js` | 182 | OK |
| `src/services/embeddings/ollamaProvider.js` | 165 | OK |
| `src/services/ingestJobManager.js` | 155 | OK |
| `src/services/reranker.js` | 134 | OK |
| `src/services/ragStoreUtils.js` | 129 | OK |
| `src/services/embeddingCache.js` | 119 | OK |
| `src/services/vectorStore/InMemoryVectorStore.js` | 118 | OK |
| `src/services/embeddings/coreProxyProvider.js` | 116 | OK |
| `src/services/keywordSearch.js` | 110 | OK |
| `routes/telemetry.routes.js` | 94 | OK |
| `routes/metrics.routes.js` | 73 | OK |
| `server.js` | 83 | OK |
| `app.js` | 74 | OK |
| `routes/document.routes.js` | 70 | OK |
| `ingestWorker.js` (CLI entry) | 57 | OK |
| `src/services/vectorStore/VectorStoreAdapter.js` | 46 | OK |
| `config/createLogger.js` | 45 | OK |
| `models/RagManifest.js` | 35 | OK |
| `config/db.js` | 33 | OK |
| `src/services/vectorStore/factory.js` | 31 | OK |
| `src/utils/fetchWithTimeout.js` | 26 | OK |
| `models/IngestJob.js` | 23 | OK |
| `src/utils/response.js` | 21 | OK |
| `src/utils/cosineSimilarity.js` | 15 | OK |
| `config/logger.js` | 8 | OK |

**Total backend source:** ~4,323 lines across 32 files.

### Frontend Files

| File | Lines | Status |
|------|------:|--------|
| `public/css/style.css` | 1,237 | OK (no CSS limit defined, but manageable) |
| `public/js/maintenance.js` | 320 | OK |
| `public/js/upload.js` | 295 | OK |
| `public/js/documents.js` | 284 | OK |
| `public/js/search.js` | 204 | OK |
| `public/js/dashboard.js` | 191 | OK |
| `public/js/api.js` | 172 | OK |

**Total frontend JS:** 1,466 lines across 7 files.
**Total frontend (JS+CSS+HTML):** 3,163 lines.

### Test Files

| File | Lines |
|------|------:|
| `tests/unit/qdrantVectorStore.test.js` | 609 |
| `tests/unit/manifests.test.js` | 471 |
| `tests/unit/ragStore.test.js` | 381 |
| `tests/unit/migration.test.js` | 351 |
| `tests/unit/ingestScanRoute.test.js` | 349 |
| `tests/unit/batchIngest.test.js` | 332 |
| `tests/unit/ragCompression.test.js` | 290 |
| `tests/unit/statusAndMetrics.test.js` | 283 |
| `tests/unit/ragStoreUtils.test.js` | 270 |
| `tests/unit/ingestWorker.test.js` | 223 |
| `tests/unit/embeddingCache.test.js` | 201 |
| `tests/unit/reranker.test.js` | 201 |
| `tests/unit/inMemoryVectorStore.test.js` | 194 |
| `tests/unit/keywordSearch.test.js` | 166 |
| `tests/unit/ingestJobManager.test.js` | 151 |
| `tests/integration/relevance-golden.test.js` | 149 |
| `tests/unit/embeddings.test.js` | 146 |
| `tests/integration/ingest-search.test.js` | 132 |
| `tests/unit/queryExpansion.test.js` | 112 |
| `tests/unit/cosineSimilarity.test.js` | 29 |
| `tests/unit/health.test.js` | 20 |

**Total test code:** ~5,060 lines across 21 files.
**Test-to-source ratio:** 1.17:1 -- excellent.

### Compliance Verdict

No violations. No file exceeds its category limit. Two files (`ingestWorker.js` at 549 and `rag.js` at 548) are at ~78% of their respective limits (700 for backend services, 1000 for routes). These are worth monitoring but not yet actionable.

---

## II. DEAD CODE AUDIT

### Unused Exports

| Export | File | Evidence |
|--------|------|----------|
| `sendOk` | `src/utils/response.js` | Exported but never imported anywhere (routes all inline `res.json({ ok: true, data })` instead) |
| `hashText` | `src/services/ragStoreUtils.js` | Only referenced in its own module and its test file -- never called from production code |
| `createIngestApiClient` | `src/services/ingestWorker.js` | Exported but never imported outside the module. The HTTP-based ingest client was superseded by `createDirectIngestClient`. No tests. |
| `sleep` | `src/services/ingestWorker.js` | Exported but only used internally within `IngestWorker.run()` |
| `escapeRegExp` | `src/services/ingestWorker.js` | Not exported, only used internally -- this is fine |

### Stale Frontend Function

| Function | File | Issue |
|----------|------|-------|
| `triggerReindex()` | `public/js/api.js:148` | Calls `POST /api/rag/reindex` but the actual backend endpoint is `POST /api/rag/embedding-migration/reindex`. This function would always 404. |

### Template Literal Bugs (Escaped Interpolation)

| Line | File | Bug |
|------|------|----|
| 230 | `routes/rag.js` | `` `Roots not under configured paths: \${invalid.join(', ')}` `` -- the `\$` prevents interpolation, users see literal `${invalid.join(', ')}` |
| 318 | `routes/rag.js` | `` `Job is \${job.status}, cannot cancel` `` -- same issue, users see literal `${job.status}` |

These are real bugs, not dead code. The error messages contain literal unexpanded template syntax instead of the actual values.

### Route Mount Verification

All 6 route files are mounted in `app.js`:
- `routes/rag.js` -- mounted
- `routes/document.routes.js` -- mounted
- `routes/manifest.routes.js` -- mounted
- `routes/migration.routes.js` -- mounted
- `routes/metrics.routes.js` -- mounted
- `routes/telemetry.routes.js` -- mounted

No orphan route files found.

---

## III. SEARCH PIPELINE ANALYSIS

### Full Flow: `POST /search` to Response

```
Client -> routes/rag.js POST /search
  |
  v
1. INPUT VALIDATION (rag.js:327-352)
   - query: required, non-empty string, <= 10,000 chars
   - topK: clamped to [1, 20]
   - minScore: clamped to [0, 1]
   - filters: must be plain object
  |
  v
2. ragStore.searchSimilarChunks(query, options) (ragStore.js:68)
   |
   +--> BRANCH A: hybrid=true
   |    |
   |    +-> PARALLEL: vector search + keyword search
   |    |   vector: embeddingsService.embedBatch([query]) -> vectorStore.searchSimilar()
   |    |   keyword: keywordSearch(vectorStore, query) -- iterates ALL docs & chunks
   |    |
   |    +-> reciprocalRankFusion(vectorResults, keywordResults)
   |    +-> trim to candidateTopK
   |
   +--> BRANCH B: expand=true
   |    |
   |    +-> expandQuery(query) -- LLM call via Core proxy (rag_query_expansion task)
   |    +-> PARALLEL: embed + search for each expanded query
   |    +-> dedup by documentId:chunkIndex, keep highest score
   |    +-> trim to candidateTopK
   |
   +--> BRANCH C: standard vector search
        |
        +-> embeddingsService.embedBatch([query])
        +-> vectorStore.searchSimilar(embedding, options)
  |
  v
3. OPTIONAL: rerank=true (reranker.js)
   - Fetches topK*3 candidates in step 2
   - For each candidate: LLM call via Core proxy (rag_reranking task)
   - All scoring calls are PARALLEL (Promise.all)
   - Sorts by llmScore, trims to topK
   - On per-result failure: falls back to vector score for that result
   - On total failure: returns original results sliced to topK
  |
  v
4. OPTIONAL: compress=true (ragCompression.js)
   - For each result: LLM call via Core proxy (rag_compression task)
   - All compression calls are PARALLEL (Promise.all)
   - Checks in-memory cache first (1-hour TTL)
   - Filters out chunks with no relevant content
   - On per-chunk failure: returns original text uncompressed
   - On total failure: catches error, logs warning, returns uncompressed results
  |
  v
5. RETURN: { ok: true, data: { results, count } }
```

### Error Handling Analysis Per Stage

| Stage | Error Handling | Quality |
|-------|---------------|---------|
| Input validation | Returns 400 with specific field errors | EXCELLENT |
| Embedding generation | Throws; caught by route handler | GOOD -- but no retry |
| Vector store search | Throws; caught by route handler | GOOD |
| Keyword search (hybrid) | Returns empty array on error (swallowed) | CONCERN -- silent failure |
| Query expansion | Returns empty array on error (swallowed) | ACCEPTABLE -- degrades to standard search |
| Re-ranking per-result | Falls back to vector score per result | GOOD |
| Re-ranking total | Falls back to original results | GOOD |
| Compression per-chunk | Falls back to original text | GOOD |
| Compression total | Catches, warns, returns uncompressed | GOOD |
| Route-level error | classifyRagAvailabilityError -> 503 or generic 500 | GOOD |

### Observability Gaps

1. **No per-stage timing.** When results are slow, there is no way to determine whether the bottleneck is embedding, vector search, keyword search, re-ranking, or compression. Each stage logs info-level messages, but they are not structured for aggregation.

2. **No debug mode.** There is no way to request intermediate results from each pipeline stage. A `debug: true` flag on `/search` that returned per-stage results, timings, and scores would make troubleshooting dramatically easier.

3. **Keyword search failure is silent.** If `keywordSearch()` throws, it returns `[]` and the hybrid search degrades to vector-only without any indication to the caller.

4. **No telemetry for search operations.** Ingest operations write to `IngestJob` for telemetry, but search operations leave no trace. There is no way to analyze search patterns, latency distributions, or which pipeline features are used.

5. **Compression cache has no hit/miss metrics.** Unlike the embedding cache (which tracks hits/misses/evictions), the compression cache only exposes `size` and `ttl`.

---

## IV. TEST COVERAGE GAPS

### Coverage Matrix: Functions/Routes vs Tests

| Component | Tested | Gap |
|-----------|--------|-----|
| `POST /ingest` | Integration only (`ingest-search.test.js`) | No unit test for validation edge cases at route level |
| `POST /documents` (alias) | Not tested | Alias handler is same function, low risk |
| `POST /ingest/batch` | `batchIngest.test.js` | GOOD |
| `POST /ingest-scan` | `ingestScanRoute.test.js` | GOOD |
| `GET /ingest-scan/:jobId` | `ingestScanRoute.test.js` | GOOD |
| `DELETE /ingest-scan/:jobId` | `ingestScanRoute.test.js` | GOOD |
| `POST /search` | Integration only (`ingest-search.test.js`) | No unit test for search route validation/error paths |
| `GET /documents` | Not directly tested | Listed in integration test but not the route handler specifically |
| `DELETE /documents/:id` | Integration test | No unit tests for error paths (404, 500) |
| `GET /documents/:id` | `manifests.test.js` | GOOD |
| `GET /documents/:id/chunks` | `manifests.test.js` | GOOD |
| `POST /cache/clear` | Not tested | No test at all |
| `GET /status` | `statusAndMetrics.test.js` | GOOD |
| `POST /manifests` | `manifests.test.js` | GOOD |
| `GET /manifests/latest` | Not tested | No test for this route |
| `GET /deletion-preview` | `manifests.test.js` | GOOD |
| `POST /cleanup` | `manifests.test.js` | GOOD |
| `GET /embedding-migration/status` | `migration.test.js` | GOOD |
| `POST /embedding-migration/reindex` | `migration.test.js` | GOOD |
| `GET /embedding-migration/reindex/:jobId` | `migration.test.js` | GOOD |
| `GET /metrics` | `statusAndMetrics.test.js` | GOOD |
| `GET /telemetry/ingest` | **NOT TESTED** | No test file at all |
| `GET /telemetry/ingest/summary` | **NOT TESTED** | No test file at all |
| `GET /health` | `health.test.js` | GOOD |

### Untested Service Logic

| Component | Coverage |
|-----------|----------|
| `ragStore.searchSimilarChunks` -- standard path | `ragStore.test.js` -- GOOD |
| `ragStore.searchSimilarChunks` -- hybrid path | `ragStore.test.js` -- GOOD |
| `ragStore.searchSimilarChunks` -- expand path | `ragStore.test.js` -- GOOD |
| `ragStore.searchSimilarChunks` -- rerank path | `ragStore.test.js` -- GOOD |
| `ragStore.searchSimilarChunks` -- compress path | **NOT TESTED** in ragStore.test.js |
| `ragStore.searchSimilarChunks` -- compress + rerank combo | **NOT TESTED** |
| `ragCompression.compressChunks` -- standalone | `ragCompression.test.js` -- GOOD |
| `ragCompression` -- cache key collisions | Not tested |
| `embeddingCache` -- TTL expiration | `embeddingCache.test.js` -- GOOD |
| `OllamaProvider` -- multi-host failover | `embeddings.test.js` -- basic, but not failover logic |
| `QdrantVectorStore._scrollByFilter` -- pagination | `qdrantVectorStore.test.js` -- GOOD |
| `IngestWorker.processRecord` -- all skip reasons | `ingestWorker.test.js` -- GOOD |
| `classifyRagAvailabilityError` | Not directly tested |
| `createIngestApiClient` | **NOT TESTED** |

### Summary

- **21 test files** covering the majority of backend logic
- **5 untested routes**: `POST /cache/clear`, `GET /manifests/latest`, `GET /telemetry/ingest`, `GET /telemetry/ingest/summary`
- **Key untested path**: compression stage within the search pipeline (`searchSimilarChunks` with `compress: true`)
- **No frontend tests** (common across all services, not specific to RAG)

---

## V. PERFORMANCE BOTTLENECKS

### 1. Keyword Search Scans All Documents (CRITICAL for scale)

`keywordSearch.js:57-98` calls `vectorStore.listDocuments(filters)` then iterates every document, calls `getDocumentChunks(docId)` for each, and scores every chunk. With Qdrant, this means:
- One scroll request to fetch all documents
- N additional scroll requests (one per document) to fetch chunks
- O(documents * chunks * queryTerms) scoring

At 1,000 documents with 10 chunks each, this is 1,001 HTTP requests to Qdrant. This is the single biggest scalability bottleneck in the service.

### 2. `listDocuments` Scrolls All Points (Qdrant)

`QdrantVectorStore.listDocuments()` at line 172 scrolls up to 10,000 points, builds a doc map in memory, then applies pagination *after* loading everything. The `metrics.routes.js` endpoint also does `listDocuments({}, { limit: 10000 })`. At scale, this loads the entire vector store into memory for every `/metrics` or `/documents?limit=50` call.

### 3. `getStats` Scrolls All Points (Qdrant)

`QdrantVectorStore.getStats()` at line 288 calls `_scrollByFilterLite(null, 10000)` to count unique document IDs. Qdrant has a native `count` API and payload indexing that could make this O(1) instead of O(n).

### 4. Compression Cache Unbounded

`ragCompression.js` uses a plain `Map` for caching with TTL-based expiration but no maximum size cap. If many unique query+chunk pairs flow through, this grows without limit until the process is restarted. The embedding cache has a proper `maxSize` (default 1000) with LRU eviction -- the compression cache should have the same.

### 5. Reindex Loads All Document Text Into Memory

`migration.routes.js:149` reconstructs full document text by joining all chunks: `const fullText = chunks.map((c) => c.text).join('')`. For large documents, this creates large strings. Combined with the sequential processing loop, a reindex of many large documents could cause memory pressure.

### 6. No Request Timeout on LLM-Dependent Endpoints

The search endpoint with `rerank=true` fires parallel LLM calls for each result. With `topK=20` and `rerank=true`, that is 60 candidates, each with a 15-second timeout. The worst case is 15 seconds per sequential batch (if the LLM host is slow but not dead). The HTTP request itself has no server-side timeout, so a client could wait the full 15 seconds while holding a connection.

### 7. Batch Ingest is Strictly Sequential

`routes/rag.js:181` processes documents one at a time in a `for...of` loop. With 50 documents, each requiring embedding calls, total time = sum of all embedding latencies. Parallel processing of non-GPU-bottlenecked operations (chunking, validation) could improve throughput.

---

## VI. CODE QUALITY HIGHLIGHTS

The ecosystem peer review flagged RAG as the best-designed service. Here is the evidence for that claim and the specific patterns other services should adopt.

### 1. Standard Response Envelope

Every endpoint returns `{ ok: boolean, data?: any, error?: string, detail?: string, meta?: { durationMs } }`. The `app.js` request-timing middleware automatically injects `meta.durationMs` into all `/api/rag` responses. This is a zero-effort observability win.

**Pattern location:** `src/utils/response.js` (sendError), `app.js:44-55` (timing middleware).

### 2. Classified Error Responses

`classifyRagAvailabilityError()` in `routes/rag.js:33-42` inspects error messages and returns structured error codes (`VECTOR_STORE_UNAVAILABLE`, `EMBEDDING_SERVICE_UNAVAILABLE`) with appropriate HTTP status codes. This turns opaque 500s into actionable 503s that tell the caller *why* the service is down.

### 3. Input Validation Thoroughness

Every route parameter is validated before processing:
- Text length limits (`MAX_TEXT_LENGTH = 2_000_000`)
- Query length limits (`MAX_QUERY_LENGTH = 10,000`)
- Type checks (string, array, object, integer)
- Range clamping (topK, minScore, chunkSize, chunkOverlap)
- Array element type validation (tags must be `string[]`)
- Pagination bounds (limit clamped to 200, offset clamped to 0+)
- NoSQL injection prevention (filters must be plain objects, not arrays)

### 4. Pluggable Vector Store Abstraction

The `VectorStoreAdapter` abstract class defines 8 methods. Two concrete implementations (`InMemoryVectorStore` for dev/test, `QdrantVectorStore` for production) are swapped via `VECTOR_STORE_TYPE` environment variable. This separation makes testing trivial (in-memory store, no external dependencies) and keeps production complexity isolated.

### 5. Graceful Degradation in the Search Pipeline

Each optional stage (expansion, hybrid, rerank, compress) is designed to fail independently without breaking the overall search. On failure, each stage falls back to the previous stage's results. The chain never propagates a failure upward -- the caller always gets results.

### 6. Fire-and-Forget Telemetry

Ingest operations write telemetry to MongoDB asynchronously: `IngestJob.create({...}).catch(telErr => logger.warn(...))`. The ingest operation succeeds or fails independently of whether telemetry recording works. This prevents observability infrastructure from impacting availability.

### 7. Safety Caps on Destructive Operations

The cleanup route (`manifest.routes.js:147`) defaults to `dryRun: true` and caps deletions at `maxDeletes` (default 100, hard cap 500). You cannot accidentally mass-delete documents. The chunking utility caps at `MAX_CHUNKS = 10,000` to prevent runaway chunk generation.

### 8. Clean Singleton Pattern With Reset

Every service singleton (`getRagStore`, `getEmbeddingsService`, `getEmbeddingCache`, `getCompressionService`) exposes a `reset*()` function that nulls the instance. This pattern enables clean test isolation without module-level state leaking between test suites.

---

## VII. TOP 10 ACTION ITEMS

### 1. Fix Template Literal Bugs in Error Messages
**File:** `rag/routes/rag.js` lines 230, 318
**What:** Remove the backslash escaping `\$` to allow template interpolation. Currently, users see literal `${invalid.join(', ')}` and `${job.status}` in error messages instead of actual values.
**Fix:** Change `\${invalid.join(', ')}` to `${invalid.join(', ')}` and `\${job.status}` to `${job.status}`.
**Effort:** S | **Impact:** HIGH (user-facing bug)

### 2. Fix Stale Frontend Reindex Endpoint
**File:** `rag/public/js/api.js` line 149
**What:** `triggerReindex()` calls `POST /api/rag/reindex` but the actual backend endpoint is `POST /api/rag/embedding-migration/reindex`. This would always 404.
**Fix:** Update the path and add `{ confirm: true }` to the body.
**Effort:** S | **Impact:** MEDIUM (broken frontend feature)

### 3. Add Search Pipeline Debug Mode
**File:** `rag/src/services/ragStore.js` (searchSimilarChunks)
**What:** Add a `debug: true` option to the search endpoint that returns per-stage results, timing, and scores. This is the #1 observability gap identified in the ecosystem review.
**Fix:** Capture start/end timestamps per stage, collect intermediate results when `options.debug === true`, and return them alongside the final results in a `_debug` field.
**Effort:** M | **Impact:** HIGH (debugging, observability)

### 4. Cap the Compression Cache Size
**File:** `rag/src/services/ragCompression.js`
**What:** The compression cache (`this.compressionCache`) is an unbounded `Map` with TTL-only eviction. Unlike the embedding cache (which has `maxSize = 1000`), this grows without limit.
**Fix:** Add LRU eviction identical to `embeddingCache.js` -- max size from `COMPRESSION_CACHE_MAX_SIZE` env var (default ~500), evict oldest on overflow.
**Effort:** S | **Impact:** MEDIUM (prevents slow memory leak)

### 5. Optimize Keyword Search for Scale
**File:** `rag/src/services/keywordSearch.js`
**What:** Current implementation loads all documents, then loads all chunks per document via individual HTTP calls to Qdrant. At 1,000 docs, this is 1,001 network round-trips.
**Fix:** Either (a) add a full-text scroll method to QdrantVectorStore that returns all chunks with text in a single paginated scroll, or (b) add a Qdrant payload index on text and use Qdrant's native full-text search. Option (a) is simpler; option (b) is more scalable.
**Effort:** M | **Impact:** HIGH (scalability)

### 6. Add Tests for Telemetry Routes
**Files:** `rag/routes/telemetry.routes.js`, new: `rag/tests/unit/telemetry.test.js`
**What:** Both `GET /telemetry/ingest` and `GET /telemetry/ingest/summary` have zero test coverage. These endpoints run MongoDB aggregation pipelines that could break silently with schema changes.
**Fix:** Add route-level tests mocking `IngestJob` model, testing pagination/limits, filter params, and the aggregation pipeline output shape.
**Effort:** S | **Impact:** MEDIUM (reliability)

### 7. Add Compression Path to ragStore Search Tests
**File:** `rag/tests/unit/ragStore.test.js`
**What:** The `searchSimilarChunks` test suite covers standard, hybrid, expand, and rerank paths but not the `compress: true` path or `compress + rerank` combination.
**Fix:** Add test cases for `compress: true` (mocking the compression service) and `rerank + compress` combination.
**Effort:** S | **Impact:** MEDIUM (test coverage for a critical pipeline stage)

### 8. Remove Dead Exports
**Files:** `src/utils/response.js`, `src/services/ragStoreUtils.js`, `src/services/ingestWorker.js`
**What:** `sendOk` (never imported), `hashText` (only used in tests, never in production), `createIngestApiClient` (superseded by `createDirectIngestClient`), `sleep` (only used internally).
**Fix:** Remove `sendOk` from exports. Keep `hashText` but mark with `@internal` JSDoc since it only serves tests. Remove `createIngestApiClient` entirely (and its export). Stop exporting `sleep`.
**Effort:** S | **Impact:** LOW (code hygiene)

### 9. Optimize QdrantVectorStore.listDocuments and getStats
**File:** `rag/src/services/vectorStore/QdrantVectorStore.js`
**What:** `listDocuments()` scrolls all points (up to 10,000) to build a document map, then paginates in memory. `getStats()` scrolls all points just to count unique document IDs. Both are O(n) in total vector count.
**Fix:** For `getStats`, use Qdrant's native `count` endpoint and a payload-indexed distinct query if available, or at minimum cache the count with a short TTL. For `listDocuments`, consider maintaining a separate document metadata collection in MongoDB (or a Qdrant collection with one point per document).
**Effort:** L | **Impact:** HIGH at scale (performance)

### 10. Add Incremental/Delta Scanning to Ingest Worker
**File:** `rag/src/services/ingestWorker.js`
**What:** The `getCandidateRecords` method already implements delta logic via `needsReindex(record)` -- it checks `indexed_at` vs `mtime`. But the full scan still queries all matching records from `nas_files` and iterates them. At scale, a pre-filter on `mtime > last_scan_completed_at` in the MongoDB query would reduce the candidate set dramatically.
**Fix:** Track the last successful scan timestamp (in a manifest or config document) and add a `$or` condition to the MongoDB query: `{ $or: [{ indexed_at: null }, { mtime: { $gt: lastScanAt } }] }`. This turns an O(all-files) scan into O(changed-files).
**Effort:** M | **Impact:** HIGH (scan performance at scale)

---

## VIII. SUMMARY

RAG is the cleanest service in the AgentX ecosystem. Its architecture is well-layered (routes -> ragStore -> vectorStore/embeddings), its error handling is consistently structured, and its test coverage is strong for a service of this size. The two real bugs (template literal escaping at lines 230/318 and the stale frontend reindex endpoint) are quick fixes. The performance concerns around keyword search, listDocuments, and getStats are not issues today but will become blockers as the document corpus grows past a few hundred documents. The search pipeline's graceful degradation pattern is exemplary and should be adopted as a reference implementation for the rest of the platform.
