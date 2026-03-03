import type { Request, Response, NextFunction } from 'express';

/**
 * Validate that specified params are valid integers.
 * Usage: validateParams('threadId', 'nodeId')
 */
export function validateParams(...paramNames: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    for (const name of paramNames) {
      const raw = req.params[name];
      const val = parseInt(raw as string);
      if (isNaN(val)) {
        return res.status(400).json({ error: `Invalid ${name}: must be an integer` });
      }
      (req.params as Record<string, string | number>)[name] = val;
    }
    next();
  };
}

/**
 * Validate that required body fields are present.
 * Usage: requireBody('title', 'content')
 */
export function requireBody(...fields: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    for (const field of fields) {
      if (req.body[field] === undefined || req.body[field] === null) {
        return res.status(400).json({ error: `${field} is required` });
      }
    }
    next();
  };
}
