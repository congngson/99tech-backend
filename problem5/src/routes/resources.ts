import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getDb } from '../db/database';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const CreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
});

const UpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
});

const ListQuerySchema = z.object({
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  sort: z.enum(['asc', 'desc']).default('desc'),
});

function ok(res: Response, data: unknown, status = 200) {
  res.status(status).json({ success: true, data });
}
function fail(res: Response, message: string, status = 400) {
  res.status(status).json({ success: false, error: message });
}

// GET /api/resources
router.get('/', (req: Request, res: Response) => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(res, parsed.error.message);

  const { status, q, page, limit, sort } = parsed.data;
  const db = getDb();
  const offset = (page - 1) * limit;
  const isRoot = req.user!.role === 'root';

  let where = isRoot ? '1=1' : 'created_by = ?';
  const baseParams: unknown[] = isRoot ? [] : [req.user!.id];

  if (status) { where += ' AND status = ?'; baseParams.push(status); }
  if (q) { where += ' AND (name LIKE ? OR description LIKE ?)'; baseParams.push(`%${q}%`, `%${q}%`); }

  const total = (db.prepare(`SELECT COUNT(*) as c FROM resources WHERE ${where}`).get(...baseParams) as { c: number }).c;
  const items = db.prepare(`SELECT * FROM resources WHERE ${where} ORDER BY created_at ${sort} LIMIT ? OFFSET ?`).all(...baseParams, limit, offset);
  ok(res, { items, total, page, limit, pages: Math.ceil(total / limit) });
});

// POST /api/resources
router.post('/', (req: Request, res: Response) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed.error.message);

  const { name, description, status } = parsed.data;
  const id = randomUUID();
  const db = getDb();

  db.prepare('INSERT INTO resources (id, name, description, status, created_by) VALUES (?, ?, ?, ?, ?)').run(id, name, description, status, req.user!.id);
  const created = db.prepare('SELECT * FROM resources WHERE id = ?').get(id);
  ok(res, created, 201);
});

// GET /api/resources/:id
router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(req.params.id) as any;
  if (!resource) return fail(res, 'Resource not found', 404);
  if (req.user!.role !== 'root' && resource.created_by !== req.user!.id) return fail(res, 'Forbidden', 403);
  ok(res, resource);
});

// PATCH /api/resources/:id
router.patch('/:id', (req: Request, res: Response) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed.error.message);

  const db = getDb();
  const existing = db.prepare('SELECT * FROM resources WHERE id = ?').get(req.params.id) as any;
  if (!existing) return fail(res, 'Resource not found', 404);
  if (req.user!.role !== 'root' && existing.created_by !== req.user!.id) return fail(res, 'Forbidden', 403);

  const fields = parsed.data;
  if (Object.keys(fields).length === 0) return fail(res, 'No fields to update');

  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  const values = Object.values(fields);
  db.prepare(`UPDATE resources SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(...values, req.params.id);

  const updated = db.prepare('SELECT * FROM resources WHERE id = ?').get(req.params.id);
  ok(res, updated);
});

// DELETE /api/resources/:id
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM resources WHERE id = ?').get(req.params.id) as any;
  if (!existing) return fail(res, 'Resource not found', 404);
  if (req.user!.role !== 'root' && existing.created_by !== req.user!.id) return fail(res, 'Forbidden', 403);
  db.prepare('DELETE FROM resources WHERE id = ?').run(req.params.id);
  ok(res, { deleted: true });
});

export default router;
