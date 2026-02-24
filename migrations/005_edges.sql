-- 005_edges.sql
-- In-database relationship graph (no Neo4j needed)

CREATE TABLE memory_edges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  source_type   TEXT NOT NULL CHECK (source_type IN ('task', 'fact', 'decision', 'event', 'session', 'project')),
  source_id     UUID NOT NULL,
  target_type   TEXT NOT NULL CHECK (target_type IN ('task', 'fact', 'decision', 'event', 'session', 'project')),
  target_id     UUID NOT NULL,
  relation      TEXT NOT NULL CHECK (relation IN (
    'caused_by', 'decided_in', 'blocks', 'relates_to', 'supersedes', 'part_of',
    'led_to', 'references', 'depends_on', 'derived_from'
  )),
  weight        REAL DEFAULT 1.0,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_type, source_id, target_type, target_id, relation)
);

CREATE INDEX idx_edges_source  ON memory_edges(source_type, source_id);
CREATE INDEX idx_edges_target  ON memory_edges(target_type, target_id);
CREATE INDEX idx_edges_agent   ON memory_edges(agent_id);
CREATE INDEX idx_edges_relation ON memory_edges(agent_id, relation);
