-- 003_sessions.sql
-- Session-based semantic memory

CREATE TABLE sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  external_id   TEXT,
  metadata      JSONB DEFAULT '{}',
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  summary       TEXT
);

CREATE INDEX idx_sessions_agent    ON sessions(agent_id);
CREATE INDEX idx_sessions_external ON sessions(agent_id, external_id);
CREATE INDEX idx_sessions_started  ON sessions(agent_id, started_at DESC);

CREATE TABLE session_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content       TEXT NOT NULL,
  embedding     vector(768),
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_session_msgs_session ON session_messages(session_id);
CREATE INDEX idx_session_msgs_agent   ON session_messages(agent_id);
CREATE INDEX idx_session_msgs_created ON session_messages(agent_id, created_at DESC);

-- IVFFlat index for cosine similarity search
-- Note: requires at least 100 rows to be effective; will be created separately
-- once data is populated. For initial use, pgvector falls back to sequential scan.
