import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { getDb } from '../db/database';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();
router.use(requireAuth, requireRole('root'));

const CreateUserSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8),
  role: z.enum(['user', 'root']).default('user'),
});

const UpdateUserSchema = z.object({
  password: z.string().min(8).optional(),
  role: z.enum(['user', 'root']).optional(),
  is_active: z.boolean().optional(),
});

function safe(user: any) {
  const { password_hash, ...rest } = user;
  return rest;
}

// GET /api/users
router.get('/', (_req: Request, res: Response) => {
  const users = getDb().prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.json({ success: true, data: users.map(safe) });
});

// POST /api/users
router.post('/', (req: Request, res: Response) => {
  const parsed = CreateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.message });
    return;
  }
  const { username, password, role } = parsed.data;
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    res.status(409).json({ success: false, error: 'Username already taken' });
    return;
  }
  const id = randomUUID();
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(id, username, hash, role);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.status(201).json({ success: true, data: safe(user) });
});

// PATCH /api/users/:id
router.patch('/:id', (req: Request, res: Response) => {
  const parsed = UpdateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.message });
    return;
  }
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
  if (!user) {
    res.status(404).json({ success: false, error: 'User not found' });
    return;
  }
  const { password, role, is_active } = parsed.data;
  if (password) {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(bcrypt.hashSync(password, 12), req.params.id);
  }
  if (role !== undefined) {
    db.prepare("UPDATE users SET role = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(role, req.params.id);
  }
  if (is_active !== undefined) {
    db.prepare("UPDATE users SET is_active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(is_active ? 1 : 0, req.params.id);
  }
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  res.json({ success: true, data: safe(updated) });
});

// DELETE /api/users/:id
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
  if (!user) {
    res.status(404).json({ success: false, error: 'User not found' });
    return;
  }
  if (user.role === 'root') {
    res.status(400).json({ success: false, error: 'Cannot delete root user' });
    return;
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true, data: { deleted: true } });
});

export default router;
