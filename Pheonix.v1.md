# Phoenix v1 — The Honest RAG Audit

> Date: 2026-03-24
> Author: Claude Opus 4.6
> Inputs: Codex report, Copilot report, Claude Sonnet report, verified against live codebase + legacy AgentX source

---

## Critique of Prior Reports

Three reports preceded this one. All three correctly identify the core problems — embedding dependency on core, orphaned RagManifest, missing UX, thin API — but each has blind spots worth naming.

### Copilot Report
**Strength:** Best architectural prose. Clearly articulates the ownership boundary problem and the "Phase 0 vs real product" distinction.
**Weakness:** Dumps six conceptually different concerns into "Phase 0: Correct the service boundary" — that is not phasing, that is a wish list wearing a sprint costume. No bug table with file/line references. No LOC delta against legacy. Sprint A–E are one-liners that communicate nothing actionable. Verbose where it should be concrete.

### Codex Report
**Strength:** Best exit criteria section. The "Phoenix Is Alive" checklist (8 items) is the most useful artifact across all three reports. Good scorecard format.
**Weakness:** Claims "baseline fixes already applied" (chunk tail dedup, Qdrant doc count, initial tests) — these exist in the repo as 2 small test files totaling 65 lines, which is honest progress but presented as more significant than it is. Seven phases (0–6) is too granular; phases 5 and 6 (agent-first API, ecosystem reconciliation) are really one deliverable. Decision A/B/C section is good but buries the lede.

### Claude Sonnet Report
**Strength:** Best technical depth by far. Only report with a real bug table including severity, file paths, and line numbers. Only report with LOC comparison (607 vs 79 for ragStore). Only report listing concrete dependencies to add and target env vars. Priority ordering for constrained execution is genuinely useful.
**Weakness:** Day-based timeline (Phase 0 on Day 1, Phase 4 on Days 7–9) is fantasy scheduling for a service this incomplete. The "Lost" inventory (sections 2.1–2.12) is comprehensive but uncritical — it implies everything from legacy was valuable and should return. Some of it was bloat. The `rag.html` at 1,519 lines was a monolith UI page, not a gold standard. Bug #2 (weak point ID hash) is correctly identified but the risk framing overstates collision probability for realistic document/chunk ID inputs — the 32-bit space is fine for collections under ~50K points, which covers current use.

### What All Three Miss

1. **No report questions whether the legacy architecture was actually good.** They all treat the 606-line ragStore.js, 1,127-line routes file, and 576-line file watcher as aspirational. Those are monolith-scale files that violate the ecosystem's own 300–700 line limits. The extraction was incomplete, but the legacy code was also overweight.

2. **No report addresses the Qdrant client choice honestly.** Legacy used `@qdrant/js-client-rest` (official SDK). The new service uses raw `node-fetch`. All three note this but none say the obvious: raw fetch against Qdrant's REST API is fine for the 6 operations this service needs. The SDK adds type safety for TypeScript projects; this is JavaScript. It is a nice-to-have, not a gap.

3. **No report prioritizes the embedding independence question correctly.** All three treat it as one item among many. It is the single architectural decision that determines whether this is a standalone service or a core satellite. Everything else — manifests, UX, advanced search — is decoration until this is resolved.

4. **No report acknowledges that the current service actually works.** It ingests, it embeds (via core), it searches, it returns results with scores. The chat pipeline in core successfully consumes it. For a service extracted weeks ago, this is not a failure — it is a viable MVP with known gaps. The reports read like post-mortems for a service that is running in production.

---

## Ground Truth: Current vs Legacy

### Line Count Delta

| Component | Legacy (AgentX/) | Current (rag/) | Delta |
|-----------|------------------|-----------------|-------|
| ragStore.js (orchestrator) | 606 | 79 | -87% |
| embeddings.js | 239 | 141 | -41% |
| routes/rag.js | 1,127 | 148 | -87% |
| ragStoreUtils.js | 118 | 69 | -42% |
| QdrantVectorStore.js | ~300* | 234 | ~-22% |
| InMemoryVectorStore.js | ~150* | 122 | ~-19% |
| rag.html (UI) | 1,519 | 0 | -100% |
| embeddingCache.js | 273 | 0 | -100% |
| ragCompression.js | 273 | 0 | -100% |
| ragCache.js | 217 | 0 | -100% |
| ragContextBuilder.js | 121 | 0 | -100% |
| ragFileWatcher.js | 576 | 0 | -100% |
| ragCodebaseSyncService.js | 162 | 0 | -100% |
| ingest-docs.js (script) | 230 | 0 | -100% |
| **Total estimated** | **~4,900** | **~1,143** | **-77%** |

