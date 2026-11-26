import bcrypt from 'bcryptjs';
import { pool } from '../db.js';

export default async function authRoutes(app) {
  // POST /api/auth/register { name, email, password }
  app.post('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          email: { type: 'string', format: 'email', maxLength: 255 },
          password: { type: 'string', minLength: 6, maxLength: 72 }
        }
      }
    }
  }, async (request, reply) => {
    const name = request.body.name.trim();
    const email = request.body.email.trim().toLowerCase();
    if (!name) return reply.code(400).send({ message: 'Name is required.' });
    const passwordHash = await bcrypt.hash(request.body.password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
       RETURNING id, name, email, role`,
      [name, email, passwordHash]
    ); // new accounts are always role 'user' (database default)
    return reply.code(201).send(rows[0]);
  });

  // POST /api/auth/login { email, password } -> { token, user: { id, name, email, role } }
  app.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string' }, password: { type: 'string' },
          portal: { type: 'string', enum: ['user', 'admin'], default: 'user' }
        }
      }
    }
  }, async (request, reply) => {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, permissions, is_active, password_hash FROM users WHERE LOWER(email) = LOWER($1)',
      [request.body.email.trim()]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(request.body.password, user.password_hash))) {
      return reply.code(401).send({ message: 'Invalid email or password.' });
    }
    if (!user.is_active) {
      return reply.code(403).send({ message: 'Your account is inactive. Contact the admin.' });
    }
    const delegatedLogin = request.body.portal === 'admin' && user.permissions.length > 0;
    if (request.body.portal !== user.role && !delegatedLogin) {
      return reply.code(403).send({ message: user.role === 'admin'
        ? 'Use Admin sign in for this account.' : 'This account does not have admin access. Use User sign in.' });
    }
    const {id, name, email, role, permissions} = user;
    const portal = request.body.portal;
    const token = app.jwt.sign({id, role, permissions, portal});
    return {token, user: {id, name, email, role, permissions, portal}};
  });
}
