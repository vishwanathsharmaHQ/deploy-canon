import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config.js';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    req.user = jwt.verify(auth.slice(7), config.jwt.secret) as { id: number; email: string; name: string };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