\* Legacy vector store files were explored but exact counts are estimates from the adapter portions.

The extraction kept the skeleton and dropped the muscle. That was the right first move — extract clean, then rebuild — but the rebuild has not started yet.

### What the Current Service Actually Has

```
rag/
  server.js              (43 lines)  — Bootstrap, error handlers, Mongo init
  app.js                 (28 lines)  — CORS, /health, route mount
  config/db.js           (35 lines)  — MongoDB connection
  config/logger.js       (77 lines)  — Winston logger
  models/RagManifest.js  (35 lines)  — Mongoose schema (ORPHANED)
  routes/rag.js          (148 lines) — 5 endpoints + 1 alias
  src/services/
    embeddings.js        (141 lines) — Core proxy embedding client
    ragStore.js          (79 lines)  — Thin orchestrator
    ragStoreUtils.js     (69 lines)  — Chunking + hashing
    vectorStore/
      VectorStoreAdapter.js   (46 lines)  — Abstract interface
      InMemoryVectorStore.js  (122 lines) — Dev adapter
      QdrantVectorStore.js    (234 lines) — Production adapter
      factory.js              (21 lines)  — Store factory
  tests/unit/
    ragStoreUtils.test.js       (16 lines)
    qdrantVectorStore.test.js   (49 lines)
```

**Total: 15 files, ~1,143 lines of JS, 65 lines of tests.**

### Verified Bug List

| # | Severity | Issue | File | Line |
|---|----------|-------|------|------|
| 1 | **HIGH** | RagManifest model defined but never imported or used anywhere | `models/RagManifest.js` | entire file |
| 2 | **MEDIUM** | `_generatePointId` uses 32-bit Java-style string hash — collision risk grows above ~50K points | `QdrantVectorStore.js` | 37–46 |
| 3 | **MEDIUM** | Health endpoint hardcodes `port: 3082` instead of reading `process.env.PORT` | `app.js` | 23 |
| 4 | **MEDIUM** | `_scrollByFilter` fetches only first page — large collections silently truncated | `QdrantVectorStore.js` | 182–198 |
| 5 | **MEDIUM** | `listDocuments` scrolls with limit 10,000 — no pagination for API consumers | `QdrantVectorStore.js` | 140–158 |
| 6 | **LOW** | `hashText()` exported but never called | `ragStoreUtils.js` | 14–16 |
| 7 | **LOW** | `cosineSimilarity` duplicated in EmbeddingsService and InMemoryVectorStore | 2 files | — |
| 8 | **LOW** | Text truncation at 8,000 chars is hardcoded, not configurable | `embeddings.js` | 43 |

**Severity recalibration vs Claude Sonnet report:** Bug #2 was rated HIGH there. I rate it MEDIUM because at current scale (~hundreds to low thousands of documents), 32-bit hash collision probability is negligible. It should be fixed when approaching 50K+ points, or proactively during Phase 1 work. It is not a production fire.

### Current .env

```env
PORT=3082
NODE_ENV=production
MONGODB_URI=mongodb://192.168.2.33:27017/agentx
VECTOR_STORE_TYPE=qdrant
QDRANT_URL=http://192.168.2.33:6333
QDRANT_COLLECTION=agentx_embeddings
EMBEDDING_MODEL=nomic-embed-text:v1.5
EMBEDDING_DIMENSION=768
CORE_PROXY_URL=http://localhost:3080
```

### Current Dependencies (package.json)

```
cors ^2.8.6, dotenv ^17.3.1, express ^4.18.2,
mongoose ^7.6.3, node-fetch ^2.7.0, winston ^3.11.0
devDependencies: jest ^29.7.0
```

No Qdrant SDK. No file upload library. No PDF parser. No UUID library.

---

## The One Decision That Matters First

**Should RAG own its own embeddings, or is core-proxy the permanent architecture?**

