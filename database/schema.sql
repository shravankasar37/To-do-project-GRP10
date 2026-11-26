-- =====================================================================
-- To-Do App (GRP 10) — PostgreSQL schema
-- Tables: users (with User/Admin role) and tasks (each task belongs to a user)
--
-- Run this file while connected to the "todo_app" database:
--   psql -U postgres -d todo_app -f database/schema.sql
-- WARNING: it drops and re-creates the tables, so all existing data is lost.
-- Use it for local development only.
-- =====================================================================

DROP VIEW  IF EXISTS user_task_stats;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS users;
DROP FUNCTION IF EXISTS set_updated_at();

-- ---------------------------------------------------------------------
-- users: everyone who can log in. "role" decides User vs Admin.
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(255) NOT NULL,
    permissions   TEXT[] NOT NULL DEFAULT '{}' CHECK (permissions <@ ARRAY['view_users', 'view_tasks']::text[]),
    password_hash TEXT         NOT NULL,          -- bcrypt hash, never the plain password
    role          VARCHAR(10)  NOT NULL DEFAULT 'user'
                  CHECK (role IN ('user', 'admin')),
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE, -- admin can deactivate a user ("Manage users")
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One account per email, ignoring upper/lower case (Test@x.com = test@x.com)
CREATE UNIQUE INDEX users_email_unique ON users (LOWER(email));

-- ---------------------------------------------------------------------
-- tasks: every task belongs to exactly one user (user_id).
-- Deleting a user also deletes their tasks (ON DELETE CASCADE).
-- ---------------------------------------------------------------------
CREATE TABLE tasks (
    id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      INTEGER      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title        VARCHAR(200) NOT NULL CHECK (LENGTH(TRIM(title)) > 0),
    description  TEXT,
    status       VARCHAR(10)  NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'completed')),
    priority     VARCHAR(10)  NOT NULL DEFAULT 'medium'
                 CHECK (priority IN ('low', 'medium', 'high')),
    due_date     DATE,
    completed_at TIMESTAMPTZ,                     -- set when status becomes 'completed'
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Fast lookups for "my tasks" and the Pending / Completed filters
CREATE INDEX tasks_user_id_idx        ON tasks (user_id);
CREATE INDEX tasks_user_id_status_idx ON tasks (user_id, status);

-- ---------------------------------------------------------------------
-- Keep updated_at correct automatically on every UPDATE
-- ---------------------------------------------------------------------
CREATE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Admin dashboard: task statistics per user (read-only view)
--   SELECT * FROM user_task_stats;
-- ---------------------------------------------------------------------
CREATE VIEW user_task_stats AS
SELECT
    u.id                                              AS user_id,
    u.name,
    u.email,
    u.role,
    u.is_active,
    COUNT(t.id)                                       AS total_tasks,
    COUNT(t.id) FILTER (WHERE t.status = 'pending')   AS pending_tasks,
    COUNT(t.id) FILTER (WHERE t.status = 'completed') AS completed_tasks
FROM users u
LEFT JOIN tasks t ON t.user_id = u.id
GROUP BY u.id;
