ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT[] NOT NULL DEFAULT '{}'
    CHECK (permissions <@ ARRAY['view_users', 'view_tasks']::text[]);
