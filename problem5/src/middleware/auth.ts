import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { getDb } from '../db/database';

export interface AuthUser {
  id: string;
  username: string;
  role: 'root' | 'user';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing or invalid Authorization header' });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as AuthUser & { iat: number; exp: number };
    // Verify user still exists and is active
    const user = getDb().prepare('SELECT id, username, role, is_active FROM users WHERE id = ?').get(payload.id) as any;
    if (!user || !user.is_active) {
      res.status(401).json({ success: false, error: 'User not found or inactive' });
      return;
    }
    req.user = { id: user.id, username: user.username, role: user.role };
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

export function requireRole(role: 'root' | 'user') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Unauthenticated' });
      return;
    }
    if (req.user.role !== role) {
      res.status(403).json({ success: false, error: 'Forbidden: insufficient permissions' });
      return;
    }
    next();
  };
}
