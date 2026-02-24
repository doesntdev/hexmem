-- Add missing columns to projects table for consistency with other memory types

ALTER TABLE projects ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS embedding vector(768);

-- Add decay tracking to projects (was missed in 008)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS access_count INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS decay_status TEXT DEFAULT 'active'
  CHECK (decay_status IN ('active', 'cooling', 'archived'));

CREATE INDEX IF NOT EXISTS idx_projects_tags ON projects USING gin(tags);
