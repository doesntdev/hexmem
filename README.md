# HexMem

Multi-agent structured memory system — PostgreSQL + pgvector.

HexMem gives AI agents persistent, searchable memory with semantic embeddings, relationship graphs, and hybrid recall. Framework-agnostic with a REST API, TypeScript SDK, and CLI.

---

## Table of Contents

- [For Users](#for-users)
  - [Quick Start](#quick-start)
  - [OpenClaw Integration](#openclaw-integration)
  - [CLI Reference](#cli-reference)
  - [SDK](#sdk)
  - [API Reference](#api-reference)
  - [Environment Variables](#environment-variables)
- [For Contributors](#for-contributors)
  - [Architecture](#architecture)
  - [Project Structure](#project-structure)
  - [Database Schema](#database-schema)
  - [Services Deep Dive](#services-deep-dive)
  - [Testing](#testing)
  - [Adding New Features](#adding-new-features)

---

# For Users

## Quick Start

### Prerequisites

- **Node.js** 20+
- **Podman** or **Docker** (for PostgreSQL)
- **Gemini API key** (for embeddings; OpenAI and Ollama also supported)

### 1. Clone & Install

```bash
git clone https://github.com/doesntdev/hexmem.git && cd hexmem
npm install
```

### 2. Start PostgreSQL

The included `compose.yaml` runs PostgreSQL 16 with pgvector pre-installed:

```bash
# Using Podman (recommended)
podman compose up -d

# Or Docker
docker compose up -d
```

This starts a PostgreSQL container (`hexmem-db`) on **port 5433** with:
- User: `hexmem` / Password: `hexmem_dev` (override with `HEXMEM_DB_PASSWORD`)
- Database: `hexmem`
- pgvector extension pre-installed
- Persistent volume (`hexmem_pgdata`)

Verify it's healthy:
```bash
podman exec hexmem-db pg_isready -U hexmem -d hexmem
```

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env` and set your embedding provider API key:
```bash
# Required — your Gemini API key for embeddings
GEMINI_API_KEY=your_gemini_api_key_here

# Database — matches compose defaults, no changes needed
DATABASE_URL=postgres://hexmem:hexmem_dev@localhost:5433/hexmem
```

### 4. Start HexMem

```bash
npm run dev
```

On first boot, HexMem automatically:
- Runs all SQL migrations (enables pgvector, pg_trgm, creates all tables)
- Starts listening on `http://localhost:3400`

Verify:
```bash
curl http://localhost:3400/health
# → {"status":"ok"}
```

---

## OpenClaw Integration

HexMem includes a ready-to-use OpenClaw plugin and setup script. One command installs everything:

```bash
# Ensure HexMem is running first
npm run dev

# Run setup — specify your OpenClaw agent slugs
npx tsx tools/setup-openclaw.ts --agents my-agent,my-other-agent
```

This single command:
1. **Verifies** HexMem is alive
2. **Creates** a HexMem agent for each OpenClaw agent
3. **Installs** the `hexmem` plugin to `~/.openclaw/extensions/hexmem/`
4. **Updates** `openclaw.json` — claims the memory slot, configures tools and compaction
5. **Updates** each agent's `MEMORY.md` with HexMem connection info
6. **Validates** end-to-end recall

```bash
# After setup:
openclaw restart                         # activate the plugin
openclaw plugins list                    # verify 'hexmem' shows up

# Verify-only mode (no changes):
npx tsx tools/setup-openclaw.ts --agents my-agent --check

# Custom HexMem URL:
npx tsx tools/setup-openclaw.ts --agents my-agent --hexmem-url http://myhost:3400
```

### Tools Available to Agents

Once integrated, every OpenClaw agent gets these tools:

| Tool | What it does |
|------|-------------|
| `hexmem_recall` | Semantic + keyword + recency search across all memory types |
| `hexmem_store` | Store facts, decisions, events, or tasks with auto-embedding |
| `hexmem_search` | Direct vector search over a specific table |
| `hexmem_status` | Memory health: agent info, decay status |
| `hexmem_sql` | Raw SQL queries (SELECT only) for exploration |
| `hexmem_session_log` | Log session messages for continuity across compaction |

### Standalone SDK Integration

For non-OpenClaw frameworks, use the SDK directly:

```typescript
import { HexMem } from './sdk/index.js';

const mem = new HexMem({
  baseUrl: 'http://localhost:3400',
  apiKey: 'your_api_key',
  agentId: 'my-agent',
});

// Store memories during agent execution
await mem.storeFact({ content: 'User prefers dark mode', tags: ['preferences'] });

// Recall before responding
const context = await mem.recall('user preferences', { types: ['fact'] });
```

---

## CLI Reference

The CLI is a fully-featured interface to HexMem. Set defaults with env vars or pass flags.

```bash
# Set defaults
export HEXMEM_AGENT=my-agent
export HEXMEM_URL=http://localhost:3400
export HEXMEM_API_KEY=hexmem_dev_key

# Or use npx directly
npx tsx src/cli.ts <command> [options]
```

### Commands

```bash
# Agent management
hexmem agents                              # List all agents
hexmem status                              # Agent status + memory counts + decay dashboard
hexmem stats                               # All agents with detailed stats

# Memory operations
hexmem store fact "pgvector supports HNSW"  # Store a fact
hexmem store decision "Use Fastify"         # Store a decision
hexmem store task "Deploy v2"               # Store a task
hexmem store event "Release shipped"        # Store an event

# Search & recall
hexmem search "database patterns"           # Semantic vector search
hexmem recall "auth decisions"              # Hybrid recall (semantic + keyword + recency)
hexmem recall "deploy" --types fact,task    # Filter to specific memory types
hexmem recall "api" --limit 20             # Adjust result count

# Session management
hexmem sessions                            # List recent sessions
hexmem session <id>                        # View session messages

# Maintenance
hexmem decay sweep                         # Run manual decay sweep
hexmem decay status                        # View decay lifecycle stats
```

### Flags

| Flag | Description |
|------|-------------|
| `--agent <slug>` | Override default agent |
| `--types <list>` | Comma-separated types to search |
| `--limit <n>` | Max results (default: 10) |
| `--format json` | JSON output for scripting |

---

## SDK

TypeScript SDK for programmatic access:

```typescript
import { HexMem } from './sdk/index.js';

const mem = new HexMem({
  baseUrl: 'http://localhost:3400',
  apiKey: 'your_api_key',
  agentId: 'my-agent',
});

// ─── Session lifecycle ───
const session = await mem.startSession();
await mem.addMessage(session.id, { role: 'user', content: 'Deploy the app' });
await mem.addMessage(session.id, { role: 'assistant', content: 'Deploying now...' });
await mem.endSession(session.id); // triggers summarization + extraction

// ─── Store structured memories ───
await mem.storeFact({
  content: 'pgvector supports HNSW indexes for fast similarity search',
  tags: ['database', 'pgvector'],
});

await mem.storeDecision({
  title: 'Use Fastify over Express',
  decision: 'Fastify',
  rationale: 'Better TypeScript support, schema validation, faster benchmarks',
  context: 'API framework selection',
  tags: ['infrastructure'],
});

await mem.storeTask({
  title: 'Deploy production v2',
  priority: 90,
  status: 'not_started',
  tags: ['deploy'],
});

await mem.storeEvent({
  title: 'Database migration completed',
  event_type: 'milestone',
  severity: 'info',
  tags: ['ops'],
});

// ─── Recall with hybrid scoring ───
const results = await mem.recall('database performance', {
  types: ['fact', 'decision'],
  limit: 5,
  semantic_weight: 0.7,
  keyword_weight: 0.2,
  recency_weight: 0.1,
});

// ─── Core memory (per-agent state) ───
await mem.updateCoreMemory({ current_task: 'deploying v2', mood: 'focused' });
const agent = await mem.getAgent();
console.log(agent.core_memory); // { current_task: 'deploying v2', mood: 'focused' }
```

### Getting OpenClaw-Compatible Tools

```typescript
import { HexMem, getOpenClawTools } from './sdk/index.js';

const mem = new HexMem({ baseUrl: '...', apiKey: '...', agentId: 'openclaw' });
const tools = getOpenClawTools(mem);
// Returns tool definitions for: memory_store, memory_recall, memory_update_core
```

---

## API Reference

All endpoints require `Authorization: Bearer <api_key>` except `/health`.

### Agents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/agents` | Create new agent |
| `GET` | `/api/v1/agents` | List all agents |
| `GET` | `/api/v1/agents/:id` | Get agent (by UUID or slug) |
| `PATCH` | `/api/v1/agents/:id` | Update agent |
| `PATCH` | `/api/v1/agents/:id/core-memory` | JSON merge-patch on core memory |

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/sessions` | Start a session |
| `GET` | `/api/v1/sessions` | List sessions (`?agent_id=`) |
| `GET` | `/api/v1/sessions/:id` | Get session details |
| `POST` | `/api/v1/sessions/:id/messages` | Add message (triggers extraction) |
| `GET` | `/api/v1/sessions/:id/messages` | Get session messages |
| `POST` | `/api/v1/sessions/:id/end` | End session (triggers summarization) |

### Structured Memory

Each memory type supports full CRUD:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/facts` | Create fact |
| `GET` | `/api/v1/facts` | List facts (`?agent_id=`) |
| `GET` | `/api/v1/facts/:id` | Get fact |
| `PUT` | `/api/v1/facts/:id` | Update fact |
| `DELETE` | `/api/v1/facts/:id` | Delete fact |

Same pattern for `/api/v1/decisions`, `/api/v1/tasks`, `/api/v1/events`, `/api/v1/projects`.

### Search & Recall

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `POST` | `/api/v1/search` | `{ query, agent_id, table, limit }` | Direct vector search |
| `POST` | `/api/v1/recall` | `{ query, agent_id, types?, limit?, semantic_weight?, keyword_weight?, recency_weight? }` | Hybrid recall |

### Relationships

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/edges` | Create a relationship edge |
| `GET` | `/api/v1/edges` | List edges |
| `GET` | `/api/v1/edges/graph/:type/:id` | Bidirectional graph traversal |
| `DELETE` | `/api/v1/edges/:id` | Remove edge |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Server health (unauthenticated) |
| `GET` | `/api/v1/decay/status` | Decay lifecycle dashboard |
| `POST` | `/api/v1/decay/sweep` | Trigger manual decay sweep |
| `POST/GET` | `/api/v1/keys` | API key management |
| `GET` | `/api/v1/analytics/queries` | Query log analytics |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3400` | Server port |
| `DATABASE_URL` | — | PostgreSQL connection string (required) |
| `GEMINI_API_KEY` | — | Gemini API key for embeddings |
| `OPENAI_API_KEY` | — | Alternative: OpenAI embeddings |
| `EMBEDDING_PROVIDER` | `gemini` | `gemini`, `openai`, or `ollama` |
| `HEXMEM_DEV_KEY` | `hexmem_dev_key` | Development auth bypass key |
| `HEXMEM_URL` | `http://localhost:3400` | CLI/SDK: API base URL |
| `HEXMEM_API_KEY` | `hexmem_dev_key` | CLI/SDK: API key |
| `HEXMEM_AGENT` | — | CLI: Default agent slug |

---

# For Contributors

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Clients                               │
│  CLI (cli.ts)  │  SDK (sdk/)  │  OpenClaw Plugin        │
└───────┬────────┴──────┬───────┴────────┬────────────────┘
        │               │                │
        ▼               ▼                ▼
┌─────────────────────────────────────────────────────────┐
│               Fastify API Server (server.ts)            │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │   Auth        │  │   Routes     │  │  Middleware    │  │
│  │  (auth.ts)    │  │  agents.ts   │  │  Bearer token │  │
│  │  API keys +   │  │  sessions.ts │  │  auth check   │  │
│  │  dev bypass   │  │  memory.ts   │  │               │  │
│  └──────────────┘  │  recall.ts   │  └───────────────┘  │
│                    │  search.ts   │                      │
│                    │  edges.ts    │                      │
│                    │  keys.ts     │                      │
│                    └──────────────┘                      │
│                                                         │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                 Services Layer                       │ │
│  │  extraction.ts  — LLM-powered fact/decision/task    │ │
│  │                   extraction from messages           │ │
│  │  summarizer.ts  — Session summarization             │ │
│  │  dedup.ts       — Two-stage deduplication           │ │
│  │  decay.ts       — TTL-based memory lifecycle        │ │
│  │  querylog.ts    — Query analytics                   │ │
│  │  jobs.ts        — Background job scheduling         │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─────────────────────────────────────────────────────┐ │
│  │             Embedding Layer                          │ │
│  │  embedding/index.ts — Provider abstraction          │ │
│  │  embedding/gemini.ts — Gemini text-embedding-004    │ │
│  │  embedding/openai.ts — OpenAI ada-002               │ │
│  │  embedding/ollama.ts — Local Ollama models          │ │
│  └─────────────────────────────────────────────────────┘ │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│            PostgreSQL 16 + pgvector + pg_trgm           │
│                                                         │
│  agents │ sessions │ session_messages │ facts            │
│  decisions │ tasks │ events │ projects │ edges           │
│  api_keys │ query_log                                   │
│                                                         │
│  All memory tables have: embedding (vector 768),        │
│  decay_status, agent_id, created_at                     │
└─────────────────────────────────────────────────────────┘
```

### Request Lifecycle

1. **Auth** — `Bearer` token extracted, validated against `api_keys` table (or dev key bypass)
2. **Routing** — Fastify routes dispatch to handlers
3. **Embedding** — Content is auto-embedded on write (async, non-blocking)
4. **Extraction** — Session messages trigger LLM extraction of facts/decisions/tasks/events
5. **Dedup** — New items are checked against existing memory (trigram + cosine similarity)
6. **Decay** — Background sweeper moves items through `active → cooling → archived`

---

## Project Structure

```
hexmem/
├── src/
│   ├── server.ts           # Fastify server bootstrap + middleware
│   ├── config.ts           # Centralized config from env vars
│   ├── cli.ts              # CLI interface (agents, recall, store, status, etc.)
│   ├── db/
│   │   ├── connection.ts   # PostgreSQL pool + query helper
│   │   └── migrate.ts      # Migration runner (reads migrations/*.sql)
│   ├── routes/
│   │   ├── agents.ts       # Agent CRUD
│   │   ├── sessions.ts     # Session lifecycle + message ingestion
│   │   ├── memory.ts       # Facts/decisions/tasks/events/projects CRUD
│   │   ├── recall.ts       # Hybrid recall (semantic + keyword + recency)
│   │   ├── search.ts       # Direct vector search
│   │   ├── edges.ts        # Relationship graph
│   │   └── keys.ts         # API key management
│   ├── services/
│   │   ├── auth.ts         # Bearer token auth + dev key bypass
│   │   ├── extraction.ts   # LLM-powered structured data extraction
│   │   ├── summarizer.ts   # Session summarization via LLM
│   │   ├── dedup.ts        # Syntactic (trigram) + semantic (cosine) dedup
│   │   ├── decay.ts        # Memory lifecycle sweeper
│   │   ├── querylog.ts     # Query analytics tracking
│   │   └── jobs.ts         # Background job scheduler (decay sweeps)
│   │   └── embedding/      # Embedding provider abstraction
│   └── types/
│       └── index.ts        # Shared TypeScript types
├── sdk/
│   ├── index.ts            # SDK entry point + re-exports
│   ├── client.ts           # HexMem client class
│   ├── types.ts            # SDK types
│   └── openclaw-tools.ts   # OpenClaw tool definitions
├── tools/                 # (not tracked) Internal migration + setup scripts
├── tests/
│   ├── helpers.ts                 # Test utilities
│   ├── phase1-foundation.test.ts  # Agent + DB foundation tests
│   ├── phase2-sessions.test.ts    # Session lifecycle tests
│   ├── phase3-structured.test.ts  # Structured memory CRUD tests
│   ├── phase4-recall.test.ts      # Hybrid recall tests
│   └── phase5-sdk.test.ts         # SDK integration tests
├── migrations/            # Numbered SQL migrations (001-011)
├── compose.yaml           # Docker Compose for PostgreSQL
├── Dockerfile             # Production container build
├── tsconfig.json
└── package.json
```

---

## Database Schema

### Core Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `agents` | Agent registry | `id`, `slug`, `display_name`, `core_memory` (JSONB) |
| `sessions` | Conversation sessions | `agent_id`, `status`, `summary`, `metadata` |
| `session_messages` | Individual messages | `session_id`, `role`, `content`, `embedding` |
| `facts` | Knowledge statements | `agent_id`, `content`, `subject`, `confidence`, `embedding` |
| `decisions` | Choices with rationale | `agent_id`, `title`, `decision`, `rationale`, `embedding` |
| `tasks` | Work items | `agent_id`, `title`, `priority`, `status`, `embedding` |
| `events` | Timestamped occurrences | `agent_id`, `title`, `event_type`, `severity`, `embedding` |
| `projects` | Grouping containers | `agent_id`, `name`, `status`, `metadata` |
| `edges` | Relationship graph | `source_type`, `source_id`, `target_type`, `target_id`, `relation` |
| `api_keys` | Auth keys | `key_hash`, `agent_id`, `permissions` |
| `query_log` | Query analytics | `agent_id`, `query_text`, `result_count`, `latency_ms` |

### Shared Columns

All memory tables include:
- `embedding vector(768)` — auto-generated via Gemini/OpenAI
- `decay_status` — `active`, `cooling`, or `archived`
- `agent_id` — scoping to a specific agent
- `created_at`, `updated_at`

### Migrations

Migrations live in `migrations/` and run in order (001-011). The migrator (`src/db/migrate.ts`) tracks applied migrations in a `_migrations` table.

```bash
# Run migrations manually
npm run migrate

# Migrations are also auto-applied on server boot
```

---

## Services Deep Dive

### Hybrid Recall (`routes/recall.ts`)

The recall endpoint runs three parallel searches and combines them:

1. **Semantic** — Embeds the query via the configured provider, then runs pgvector cosine similarity (`1 - (embedding <=> query)`)
2. **Keyword** — Uses pg_trgm trigram matching (`similarity(content, query) > 0.1`)
3. **Recency** — Time decay over 90 days (`1 - age/maxAge`)

Final score: `semantic * 0.7 + keyword * 0.2 + recency * 0.1` (weights configurable per request).

Optional 1-hop graph traversal adds related items via edges.

### Extraction (`services/extraction.ts`)

When a session message is ingested, an LLM (Gemini) extracts structured data:
- Facts, decisions, tasks, events are automatically created
- Each extracted item gets auto-embedded and dedup-checked
- Extraction runs async (non-blocking on the message insert)

### Dedup (`services/dedup.ts`)

Two-stage deduplication:
1. **Syntactic** — pg_trgm trigram similarity ≥ 0.7
2. **Semantic** — pgvector cosine similarity ≥ 0.92

Duplicates are logged but not inserted. The threshold values are tuned to avoid false positives.

### Decay (`services/decay.ts`)

Memory lifecycle engine:
- **Active** → **Cooling** → **Archived** based on configurable TTLs
- Items with high `access_count` are immune to decay
- Background sweeper runs periodically via `services/jobs.ts`
- Manual sweep available via `POST /api/v1/decay/sweep`

### Embedding (`services/embedding/`)

Provider abstraction layer:
- **Gemini** (default) — `text-embedding-004`, 768 dimensions
- **OpenAI** — `text-embedding-ada-002`
- **Ollama** — local models

Embeddings are generated on write (facts, decisions, tasks, events, session messages). The provider auto-detects from available API keys.

---

## Testing

```bash
# Start server first (tests hit the live API)
npm run dev

# Run all tests (78 tests, ~20s)
npm test

# Watch mode
npm run test:watch
```

Tests are organized by phase:
- **Phase 1** — Agent creation, DB connectivity, migrations
- **Phase 2** — Session lifecycle, message ingestion, extraction
- **Phase 3** — Structured memory CRUD (facts, decisions, tasks, events, projects)
- **Phase 4** — Hybrid recall, search, relationship graph
- **Phase 5** — SDK client integration

---

---

## Adding New Features

### Adding a New Memory Type

1. **Migration** — Create `migrations/NNN_<name>.sql` with the table (include `embedding vector(768)`, `decay_status`, `agent_id`)
2. **Route** — Add CRUD handlers in `src/routes/memory.ts` or a new route file
3. **Register** — Wire the route in `src/server.ts`
4. **Recall config** — Add the table to `RECALL_TABLES` in `src/routes/recall.ts`
5. **CLI** — Add the type to `src/cli.ts` store/recall commands
6. **SDK** — Add `store<Type>()` method in `sdk/client.ts`
8. **Test** — Add tests in `tests/`

### Adding a New Embedding Provider

1. Create `src/services/embedding/<provider>.ts` implementing the `EmbeddingProvider` interface
2. Register it in `src/services/embedding/index.ts`
3. Update config in `src/config.ts`

---

## License

HexMem is licensed under the [GNU Affero General Public License v3.0](LICENSE).

This means you can freely use, modify, and distribute HexMem, but if you run a modified version as a service (e.g., SaaS), you must make your source code available under the same license.

**For commercial licensing** (proprietary use without AGPL obligations), contact [d.logan.hart@gmail.com](mailto:d.logan.hart@gmail.com).
