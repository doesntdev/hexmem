-- 007_api_keys.sql
-- Standalone API key authentication

CREATE TABLE api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash      TEXT UNIQUE NOT NULL,
  key_prefix    TEXT NOT NULL,
  name          TEXT NOT NULL,
  agent_id      UUID REFERENCES agents(id) ON DELETE CASCADE,
  permissions   TEXT[] DEFAULT '{read,write}',
  rate_limit    INTEGER DEFAULT 1000,
  expires_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_hash    ON api_keys(key_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_agent   ON api_keys(agent_id);
CREATE INDEX idx_api_keys_prefix  ON api_keys(key_prefix);
