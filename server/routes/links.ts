import { Router } from 'express';
import type { Record as Neo4jRecord } from 'neo4j-driver';
import { getNeo4j, toNum } from '../db/driver.js';
import { getNextId, vectorQuery } from '../db/queries.js';
import { requireAuth } from '../middleware/auth.js';
import { withSession } from '../middleware/session.js';
import { aiTimeout } from '../middleware/aiTimeout.js';
import { generateEmbedding, getEmbeddingText } from '../services/openai.js';
import { ensureVectorIndexes } from '../services/embeddings.js';
import type { LinkSuggestion } from '../types/domain.js';

const router = Router();

router.post('/', requireAuth, withSession(async (req, res) => {
  const { sourceNodeId, targetNodeId, type, description, confidence, status } = req.body;
  const session = req.neo4jSession!;
  const id = await getNextId('link', session);
  const now = new Date().toISOString();
  await session.run(
    `MATCH (a:Node {id: $src}), (b:Node {id: $tgt})
     CREATE (a)-[:RELATED_TO {id: $id, type: $type, description: $desc, confidence: $conf, status: $status, created_at: $now, created_by: $user}]->(b)`,
    {
      src: getNeo4j().int(sourceNodeId), tgt: getNeo4j().int(targetNodeId),
      id: getNeo4j().int(id), type: type || 'related', desc: description || '',
      conf: confidence || 0.5, status: status || 'accepted', now, user: 'user',
    }
  );
  res.json({ id, sourceNodeId, targetNodeId, type, description, confidence, status: status || 'accepted' });
}));

router.get('/node/:nodeId', withSession(async (req, res) => {
  const nodeId = parseInt(req.params.nodeId);
  const session = req.neo4jSession!;
  const result = await session.run(
    `MATCH (n:Node {id: $nodeId})-[r:RELATED_TO]-(other:Node)
     MATCH (t:Thread)-[:INCLUDES]->(other)
     RETURN r, other, t.id AS threadId, t.title AS threadTitle,
            CASE WHEN startNode(r) = n THEN 'outgoing' ELSE 'incoming' END AS direction`,
    { nodeId: getNeo4j().int(nodeId) }
  );
  const links = result.records.map(r => ({
    id: toNum(r.get('r').properties.id),
    type: r.get('r').properties.type,
    description: r.get('r').properties.description,
    confidence: r.get('r').properties.confidence,
    status: r.get('r').properties.status,
    direction: r.get('direction'),
    otherNode: { id: toNum(r.get('other').properties.id), title: r.get('other').properties.title, entity_type: r.get('other').properties.entity_type },
    threadId: toNum(r.get('threadId')),
    threadTitle: r.get('threadTitle'),
  }));
  res.json(links);
}));

router.delete('/:linkId', requireAuth, withSession(async (req, res) => {
  const linkId = parseInt(req.params.linkId);
  await req.neo4jSession!.run('MATCH ()-[r:RELATED_TO {id: $id}]-() DELETE r', { id: getNeo4j().int(linkId) });
  res.json({ ok: true });
}));

router.put('/:linkId', requireAuth, withSession(async (req, res) => {
  const linkId = parseInt(req.params.linkId);
  const { status } = req.body;
  await req.neo4jSession!.run('MATCH ()-[r:RELATED_TO {id: $id}]-() SET r.status = $status', { id: getNeo4j().int(linkId), status });
  res.json({ ok: true, status });
}));

router.post('/suggest', requireAuth, aiTimeout, withSession(async (req, res) => {
  await ensureVectorIndexes();
  const { threadId } = req.body;
  const session = req.neo4jSession!;

  // Backfill embeddings for this thread's nodes that are missing them
  const missingResult = await session.run(
    `MATCH (t:Thread {id: $threadId})-[:INCLUDES]->(n:Node) WHERE n.embedding IS NULL RETURN n`,
    { threadId: getNeo4j().int(parseInt(threadId)) }
  );
  for (const record of missingResult.records) {
    const props = record.get('n').properties;
    const text = getEmbeddingText({ title: props.title, content: props.content, entity_type: props.entity_type }, 'node');
    if (!text.trim()) continue;
    try {
      const embedding = await generateEmbedding(text);
      if (embedding) {
        await session.run(
          `MATCH (n:Node {id: $id}) SET n.embedding = $embedding, n.embedding_text = $text`,
          { id: props.id, embedding, text }
        );
      }
    } catch { /* skip */ }
  }

  const nodesResult = await session.run(
    `MATCH (t:Thread {id: $threadId})-[:INCLUDES]->(n:Node) WHERE n.embedding IS NOT NULL RETURN n LIMIT 10`,
    { threadId: getNeo4j().int(parseInt(threadId)) }
  );

  const suggestions: LinkSuggestion[] = [];
  for (const record of nodesResult.records) {
    const nodeProps = record.get('n').properties;
    const embedding = nodeProps.embedding;
    if (!embedding) continue;

    const vectorRes2 = await vectorQuery(session, 'node_embedding', 5, embedding);
    const goodCandidates = vectorRes2.records
      .filter(r => r.get('score') > 0.6 && String(r.get('node').properties.id) !== String(nodeProps.id))
      .slice(0, 3);
    const candidateIds2 = goodCandidates.map(r => r.get('node').properties.id);
    const scoreMap2: Record<string, number> = {};
    goodCandidates.forEach(r => { scoreMap2[String(r.get('node').properties.id)] = r.get('score'); });

    let linkCandidateRecords: Neo4jRecord[] = [];
    if (candidateIds2.length > 0) {
      const similar = await session.run(
        `MATCH (t:Thread)-[:INCLUDES]->(node:Node)
         WHERE node.id IN $ids AND t.id <> $threadId
         OPTIONAL MATCH (n2:Node {id: $nodeId})-[existing:RELATED_TO]-(node)
         WITH node, t, existing WHERE existing IS NULL
         RETURN node, t.id AS threadId, t.title AS threadTitle`,
        { ids: candidateIds2, nodeId: nodeProps.id, threadId: getNeo4j().int(parseInt(threadId)) }
      );
      linkCandidateRecords = similar.records;
    }

    for (const r of linkCandidateRecords) {
      suggestions.push({
        sourceNodeId: toNum(nodeProps.id),
        sourceNodeTitle: nodeProps.title,
        targetNodeId: toNum(r.get('node').properties.id),
        targetNodeTitle: r.get('node').properties.title,
        targetNodeType: r.get('node').properties.entity_type,
        threadId: toNum(r.get('threadId')),
        threadTitle: r.get('threadTitle'),
        similarity: scoreMap2[String(r.get('node').properties.id)] || 0,
      });
    }
  }
  res.json({ suggestions: suggestions.slice(0, 15) });
}));

export default router;