All three reports recommend "pluggable provider with direct Ollama fallback." I agree, but I want to be more precise about why and when.

### Arguments for direct Ollama:
- True standalone operation (RAG works if core is down)
- Simpler debugging (one less hop)
- Lower latency (skip the proxy)
- Matches ecosystem philosophy (self-hosted, no unnecessary coupling)

### Arguments for keeping core-proxy:
- Core already handles model routing, host selection, load balancing
- Central inference telemetry
- One place to change embedding model/host config
- RAG does not need to reimplement cluster-aware host selection

### My recommendation:
- **Default: direct Ollama.** RAG calls Ollama hosts directly using the same host list from env vars.
- **Optional: core-proxy.** Configurable via `EMBEDDING_PROVIDER=ollama-direct|core-proxy`. Core-proxy mode preserved for deployments that want centralized inference routing.
- **Implementation cost:** ~80 lines. The embedding service already knows how to POST to an HTTP endpoint. Changing the target URL from core to Ollama is trivial. The only meaningful work is host selection logic (round-robin or random from `OLLAMA_HOSTS`).

**This should be Sprint 1, Task 1.** Nothing else matters until the service can stand alone.

---

## Architecture Decisions

### Decision 1: Embedding Provider (above)
Default `ollama-direct`, optional `core-proxy`. ~80 lines.

### Decision 2: Document Identity
- File-oriented ingestion uses `source + path` → MD5 as document ID (this already exists in `generateDocumentId`)
- Add `hash` field (content hash) for unchanged detection on re-ingest
- `documentId` override still accepted for non-file sources
- **No change to the existing ID generation logic** — it is already correct. The Copilot/Codex reports imply `source + text` is the default; that was true in the original extraction but `generateDocumentId(source, filePath)` now uses `source + filePath`. The reports are stale on this point.

### Decision 3: Mongo Commitment
- Keep Mongo. Wire up RagManifest immediately.
- Add ingest job tracking (simple: `{ jobId, status, documentCount, startedAt, completedAt, errors }`)
- Do not add new Mongoose models beyond what is needed for manifests and jobs.

### Decision 4: What NOT to Port from Legacy
Some legacy capabilities should stay dead:

| Legacy Feature | Verdict | Why |
|---------------|---------|-----|
| `ragFileWatcher.js` (576 lines) | **Do not port** | Chokidar-based file watching is a runtime complexity bomb. Use the `data` service's storage scanner + a cron/webhook trigger instead. Separation of concerns. |
| `ragCache.js` (semantic query caching) | **Defer** | Premature optimization. Profile first. Add if search latency actually becomes a problem. |
| `ragContextBuilder.js` (chat context formatting) | **Keep in core** | This is chat logic, not RAG logic. Core should format context from RAG search results, not delegate formatting back to RAG. |
| Full `rag.html` monolith page | **Rebuild from scratch** | 1,519 lines in one HTML file is not a template. Build modular UI panels. |
| API key auth middleware | **Skip** | Per ecosystem rules: no auth layers unless explicitly requested. |

---

## Implementation Plan

### Sprint 1: Independence (the only sprint that matters right now)

**Goal:** RAG can ingest and search without core running.

| # | Task | Est. Lines | Priority |
|---|------|-----------|----------|
| 1 | Pluggable embedding provider (`ollama-direct` default, `core-proxy` optional) | ~80 | P0 |
| 2 | Fix health endpoint to read PORT from env | ~2 | P0 |
| 3 | Wire up RagManifest — `POST /api/rag/manifests`, `GET /api/rag/manifests/latest` | ~80 | P1 |
| 4 | Add deletion preview — `GET /api/rag/deletion-preview` (manifest vs indexed docs) | ~60 | P1 |
| 5 | Add document detail — `GET /api/rag/documents/:id` with chunks | ~40 | P1 |
| 6 | Add content hash to ingest payload, unchanged detection | ~30 | P1 |
| 7 | Fix `_scrollByFilter` pagination for large collections | ~20 | P1 |
| 8 | Clean dead code: remove unused `hashText` export, deduplicate `cosineSimilarity` | ~10 | P2 |
| 9 | Add `CLAUDE.md`, `AGENTS.md` for the rag service | ~100 | P2 |
| 10 | Expand test coverage: ingest flow, search flow, manifest CRUD | ~150 | P2 |

