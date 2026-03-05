import { Router } from 'express';
import { getNeo4j, toNum } from '../db/driver.js';
import { getNextId, formatSource, formatNode } from '../db/queries.js';
import { requireAuth } from '../middleware/auth.js';
import { withSession, withTransaction } from '../middleware/session.js';
import type { SourceData } from '../types/domain.js';

const router = Router();

// GET / -- list all sources
router.get('/', withSession(async (req, res) => {
  const session = req.neo4jSession!;

  const result = await session.run(
    `MATCH (s:Source)
     OPTIONAL MATCH (n:Node)-[:CITES]->(s)
     RETURN s, count(n) AS citationCount
     ORDER BY s.created_at DESC`
  );

  const sources = result.records.map(r => {
    const source = formatSource(r.get('s').properties);
    return { ...source, citation_count: toNum(r.get('citationCount')) ?? 0 };
  });

  res.json(sources);
}));

// POST / -- create a source
router.post('/', requireAuth, withTransaction(async (req, res) => {
  const tx = req.neo4jTx!;
  const { title, url, source_type, authors, published_date, content } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }

  const id = await getNextId('source', tx);
  const now = new Date().toISOString();

  const result = await tx.run(
    `CREATE (s:Source {
      id: $id, title: $title, url: $url,
      source_type: $sourceType,
      authors: $authors,
      published_date: $publishedDate,
      content: $content,
      reliability_score: null,
      citation_count: 0,
      created_at: $now, updated_at: $now
    }) RETURN s`,
    {
      id: getNeo4j().int(id),
      title,
      url: url || null,
      sourceType: source_type || 'other',
      authors: authors ? JSON.stringify(authors) : '[]',
      publishedDate: published_date || null,
      content: content || '',
      now,
    }
  );

  const source = formatSource(result.records[0].get('s').properties);
  res.json(source);
}));

// GET /:sourceId -- get a source with its citing nodes
router.get('/:sourceId', withSession(async (req, res) => {
  const sourceId = parseInt(req.params.sourceId);
  const session = req.neo4jSession!;

  const result = await session.run(
    `MATCH (s:Source {id: $sourceId})
     OPTIONAL MATCH (n:Node)-[c:CITES]->(s)
     OPTIONAL MATCH (t:Thread)-[:INCLUDES]->(n)
     RETURN s, collect(DISTINCT {node: n, threadId: t.id, threadTitle: t.title}) AS citingNodes`,
    { sourceId: getNeo4j().int(sourceId) }
  );

  if (!result.records.length) {
    return res.status(404).json({ error: 'Source not found' });
  }

  const source = formatSource(result.records[0].get('s').properties);
  const citingNodesRaw = result.records[0].get('citingNodes') || [];
  const citingNodes = citingNodesRaw
    .filter((entry: any) => entry.node != null)
    .map((entry: any) => ({
      node: formatNode(entry.node.properties),
      threadId: toNum(entry.threadId),
      threadTitle: entry.threadTitle || '',
    }));

  res.json({ ...source, citingNodes });
}));

// PUT /:sourceId -- update source
router.put('/:sourceId', requireAuth, withSession(async (req, res) => {
  const sourceId = parseInt(req.params.sourceId);
  const session = req.neo4jSession!;
  const { title, url, source_type, authors, published_date, content, reliability_score } = req.body;

  const now = new Date().toISOString();

  const setClauses: string[] = ['s.updated_at = $now'];
  const params: Record<string, unknown> = {
    sourceId: getNeo4j().int(sourceId),
    now,
  };

  if (title !== undefined) { setClauses.push('s.title = $title'); params.title = title; }
  if (url !== undefined) { setClauses.push('s.url = $url'); params.url = url; }
  if (source_type !== undefined) { setClauses.push('s.source_type = $sourceType'); params.sourceType = source_type; }
  if (authors !== undefined) { setClauses.push('s.authors = $authors'); params.authors = JSON.stringify(authors); }
  if (published_date !== undefined) { setClauses.push('s.published_date = $publishedDate'); params.publishedDate = published_date; }
  if (content !== undefined) { setClauses.push('s.content = $content'); params.content = content; }
  if (reliability_score !== undefined) { setClauses.push('s.reliability_score = $reliabilityScore'); params.reliabilityScore = reliability_score; }

  const result = await session.run(
    `MATCH (s:Source {id: $sourceId}) SET ${setClauses.join(', ')} RETURN s`,
    params
  );

  if (!result.records.length) {
    return res.status(404).json({ error: 'Source not found' });
  }

  const source = formatSource(result.records[0].get('s').properties);
  res.json(source);
}));

// DELETE /:sourceId -- delete source and its CITES relationships
router.delete('/:sourceId', requireAuth, withSession(async (req, res) => {
  const sourceId = parseInt(req.params.sourceId);
  const session = req.neo4jSession!;

  const result = await session.run(
    `MATCH (s:Source {id: $sourceId}) DETACH DELETE s RETURN count(s) AS deleted`,
    { sourceId: getNeo4j().int(sourceId) }
  );

  const deleted = toNum(result.records[0]?.get('deleted')) ?? 0;
  if (deleted === 0) {
    return res.status(404).json({ error: 'Source not found' });
  }

  res.json({ deleted: true });
}));

// GET /:sourceId/impact -- which claims depend on this source (for "what if retracted?" analysis)
router.get('/:sourceId/impact', withSession(async (req, res) => {
  const sourceId = parseInt(req.params.sourceId);
  const session = req.neo4jSession!;

  // Check source exists
  const sourceResult = await session.run(
    `MATCH (s:Source {id: $sourceId}) RETURN s`,
    { sourceId: getNeo4j().int(sourceId) }
  );
  if (!sourceResult.records.length) {
    return res.status(404).json({ error: 'Source not found' });
  }

  // Find vulnerable claims: claims supported by evidence that cites this source
  // where no alternative support exists that doesn't depend on this source
  const impactResult = await session.run(
    `MATCH (s:Source {id: $sourceId})<-[:CITES]-(e:Node)-[:SUPPORTS]->(c:Node {entity_type: 'claim'})
     OPTIONAL MATCH (other:Node)-[:SUPPORTS]->(c) WHERE other <> e AND NOT (other)-[:CITES]->(s)
     WITH c, e, count(other) AS alternativeSupport
     WHERE alternativeSupport = 0
     RETURN c AS vulnerableClaim, collect(e) AS dependentEvidence`,
    { sourceId: getNeo4j().int(sourceId) }
  );

  const source = formatSource(sourceResult.records[0].get('s').properties);

  const vulnerableClaims = impactResult.records.map(r => {
    const claimProps = r.get('vulnerableClaim').properties;
    const evidenceList = (r.get('dependentEvidence') || []).map((e: any) => formatNode(e.properties));
    return {
      claim: formatNode(claimProps),
      dependentEvidence: evidenceList,
    };
  });

  // Also get total citation count
  const citationResult = await session.run(
    `MATCH (n:Node)-[:CITES]->(s:Source {id: $sourceId}) RETURN count(n) AS total`,
    { sourceId: getNeo4j().int(sourceId) }
  );
  const totalCitations = toNum(citationResult.records[0]?.get('total')) ?? 0;

  res.json({
    source,
    totalCitations,
    vulnerableClaims,
    vulnerableClaimCount: vulnerableClaims.length,
  });
}));

export default router;
