import type { Request, Response, NextFunction } from 'express';
import config from '../config.js';

export function aiTimeout(req: Request, res: Response, next: NextFunction): void {
  res.setTimeout(config.gemini.timeout, () => {
    res.status(504).send('Request timeout');
  });
  next();
}