**Exit criteria:** `pm2 stop agentx-core && curl localhost:3082/api/rag/search -d '{"query":"test"}'` returns results.

### Sprint 2: Operability

**Goal:** Operators can see what is happening and clean up drift.

| # | Task | Est. Lines | Priority |
|---|------|-----------|----------|
| 1 | Rich `/api/rag/status` — app, Mongo, embedding provider, vector store health matrix | ~60 | P0 |
| 2 | Metrics endpoint — document count, chunk count, source breakdown, last ingest timestamp | ~80 | P0 |
| 3 | Bulk ingest endpoint — `POST /api/rag/ingest/batch` | ~50 | P1 |
| 4 | Cleanup endpoint — `POST /api/rag/cleanup` with `dryRun` flag | ~60 | P1 |
| 5 | Embedding migration status — `GET /api/rag/embedding-migration/status` | ~50 | P1 |
| 6 | Embedding migration reindex — `POST /api/rag/embedding-migration/reindex` | ~80 | P1 |
| 7 | Ingest job telemetry — counts, failures, latency, stored in Mongo | ~60 | P2 |
| 8 | Normalize all response envelopes to `{ ok, data, error, meta }` | ~40 | P2 |

**Exit criteria:** A new operator can `curl /api/rag/status` and know immediately whether the service is healthy, what is indexed, and what depends on what.

### Sprint 3: Search Quality

**Goal:** Search results are good enough that chat users trust RAG citations.

| # | Task | Est. Lines | Priority |
|---|------|-----------|----------|
| 1 | Embedding cache — LRU with SHA-256 keys, configurable size/TTL | ~120 | P0 |
| 2 | Query expansion — LLM generates 2–3 variant queries via small model | ~80 | P1 |
| 3 | Keyword search — term frequency scoring as fallback/complement | ~60 | P1 |
| 4 | Hybrid search — RRF fusion of vector + keyword results | ~50 | P1 |
| 5 | Reranking — LLM judge rescores top results | ~70 | P2 |
| 6 | Contextual compression — extract relevant sentences from chunks | ~100 | P2 |
| 7 | Search mode selection via API param: `mode: vector | keyword | hybrid` | ~20 | P2 |
| 8 | Cache stats exposed in `/api/rag/status` and `/api/rag/metrics` | ~20 | P2 |

**Exit criteria:** `POST /api/rag/search` with `mode: hybrid` returns meaningfully different (better) results than `mode: vector` on a 10-query benchmark set.

### Sprint 4: UX

**Goal:** Humans can operate the service without curl.

| # | Task | Priority |
|---|------|----------|
| 1 | Static file serving in app.js | P0 |
| 2 | Dashboard panel — health, doc count, chunk count, last ingest, provider status | P0 |
| 3 | Upload panel — drag-and-drop file/folder ingest with progress | P0 |
| 4 | Document browser — searchable list, source filter, tag filter, delete | P1 |
| 5 | Search playground — query, results with scores, chunk preview, filter controls | P1 |
| 6 | Drift & cleanup panel — manifest comparison, deletion preview, apply cleanup | P1 |
| 7 | Embedding migration panel — status check, reindex trigger | P2 |
| 8 | Dark theme matching AgentX design system | P2 |

**Exit criteria:** A user can ingest a folder of markdown files, search them, inspect results, and clean up stale docs — all through the browser.

### Sprint 5: Ecosystem Polish

**Goal:** No dead buttons, no ghost features, no ambiguity.

| # | Task | Priority |
|---|------|----------|
| 1 | Audit core's RAG UI — remove or reconnect watcher controls, simplify advanced toggles to match actual capabilities | P0 |
| 2 | Add navigation link from core UI to standalone RAG management | P1 |
| 3 | Publish API contract (OpenAPI or markdown) | P1 |
| 4 | Add agent-oriented examples in docs | P2 |
| 5 | Add PM2 ecosystem entry if missing | P2 |

---

## Target API Surface

