import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDb } from '../db/database';
import { config } from '../config';
import { requireAuth } from '../middleware/auth';

const router = Router();

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

function signAccess(user: { id: string; username: string; role: string }) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, config.JWT_SECRET, {
    expiresIn: config.JWT_ACCESS_TTL as any,
  });
}

function signRefresh(user: { id: string }) {
  const token = jwt.sign({ id: user.id }, config.JWT_SECRET, { expiresIn: config.JWT_REFRESH_TTL as any });
  return token;
}

// POST /api/auth/login
router.post('/login', (req: Request, res: Response) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'username and password required' });
    return;
  }
  const { username, password } = parsed.data;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username) as any;
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
    return;
  }
  const accessToken = signAccess(user);
  const refreshToken = signRefresh(user);
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, user.id, expiresAt);

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ success: true, data: { accessToken, user: { id: user.id, username: user.username, role: user.role } } });
});

// POST /api/auth/refresh
router.post('/refresh', (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ success: false, error: 'No refresh token' });
    return;
  }
  try {
    const payload = jwt.verify(refreshToken, config.JWT_SECRET) as { id: string };
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const db = getDb();
    const stored = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ? AND expires_at > ?').get(tokenHash, new Date().toISOString()) as any;
    if (!stored) {
      res.status(401).json({ success: false, error: 'Refresh token revoked or expired' });
      return;
    }
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ? AND is_active = 1').get(payload.id) as any;
    if (!user) {
      res.status(401).json({ success: false, error: 'User not found' });
      return;
    }
    // Rotate refresh token
    db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(tokenHash);
    const newRefresh = signRefresh(user);
    const newHash = crypto.createHash('sha256').update(newRefresh).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(newHash, user.id, expiresAt);

    res.cookie('refresh_token', newRefresh, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ success: true, data: { accessToken: signAccess(user) } });
  } catch {
    res.status(401).json({ success: false, error: 'Invalid refresh token' });
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refresh_token;
  if (refreshToken) {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    getDb().prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(tokenHash);
  }
  res.clearCookie('refresh_token');
  res.json({ success: true, data: { message: 'Logged out' } });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({ success: true, data: req.user });
});

export default router;
