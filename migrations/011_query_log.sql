-- 011_query_log.sql
-- Query logging for analytics and debugging

CREATE TABLE IF NOT EXISTS query_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID REFERENCES agents(id) ON DELETE SET NULL,
  endpoint      TEXT NOT NULL,
  query_text    TEXT,
  result_count  INTEGER,
  latency_ms    REAL,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_query_log_agent ON query_log(agent_id);
CREATE INDEX idx_query_log_created ON query_log(created_at);
CREATE INDEX idx_query_log_endpoint ON query_log(endpoint);
