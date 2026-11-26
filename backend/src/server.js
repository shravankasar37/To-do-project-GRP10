import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { pool } from './db.js';
import authRoutes from './routes/auth.js';
import taskRoutes from './routes/tasks.js';
import adminRoutes from './routes/admin.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: 'http://localhost:4200' });
await app.register(jwt, { secret: process.env.JWT_SECRET, sign: { expiresIn: '8h' } });

// Checks the "Authorization: Bearer <token>" header on protected routes.
app.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ message: 'Please sign in again.' });
  }
  const { rows } = await pool.query('SELECT role, is_active FROM users WHERE id = $1', [request.user.id]);
  if (!rows[0] || !rows[0].is_active) {
    return reply.code(401).send({ message: 'Your account is inactive. Contact the admin.' });
  }
  request.user.role = rows[0].role; // always use the latest role from the database
});

// Only lets admins through (use after authenticate).
app.decorate('requireAdmin', async (request, reply) => {
  if (request.user.role !== 'admin') {
    return reply.code(403).send({ message: 'Only admins can do this.' });
  }
});

// Every error goes back as { message: "..." } because the frontend shows error.message.
app.setErrorHandler((error, request, reply) => {
  if (error.validation) return reply.code(400).send({ message: error.message });
  if (error.code === '23505') return reply.code(409).send({ message: 'This email is already registered.' });
  request.log.error(error);
  return reply.code(error.statusCode || 500).send({ message: error.statusCode ? error.message : 'Something went wrong on the server.' });
});

app.get('/api/health', async () => ({ status: 'ok' }));

await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(taskRoutes, { prefix: '/api/tasks' });
await app.register(adminRoutes, { prefix: '/api/admin' });

const production = process.env.NODE_ENV === 'production';
if (production) {
  await app.register(staticFiles, {
    root: fileURLToPath(new URL('../../frontend/dist/todo/browser/', import.meta.url))
  });
  for (const path of ['/login', '/admin/login']) {
    app.get(path, (_request, reply) => reply.sendFile('index.html'));
  }
}
await app.listen({ port: Number(process.env.PORT) || 5000, host: production ? '0.0.0.0' : 'localhost' });
