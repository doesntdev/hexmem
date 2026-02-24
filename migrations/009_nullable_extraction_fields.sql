-- Make optional fields nullable for LLM extraction robustness
-- The extraction LLM may not always provide all fields

ALTER TABLE decisions ALTER COLUMN rationale DROP NOT NULL;
ALTER TABLE tasks ALTER COLUMN description DROP NOT NULL;
ALTER TABLE events ALTER COLUMN description DROP NOT NULL;
