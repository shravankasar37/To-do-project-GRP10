import { pool } from '../db.js';

export default async function adminRoutes(app) {
  app.addHook('onRequest', app.authenticate);  // must be logged in
  const allowRead = permission => async (request, reply) => {
    if (request.user.role !== 'admin' &&
        !(request.user.portal === 'admin' && request.user.permissions?.includes(permission))) {
      return reply.code(403).send({message: 'This account does not have access to this section.'});
    }
  };

  // GET /api/admin/users -> all users (never send password_hash)
  app.get('/users', {preHandler: allowRead('view_users')}, async () => {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, permissions, is_active, created_at FROM users ORDER BY id'
    );
    return rows;
  });

  // GET /api/admin/tasks -> every task from every user
  app.get('/tasks', {preHandler: allowRead('view_tasks')}, async () => {
    const { rows } = await pool.query(
      `SELECT id, user_id, title, description, status, priority, due_date, completed_at, created_at, updated_at
       FROM tasks ORDER BY created_at DESC`
    );
    return rows;
  });

  // GET /api/admin/stats -> task statistics (overall + per user)
  app.get('/stats', {preHandler: [allowRead('view_tasks'), allowRead('view_users')]}, async () => {
    const totals = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
       FROM tasks`
    );
    const perUser = await pool.query('SELECT * FROM user_task_stats ORDER BY user_id');
    return { ...totals.rows[0], users: perUser.rows };
  });

  // PATCH /api/admin/users/:id { name } or { is_active }
  app.patch('/users/:id', {
    preHandler: app.requireAdmin,
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          is_active: { type: 'boolean' },
          role: {type: 'string', enum: ['user', 'admin']},
          permissions: {type: 'array', uniqueItems: true, items: {type: 'string', enum: ['view_tasks', 'view_users']}}
        }
      }
    }
  }, async (request, reply) => {
    const { name, is_active, role, permissions } = request.body;
    if ((is_active === false || role !== undefined || permissions !== undefined) && request.params.id === request.user.id) {
      return reply.code(400).send({ message: "You can't change your own access." });
    }
    if (name !== undefined && !name.trim()) return reply.code(400).send({ message: 'Name is required.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Lock in ID order so simultaneous changes cannot remove every active admin.
      const locked = await client.query('SELECT id, role, is_active FROM users WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE',
        [[request.user.id, request.params.id]]);
      const actor = locked.rows.find(row => row.id === request.user.id);
      if (!actor?.is_active || actor.role !== 'admin') {
        await client.query('ROLLBACK');
        return reply.code(403).send({message: 'Full admin access is required.'});
      }
      const {rows} = await client.query(
        `UPDATE users SET name = COALESCE($2, name), is_active = COALESCE($3, is_active),
         role = COALESCE($4, role), permissions = CASE WHEN COALESCE($4, role) = 'admin'
         THEN '{}'::text[] ELSE COALESCE($5::text[], permissions) END
         WHERE id = $1 RETURNING id, name, email, role, permissions, is_active, created_at`,
        [request.params.id, name?.trim() ?? null, is_active ?? null, role ?? null, permissions?.sort() ?? null]);
      await client.query('COMMIT');
      if (!rows[0]) return reply.code(404).send({message: 'User not found.'});
      return rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  });
}
