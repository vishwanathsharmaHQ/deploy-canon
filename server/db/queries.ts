import { getNeo4j, toNum } from './driver.js';
import type { Session, Transaction } from 'neo4j-driver';
import type { Neo4jProps, NeoRecord, NodeData, SourceData, RelationshipData, ThreadData, ThreadNodeEntry, EntityType, RelationType, RelationshipProps } from '../types/domain.js';

// ── Entity Types ──────────────────────────────────────────────────────────
export const ENTITY_TYPES: EntityType[] = ['claim', 'evidence', 'source', 'context', 'example', 'counterpoint', 'synthesis', 'question', 'note'];

// Legacy mapping for backward compatibility during migration
export const NODE_TYPES = ['ROOT', 'EVIDENCE', 'REFERENCE', 'CONTEXT', 'EXAMPLE', 'COUNTERPOINT', 'SYNTHESIS'] as const;

export const RELATIONSHIP_TYPES: RelationType[] = ['SUPPORTS', 'CONTRADICTS', 'QUALIFIES', 'DERIVES_FROM', 'ILLUSTRATES', 'CITES', 'ADDRESSES', 'REFERENCES'];

// ── ID Generation ─────────────────────────────────────────────────────────
export async function getNextId(label: string, runner: Session | Transaction): Promise<number> {
  const result = await runner.run(
    `MERGE (c:Counter {name: $label})
     ON CREATE SET c.seq = 1
     ON MATCH SET c.seq = c.seq + 1
     RETURN c.seq AS id`,
    { label }
  );
  return result.records[0].get('id').toNumber();
}

// ── Vector Query ──────────────────────────────────────────────────────────
export async function vectorQuery(session: Session, indexName: string, k: number, embedding: number[]) {
  try {
    return await session.run(
      `CALL db.index.vector.queryNodes($indexName, $k, $embedding) YIELD node, score RETURN node, score ORDER BY score DESC`,
      { indexName, k: getNeo4j().int(k), embedding }
    );
  } catch (err: unknown) {
    const neo4jErr = err as { message?: string; code?: string };
    if (
      neo4jErr.message &&
      (neo4jErr.message.includes('no such vector schema index') ||
        neo4jErr.message.includes('There is no such index') ||
        neo4jErr.message.includes('IndexNotFoundError')) ||
      neo4jErr.code === 'Neo.ClientError.Procedure.ProcedureCallFailed'
    ) {
      return { records: [] as NeoRecord[] };
    }
    throw err;
  }
}

// ── Formatters ────────────────────────────────────────────────────────────

export function formatNode(props: Neo4jProps): NodeData {
  return {
    id: toNum(props.id),
    title: (props.title as string) || '',
    content: (props.content as string) || '',
    entity_type: (props.entity_type as EntityType) || 'note',
    metadata: props.metadata ? (typeof props.metadata === 'string' ? JSON.parse(props.metadata) : props.metadata as Record<string, unknown>) : {},
    created_at: (props.created_at as string) || '',
    updated_at: (props.updated_at as string) || '',
    created_by: toNum(props.created_by) || null,
    confidence: (props.confidence as number) ?? null,
    summary: (props.summary as string) || '',
  };
}

export function formatSource(props: Neo4jProps): SourceData {
  return {
    id: toNum(props.id),
    title: (props.title as string) || '',
    url: (props.url as string) || null,
    source_type: (props.source_type as string) || 'other',
    authors: props.authors ? (typeof props.authors === 'string' ? JSON.parse(props.authors) : props.authors as string[]) : [],
    published_date: (props.published_date as string) || null,
    content: (props.content as string) || '',
    reliability_score: (props.reliability_score as number) ?? null,
    citation_count: (props.citation_count as number) ?? null,
    created_at: (props.created_at as string) || '',
    updated_at: (props.updated_at as string) || '',
  };
}

export function formatRelationship(relProps: Neo4jProps, relType: string, sourceId: unknown, targetId: unknown): RelationshipData {
  const props: RelationshipProps = {};
  if (relProps.strength != null) props.strength = relProps.strength as number;
  if (relProps.mechanism) props.mechanism = relProps.mechanism as string;
  if (relProps.severity) props.severity = relProps.severity as string;
  if (relProps.explanation) props.explanation = relProps.explanation as string;
  if (relProps.scope) props.scope = relProps.scope as string;
  if (relProps.reasoning) props.reasoning = relProps.reasoning as string;
  if (relProps.confidence != null) props.confidence = relProps.confidence as number;
  if (relProps.relevance != null) props.relevance = relProps.relevance as number;
  if (relProps.page) props.page = relProps.page as string;
  if (relProps.section) props.section = relProps.section as string;
  if (relProps.quote) props.quote = relProps.quote as string;
  if (relProps.anchor_text) props.anchor_text = relProps.anchor_text as string;
  if (relProps.context) props.context = relProps.context as string;
  if (relProps.notes) props.notes = relProps.notes as string;

  return {
    id: toNum(relProps.id) || 0,
    source_id: toNum(sourceId) || 0,
    target_id: toNum(targetId) || 0,
    relation_type: relType as RelationType,
    properties: props,
    created_at: (relProps.created_at as string) || '',
    created_by: toNum(relProps.created_by) || null,
  };
}

export function formatThread(props: Neo4jProps): ThreadData {
  return {
    id: toNum(props.id),
    title: (props.title as string) || '',
    description: (props.description as string) || '',
    thread_type: (props.thread_type as string) || 'argument',
    created_at: (props.created_at as string) || '',
    updated_at: (props.updated_at as string) || '',
    created_by: toNum(props.created_by) || null,
    nodes: [],
  };
}

// ── Schema Setup ──────────────────────────────────────────────────────────

export async function setupSchema(session: Session): Promise<void> {
  // Uniqueness constraints
  const constraints = [
    'CREATE CONSTRAINT IF NOT EXISTS FOR (n:Node) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT IF NOT EXISTS FOR (s:Source) REQUIRE s.id IS UNIQUE',
    'CREATE CONSTRAINT IF NOT EXISTS FOR (t:Thread) REQUIRE t.id IS UNIQUE',
    'CREATE CONSTRAINT IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE',
    'CREATE CONSTRAINT IF NOT EXISTS FOR (c:Counter) REQUIRE c.name IS UNIQUE',
  ];

  // Indexes for fast lookups
  const indexes = [
    'CREATE INDEX IF NOT EXISTS FOR (n:Node) ON (n.entity_type)',
    'CREATE INDEX IF NOT EXISTS FOR (n:Node) ON (n.title)',
    'CREATE INDEX IF NOT EXISTS FOR (s:Source) ON (s.url)',
    'CREATE INDEX IF NOT EXISTS FOR (s:Source) ON (s.title)',
    'CREATE INDEX IF NOT EXISTS FOR (t:Thread) ON (t.title)',
  ];

  for (const q of [...constraints, ...indexes]) {
    await session.run(q);
  }
}
