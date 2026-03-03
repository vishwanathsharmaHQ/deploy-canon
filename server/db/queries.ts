import { getNeo4j, toNum } from './driver.js';
import type { Session, Transaction } from 'neo4j-driver';
import type { Neo4jProps, NeoRecord, NodeData } from '../types/domain.js';

export const NODE_TYPES = ['ROOT', 'EVIDENCE', 'REFERENCE', 'CONTEXT', 'EXAMPLE', 'COUNTERPOINT', 'SYNTHESIS'] as const;

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

export function formatThread(props: Neo4jProps) {
  return {
    id: toNum(props.id),
    title: props.title as string,
    description: props.description as string,
    content: props.content as string,
    metadata: {
      title: props.title,
      description: props.description,
      ...(props.metadata ? JSON.parse(props.metadata as string) : {}),
    },
    created_at: props.created_at as string,
    updated_at: props.updated_at as string,
    nodes: [] as NodeData[],
  };
}

export function formatNode(props: Neo4jProps, parentId: unknown) {
  return {
    id: toNum(props.id),
    title: props.title as string,
    content: props.content as string,
    node_type: props.node_type as string,
    parent_id: toNum(parentId),
    metadata: {
      title: props.title,
      description: props.content ? String(props.content).substring(0, 100) : '',
      ...(props.metadata ? JSON.parse(props.metadata as string) : {}),
    },
    created_at: props.created_at as string,
    updated_at: props.updated_at as string,
    type: NODE_TYPES.indexOf(props.node_type as typeof NODE_TYPES[number]),
  };
}
