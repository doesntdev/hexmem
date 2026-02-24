-- 001_extensions.sql
-- Enable required PostgreSQL extensions

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Migration tracking table
CREATE TABLE IF NOT EXISTS _migrations (
  id            SERIAL PRIMARY KEY,
  name          TEXT UNIQUE NOT NULL,
  applied_at    TIMESTAMPTZ DEFAULT NOW()
);
