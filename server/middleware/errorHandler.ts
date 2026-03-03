import type { Request, Response, NextFunction } from 'express';

interface HttpError extends Error {
  statusCode?: number;
}

export function errorHandler(err: HttpError, _req: Request, res: Response, _next: NextFunction): void {
  console.error('Unhandled error:', err);
  const status = err.statusCode || 500;
  const message = status === 500 ? 'Internal server error' : err.message;
  res.status(status).json({ error: message });
}
