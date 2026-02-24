-- 008_decay.sql
-- Memory decay system with dashboard visibility

CREATE TABLE decay_policies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID REFERENCES agents(id) ON DELETE CASCADE,
  memory_type   TEXT NOT NULL CHECK (memory_type IN ('fact', 'decision', 'event', 'task', 'session_message')),
  ttl_days      INTEGER,
  access_boost  BOOLEAN DEFAULT TRUE,
  min_accesses  INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, memory_type)
);

-- Add decay tracking columns to all memory tables
ALTER TABLE facts ADD COLUMN access_count INTEGER DEFAULT 0;
ALTER TABLE facts ADD COLUMN last_accessed_at TIMESTAMPTZ;
ALTER TABLE facts ADD COLUMN decay_status TEXT DEFAULT 'active'
  CHECK (decay_status IN ('active', 'cooling', 'archived'));

ALTER TABLE decisions ADD COLUMN access_count INTEGER DEFAULT 0;
ALTER TABLE decisions ADD COLUMN last_accessed_at TIMESTAMPTZ;
ALTER TABLE decisions ADD COLUMN decay_status TEXT DEFAULT 'active'
  CHECK (decay_status IN ('active', 'cooling', 'archived'));

ALTER TABLE events ADD COLUMN access_count INTEGER DEFAULT 0;
ALTER TABLE events ADD COLUMN last_accessed_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN decay_status TEXT DEFAULT 'active'
  CHECK (decay_status IN ('active', 'cooling', 'archived'));

ALTER TABLE tasks ADD COLUMN access_count INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN last_accessed_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN decay_status TEXT DEFAULT 'active'
  CHECK (decay_status IN ('active', 'cooling', 'archived'));

ALTER TABLE session_messages ADD COLUMN access_count INTEGER DEFAULT 0;
ALTER TABLE session_messages ADD COLUMN last_accessed_at TIMESTAMPTZ;
ALTER TABLE session_messages ADD COLUMN decay_status TEXT DEFAULT 'active'
  CHECK (decay_status IN ('active', 'cooling', 'archived'));

-- Indexes for decay queries
CREATE INDEX idx_facts_decay     ON facts(agent_id, decay_status);
CREATE INDEX idx_decisions_decay ON decisions(agent_id, decay_status);
CREATE INDEX idx_events_decay    ON events(agent_id, decay_status);
CREATE INDEX idx_tasks_decay     ON tasks(agent_id, decay_status);
CREATE INDEX idx_session_msgs_decay ON session_messages(agent_id, decay_status);

-- Insert default decay policies
INSERT INTO decay_policies (agent_id, memory_type, ttl_days, access_boost, min_accesses) VALUES
  (NULL, 'fact',            90,  TRUE, 3),
  (NULL, 'decision',       NULL, TRUE, 0),   -- decisions never decay by default
  (NULL, 'event',           30,  TRUE, 2),
  (NULL, 'task',           NULL, TRUE, 0),   -- tasks never decay (lifecycle managed by status)
  (NULL, 'session_message', 60,  TRUE, 5);
