import type { Session, Transaction } from 'neo4j-driver';

declare global {
  namespace Express {
    interface Request {
      user?: { id: number; username: string };
      neo4jSession?: Session;
      neo4jTx?: Transaction;
      existingTitles?: string[];
    }
  }
}

export {};
