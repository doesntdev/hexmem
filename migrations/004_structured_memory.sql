-- 004_structured_memory.sql
-- Projects, Tasks, Facts, Decisions, Events

-- Projects (must come first, referenced by others)
CREATE TABLE projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  status        TEXT DEFAULT 'active'
                  CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, slug)
);

CREATE INDEX idx_projects_agent ON projects(agent_id);

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Tasks
CREATE TABLE tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'not_started'
                  CHECK (status IN ('not_started', 'in_progress', 'blocked', 'complete', 'cancelled')),
  priority      INTEGER DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
  assignee      TEXT,
  due_date      DATE,
  blocked_by    UUID REFERENCES tasks(id) ON DELETE SET NULL,
  tags          TEXT[] DEFAULT '{}',
  metadata      JSONB DEFAULT '{}',
  embedding     vector(768),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX idx_tasks_agent_status ON tasks(agent_id, status);
CREATE INDEX idx_tasks_project      ON tasks(project_id);
CREATE INDEX idx_tasks_priority     ON tasks(agent_id, priority DESC);
CREATE INDEX idx_tasks_tags         ON tasks USING gin(tags);

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Facts
CREATE TABLE facts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  subject       TEXT,
  confidence    REAL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  source        TEXT,
  tags          TEXT[] DEFAULT '{}',
  verified      BOOLEAN DEFAULT FALSE,
  valid_from    TIMESTAMPTZ DEFAULT NOW(),
  valid_until   TIMESTAMPTZ,
  superseded_by UUID REFERENCES facts(id) ON DELETE SET NULL,
  embedding     vector(768),
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_facts_agent     ON facts(agent_id);
CREATE INDEX idx_facts_subject   ON facts(agent_id, subject);
CREATE INDEX idx_facts_tags      ON facts USING gin(tags);

CREATE TRIGGER trg_facts_updated_at
  BEFORE UPDATE ON facts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Decisions
CREATE TABLE decisions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  decision      TEXT NOT NULL,
  rationale     TEXT NOT NULL,
  alternatives  JSONB DEFAULT '[]',
  context       TEXT,
  session_id    UUID REFERENCES sessions(id) ON DELETE SET NULL,
  tags          TEXT[] DEFAULT '{}',
  embedding     vector(768),
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_decisions_agent   ON decisions(agent_id);
CREATE INDEX idx_decisions_project ON decisions(project_id);
CREATE INDEX idx_decisions_tags    ON decisions USING gin(tags);

-- Events
CREATE TABLE events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  event_type    TEXT NOT NULL
                  CHECK (event_type IN ('incident', 'milestone', 'release', 'discovery', 'blocker', 'resolution')),
  description   TEXT,
  outcome       TEXT,
  caused_by     UUID REFERENCES events(id) ON DELETE SET NULL,
  severity      TEXT DEFAULT 'info'
                  CHECK (severity IN ('info', 'warning', 'critical')),
  tags          TEXT[] DEFAULT '{}',
  embedding     vector(768),
  metadata      JSONB DEFAULT '{}',
  occurred_at   TIMESTAMPTZ DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX idx_events_agent   ON events(agent_id);
CREATE INDEX idx_events_project ON events(project_id);
CREATE INDEX idx_events_type    ON events(agent_id, event_type);
CREATE INDEX idx_events_tags    ON events USING gin(tags);
