-- 006_indexes.sql
-- Additional performance indexes

-- Full-text search on content fields
CREATE INDEX idx_facts_content_trgm    ON facts USING gin(content gin_trgm_ops);
CREATE INDEX idx_decisions_title_trgm  ON decisions USING gin(title gin_trgm_ops);
CREATE INDEX idx_tasks_title_trgm      ON tasks USING gin(title gin_trgm_ops);
CREATE INDEX idx_events_title_trgm     ON events USING gin(title gin_trgm_ops);

-- Session message content trigram for text search fallback
CREATE INDEX idx_session_msgs_content_trgm ON session_messages USING gin(content gin_trgm_ops);

-- Composite indexes for common dashboard queries
CREATE INDEX idx_tasks_agent_project_status ON tasks(agent_id, project_id, status);
CREATE INDEX idx_events_agent_occurred      ON events(agent_id, occurred_at DESC);
CREATE INDEX idx_decisions_agent_created    ON decisions(agent_id, created_at DESC);
CREATE INDEX idx_facts_agent_created        ON facts(agent_id, created_at DESC);
