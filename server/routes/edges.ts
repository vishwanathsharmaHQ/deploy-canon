import { Router } from 'express';
import { getNeo4j, toNum } from '../db/driver.js';
import { getNextId, formatRelationship, RELATIONSHIP_TYPES } from '../db/queries.js';
import { requireAuth } from '../middleware/auth.js';
import { withSession, withTransaction } from '../middleware/session.js';
import type { RelationType, RelationshipProps } from '../types/domain.js';

const router = Router();

// POST / -- create a typed relationship
router.post('/', requireAuth, withTransaction(async (req, res) => {
  const { sourceId, targetId, relationType, properties } = req.body;
  const tx = req.neo4jTx!;

  if (!sourceId || !targetId || !relationType) {
    return res.status(400).json({ error: 'sourceId, targetId, and relationType are required' });
  }

  const relType = relationType as RelationType;
  if (!RELATIONSHIP_TYPES.includes(relType)) {
    return res.status(400).json({
      error: `Invalid relationType: ${relationType}. Valid types: ${RELATIONSHIP_TYPES.join(', ')}`,
    });
  }

  const id = await getNextId('relationship', tx);
  const now = new Date().toISOString();

  const relProps: Record<string, unknown> = {
    id: getNeo4j().int(id),
    created_at: now,
    ...(properties || {}),
  };

  // Safe: relationType is validated against whitelist
  const query = `
    MATCH (a:Node {id: $src}), (b {id: $tgt})
    CREATE (a)-[r:${relType} $props]->(b)
    RETURN r, a.id AS src, b.id AS tgt
  `;

  const result = await tx.run(query, {
    src: getNeo4j().int(sourceId),
    tgt: getNeo4j().int(targetId),
    props: relProps,
  });

  if (!result.records.length) {
    return res.status(404).json({ error: 'Source or target node not found' });
  }

  const rel = formatRelationship(
    result.records[0].get('r').properties,
    relType,
    result.records[0].get('src'),
    result.records[0].get('tgt')
  );

  res.json(rel);
}));

// GET /node/:nodeId -- get all relationships for a node (both incoming and outgoing)
router.get('/node/:nodeId', withSession(async (req, res) => {
  const nodeId = parseInt(req.params.nodeId);
  const session = req.neo4jSession!;

  const result = await session.run(
    `MATCH (n:Node {id: $nodeId})
     OPTIONAL MATCH (n)-[rOut]->(target)
     WHERE type(rOut) IN $relTypes
     WITH n, collect({r: rOut, relType: type(rOut), src: n.id, tgt: target.id}) AS outgoing
     OPTIONAL MATCH (source)-[rIn]->(n)
     WHERE type(rIn) IN $relTypes
     WITH outgoing, collect({r: rIn, relType: type(rIn), src: source.id, tgt: n.id}) AS incoming
     RETURN outgoing + incoming AS rels`,
    {
      nodeId: getNeo4j().int(nodeId),
      relTypes: RELATIONSHIP_TYPES as unknown as string[],
    }
  );

  const rels = (result.records[0]?.get('rels') || []) as { r: { properties: Record<string, unknown> } | null; relType: string; src: unknown; tgt: unknown }[];
  const relationships = rels
    .filter(entry => entry.r != null)
    .map(entry =>
      formatRelationship(entry.r!.properties, entry.relType, entry.src, entry.tgt)
    );

  res.json(relationships);
}));

// PUT /:relationshipId -- update relationship properties
router.put('/:relationshipId', requireAuth, withSession(async (req, res) => {
  const relationshipId = parseInt(req.params.relationshipId);
  const { properties } = req.body;
  const session = req.neo4jSession!;

  if (!properties || typeof properties !== 'object') {
    return res.status(400).json({ error: 'properties object is required' });
  }

  // Build SET clause dynamically from provided properties
  const allowedProps: (keyof RelationshipProps)[] = [
    'strength', 'mechanism', 'severity', 'explanation', 'scope',
    'reasoning', 'confidence', 'relevance', 'page', 'section',
    'quote', 'anchor_text', 'context', 'notes',
  ];

  const setClauses: string[] = [];
  const params: Record<string, unknown> = { relId: getNeo4j().int(relationshipId) };

  for (const key of allowedProps) {
    if (properties[key] !== undefined) {
      setClauses.push(`r.${key} = $${key}`);
      params[key] = properties[key];
    }
  }

  if (setClauses.length === 0) {
    return res.status(400).json({ error: 'No valid properties to update' });
  }

  // We need to search across all relationship types
  const unionQueries = RELATIONSHIP_TYPES.map(rt =>
    `MATCH (a)-[r:${rt} {id: $relId}]->(b) RETURN r, type(r) AS relType, a.id AS src, b.id AS tgt`
  ).join(' UNION ');

  // First find the relationship
  const findResult = await session.run(unionQueries, { relId: getNeo4j().int(relationshipId) });

  if (!findResult.records.length) {
    return res.status(404).json({ error: 'Relationship not found' });
  }

  const foundRelType = findResult.records[0].get('relType');

  // Now update it
  const updateQuery = `
    MATCH (a)-[r:${foundRelType} {id: $relId}]->(b)
    SET ${setClauses.join(', ')}
    RETURN r, type(r) AS relType, a.id AS src, b.id AS tgt
  `;

  const result = await session.run(updateQuery, params);

  if (!result.records.length) {
    return res.status(404).json({ error: 'Relationship not found' });
  }

  const rel = formatRelationship(
    result.records[0].get('r').properties,
    result.records[0].get('relType'),
    result.records[0].get('src'),
    result.records[0].get('tgt')
  );

  res.json(rel);
}));

// DELETE /:relationshipId -- delete a relationship
router.delete('/:relationshipId', requireAuth, withSession(async (req, res) => {
  const relationshipId = parseInt(req.params.relationshipId);
  const session = req.neo4jSession!;

  // Search across all relationship types and delete
  const unionQueries = RELATIONSHIP_TYPES.map(rt =>
    `MATCH (a)-[r:${rt} {id: $relId}]->(b) DELETE r RETURN count(r) AS deleted`
  );

  let totalDeleted = 0;
  for (const q of unionQueries) {
    const result = await session.run(q, { relId: getNeo4j().int(relationshipId) });
    totalDeleted += toNum(result.records[0]?.get('deleted')) ?? 0;
  }

  if (totalDeleted === 0) {
    return res.status(404).json({ error: 'Relationship not found' });
  }

  res.json({ ok: true });
}));

export default router;
