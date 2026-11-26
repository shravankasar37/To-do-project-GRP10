# Database — PostgreSQL

Owner: Shravan Sunil Kasar (`feature/database`)

| File | What it does |
|---|---|
| `schema.sql` | Creates the tables, indexes, triggers and the admin stats view |
| `seed.sql` | Adds sample users (1 admin, 2 users) and tasks for local testing |

## Setup (local)

1. Install PostgreSQL (with pgAdmin) and remember the password you set for the `postgres` user.
2. Create the database (once):
   ```sql
   CREATE DATABASE todo_app;
   ```
3. Create the tables, then add the sample data:
   ```bash
   psql -U postgres -d todo_app -f database/schema.sql
   psql -U postgres -d todo_app -f database/seed.sql
   ```
   Or in pgAdmin: right-click `todo_app` → **Query Tool** → open each file → **Execute (F5)**.
4. Check:
   ```sql
   SELECT id, name, email, role FROM users;
   SELECT * FROM user_task_stats;
   ```

> `schema.sql` drops and re-creates the tables. Re-running it deletes all data.

## Backend connection

Put this in `backend/.env` (never commit `.env`):

```
DATABASE_URL=postgres://postgres:<your_password>@localhost:5432/todo_app
```

## Tables and fields (use these exact names in the backend)

### `users`
| Field | Type | Rules |
|---|---|---|
| `id` | integer | primary key, auto-generated |
| `name` | varchar(100) | required |
| `email` | varchar(255) | required, unique (case-insensitive) |
| `password_hash` | text | required, **bcrypt hash** (hash in the backend before inserting) |
| `role` | varchar(10) | `'user'` or `'admin'`, default `'user'` |
| `is_active` | boolean | default `true`; admin sets `false` to block a user |
| `created_at` | timestamptz | auto |
| `updated_at` | timestamptz | auto-updated on every change |

### `tasks`
| Field | Type | Rules |
|---|---|---|
| `id` | integer | primary key, auto-generated |
| `user_id` | integer | required, references `users.id` (deleting a user deletes their tasks) |
| `title` | varchar(200) | required, not blank |
| `description` | text | optional |
| `status` | varchar(10) | `'pending'` or `'completed'`, default `'pending'` |
| `priority` | varchar(10) | `'low'`, `'medium'` or `'high'`, default `'medium'` |
| `due_date` | date | optional, format `YYYY-MM-DD` |
| `completed_at` | timestamptz | set it when marking a task completed, clear it when reopening |
| `created_at` | timestamptz | auto |
| `updated_at` | timestamptz | auto-updated on every change |

### View `user_task_stats` (Admin dashboard → task statistics)
`user_id, name, email, role, is_active, total_tasks, pending_tasks, completed_tasks`

## Useful queries for the backend

```sql
-- Login: find the user, then compare the password with bcrypt in the backend
SELECT id, name, email, password_hash, role, is_active FROM users WHERE LOWER(email) = LOWER($1);

-- User dashboard: my tasks, with optional Pending / Completed filter
SELECT * FROM tasks WHERE user_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC;

-- Mark completed / reopen (always check the task belongs to the logged-in user)
UPDATE tasks SET status = 'completed', completed_at = NOW() WHERE id = $1 AND user_id = $2;
UPDATE tasks SET status = 'pending',   completed_at = NULL  WHERE id = $1 AND user_id = $2;

-- Admin: all users, all tasks, overall statistics
SELECT * FROM user_task_stats ORDER BY user_id;
SELECT t.*, u.name AS user_name FROM tasks t JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC;
SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
       COUNT(*) FILTER (WHERE status = 'completed') AS completed
FROM tasks;
```

## Test logins (seed data, local only)

| Email | Password | Role |
|---|---|---|
| admin@todo.test | Admin@123 | admin |
| riya@todo.test | User@123 | user |
| aman@todo.test | User@123 | user |

### Update an existing database for delegated access

Run `database/migrations/001_admin_permissions.sql` once before deploying the access-management update. It preserves accounts and tasks. Fresh installations using the current schema already include the permissions column.

Full admins can use **Registered users ? Manage access** to grant access to all tasks, the user directory, both read-only sections, or full administration. Select **Personal tasks only** to revoke admin portal access. Access changes require the affected account to sign in again on its next protected request.
