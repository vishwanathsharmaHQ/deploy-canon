import type { Request, Response, NextFunction } from 'express';
import { getSession } from '../db/driver.js';

type RouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<void | Response>;

/**
 * Wraps a route handler to auto-open/close a Neo4j session.
 * The session is available as req.neo4jSession.
 */
export function withSession(handler: RouteHandler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = getSession();
    req.neo4jSession = session;
    try {
      await handler(req, res, next);
    } catch (err) {
      next(err);
    } finally {
      await session.close();
    }
  };
}

/**
 * Wraps a route handler to auto-open/close a Neo4j transaction.
 * The transaction is available as req.neo4jTx and session as req.neo4jSession.
 * Auto-commits on success, auto-rollbacks on error.
 */
export function withTransaction(handler: RouteHandler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = getSession();
    req.neo4jSession = session;
    const tx = session.beginTransaction();
    req.neo4jTx = tx;
    try {
      await handler(req, res, next);
      await tx.commit();
    } catch (err) {
      try { await tx.rollback(); } catch { /* connection may be dead */ }
      next(err);
    } finally {
      await session.close();
    }
  };
}