```
# Health
GET    /health
GET    /api/rag/status                           — Dependency-aware health matrix
GET    /api/rag/metrics                          — Document/chunk/source stats

# Ingest
POST   /api/rag/ingest                           — Single document (text, source, path, hash, tags)
POST   /api/rag/ingest/batch                     — Multiple documents
POST   /api/rag/documents                        — Alias for /ingest (backward compat)

# Search
POST   /api/rag/search                           — mode: vector|keyword|hybrid, topK, filters, compress
POST   /api/rag/context                          — Agent-optimized: returns formatted context block with token budget

# Documents
GET    /api/rag/documents                        — List (paginated, filterable by source/tag)
GET    /api/rag/documents/:id                    — Document detail with metadata
GET    /api/rag/documents/:id/chunks             — Chunk list with text + scores
DELETE /api/rag/documents/:id                    — Delete document + chunks

# Manifests & Cleanup
POST   /api/rag/manifests                        — Store folder scan snapshot
GET    /api/rag/manifests/latest                 — Latest manifest
GET    /api/rag/deletion-preview                 — Manifest vs indexed comparison
POST   /api/rag/cleanup                          — Apply cleanup (dryRun flag)

# Migration
GET    /api/rag/embedding-migration/status       — Dimension mismatch detection
POST   /api/rag/embedding-migration/reindex      — Re-embed all documents

# Cache
POST   /api/rag/cache/clear                      — Clear embedding cache
```

**Intentionally excluded:**
- `/api/rag/upload` (file upload) — defer to Sprint 4 UX work, not a separate API concern
- `/api/rag/augment` (chat augmentation) — this is core's responsibility, not RAG's
- `/api/rag/watcher/*` — file watching is `data` service's job; RAG receives ingestion calls
- `/api/rag/collections/:name` (Qdrant admin) — too low-level for the service API; use Qdrant dashboard directly

---

## Target Environment Variables

```env
# Core
PORT=3082
NODE_ENV=production
MONGODB_URI=mongodb://192.168.2.33:27017/agentx

# Embeddings — the key independence switch
EMBEDDING_PROVIDER=ollama-direct                # ollama-direct | core-proxy
EMBEDDING_MODEL=nomic-embed-text:v1.5
EMBEDDING_DIMENSION=768
OLLAMA_HOSTS=192.168.2.66:11434,192.168.2.12:11434,192.168.2.99:11434
CORE_PROXY_URL=http://localhost:3080            # Only used when EMBEDDING_PROVIDER=core-proxy

# Vector Store
VECTOR_STORE_TYPE=qdrant
QDRANT_URL=http://192.168.2.33:6333
QDRANT_COLLECTION=agentx_embeddings

# Search Quality (Sprint 3)
QUERY_EXPANSION_MODEL=gemma2:2b
JUDGE_MODEL=llama3.1:8b
COMPRESSION_MODEL=gemma2:2b

# Cache (Sprint 3)
EMBEDDING_CACHE_SIZE=1000
EMBEDDING_CACHE_TTL=86400000

# CORS
CORS_ORIGINS=http://localhost:3080,http://localhost:3082
```

---

## Dependencies to Add

```json
{
  "uuid": "^9.0.0",
  "multer": "^1.4.5-lts.1"
}
```

**Not adding:**
- `@qdrant/js-client-rest` — raw fetch is fine for 6 operations in JavaScript. SDK adds value in TypeScript.
- `pdf-parse` — defer until file intelligence is actually requested. YAGNI.

---

## Exit Criteria: "Phoenix Is Alive"

Borrowed from Codex (the best section of any report), refined:

1. RAG ingests and searches **without core running** (embedding independence)
2. Document identity is stable across re-ingestion (content hash + source/path)
3. Operators can inspect health, documents, chunks, and manifests via API
4. Operators can preview and execute cleanup of stale documents
5. Search quality features (hybrid, expansion, reranking) match what the UI exposes
6. Core does not display RAG controls that do not work
7. The service has a real management UI
8. Test suite covers ingest, search, manifests, cleanup, and status

**The honest version:** Items 1–4 make this a real service. Items 5–8 make it a good one. Ship 1–4 first.

---

## What Success Looks Like

Today: a 1,143-line extraction that can search vectors if core is up.

After Sprint 1: a standalone knowledge service that owns its own embeddings, tracks document manifests, and can tell you what it knows and what is stale.

After Sprint 4: an operator can open a browser, see the health of every dependency, upload documents, search them, inspect chunks, clean up drift, and migrate embeddings — without touching curl or reading source code.

That is Phoenix.
