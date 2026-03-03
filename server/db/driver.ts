import neo4j, { type Driver, type Session, type Integer } from 'neo4j-driver';
import config from '../config.js';

let _driver: Driver | null = null;
let _initError: Error | null = null;

export function getDriver(): Driver {
  if (_initError) throw _initError;
  if (_driver) return _driver;
  try {
    _driver = neo4j.driver(
      config.neo4j.uri,
      neo4j.auth.basic(config.neo4j.username, config.neo4j.password)
    );
    return _driver;
  } catch (e) {
    _initError = e as Error;
    throw e;
  }
}

export function getNeo4j(): typeof neo4j {
  getDriver();
  return neo4j;
}

export function toNum(val: unknown): number | null {
  if (val == null) return null;
  if (neo4j.isInt(val)) return (val as Integer).toNumber();
  return val as number;
}

export function getSession(): Session {
  return getDriver().session({ database: config.neo4j.database });
}
