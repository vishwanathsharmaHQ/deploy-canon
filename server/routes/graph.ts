import { Router } from 'express';
import { getNeo4j, toNum } from '../db/driver.js';
import { formatThread, formatNode } from '../db/queries.js';
import { requireAuth } from '../middleware/auth.js';
import { withSession } from '../middleware/session.js';
import { aiTimeout } from '../middleware/aiTimeout.js';
import { getOpenAI } from '../services/openai.js';

const router = Router();

// Global graph summary
router.get('/global/summary', withSession(async (req, res) => {
  const result = await req.neo4jSession!.run(
    `MATCH (t:Thread)
     OPTIONAL MATCH (t)-[:HAS_NODE]->(n:Node)
     OPTIONAL MATCH (n)-[r:RELATED_TO]->(other:Node)<-[:HAS_NODE]-(t2:Thread)
     WHERE t2 <> t
     WITH t, count(DISTINCT n) AS nodeCount, count(DISTINCT r) AS crossLinkCount,
          collect(DISTINCT t2.id) AS linkedThreadIds
     RETURN t, nodeCount, crossLinkCount, linkedThreadIds ORDER BY t.created_at DESC`
  );
  const threads = result.records.map(r => ({
    ...formatThread(r.get('t').properties),
    nodeCount: toNum(r.get('nodeCount')),
    crossLinkCount: toNum(r.get('crossLinkCount')),
    linkedThreadIds: (r.get('linkedThreadIds') as unknown[]).map((id: unknown) => toNum(id)),
  }));
  res.json(threads);
}));

// Concepts
router.get('/concepts', withSession(async (req, res) => {
  const result = await req.neo4jSession!.run(
    `MATCH (c:Concept) OPTIONAL MATCH (n:Node)-[:HAS_CONCEPT]->(c) RETURN c, count(n) AS usageCount ORDER BY usageCount DESC`
  );
  const concepts = result.records.map(r => ({
    id: toNum(r.get('c').properties.id),
    name: r.get('c').properties.name,
    aliases: r.get('c').properties.aliases ? JSON.parse(r.get('c').properties.aliases) : [],
    usageCount: toNum(r.get('usageCount')),
  }));
  res.json(concepts);
}));

router.get('/concepts/:id/nodes', withSession(async (req, res) => {
  const conceptId = parseInt(req.params.id);
  const result = await req.neo4jSession!.run(
    `MATCH (n:Node)-[:HAS_CONCEPT]->(c:Concept {id: $id})
     MATCH (t:Thread)-[:HAS_NODE]->(n)
     RETURN n, t.id AS threadId, t.title AS threadTitle`,
    { id: getNeo4j().int(conceptId) }
  );
  const nodes = result.records.map(r => ({
    ...formatNode(r.get('n').properties, null),
    threadId: toNum(r.get('threadId')),
    threadTitle: r.get('threadTitle'),
  }));
  res.json(nodes);
}));

router.post('/concepts/extract', requireAuth, aiTimeout, withSession(async (req, res) => {
  const { nodeId } = req.body;
  const session = req.neo4jSession!;

  const nodeResult = await session.run('MATCH (n:Node {id: $id}) RETURN n', { id: getNeo4j().int(parseInt(nodeId)) });
  if (!nodeResult.records.length) return res.status(404).json({ error: 'Node not found' });
  const nodeProps = nodeResult.records[0].get('n').properties;

  let contentText = String(nodeProps.content || '');
  try { const p = JSON.parse(contentText); contentText = p.description || p.point || p.explanation || contentText; } catch {}
  contentText = contentText.replace(/<[^>]+>/g, ' ').substring(0, 2000);

  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini', temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Extract 2-5 key concept tags from the given content. Return JSON: { "concepts": ["concept1", "concept2", ...] }. Concepts should be general academic/domain terms (e.g., "machine learning", "cognitive bias"), not specific claims.' },
      { role: 'user', content: `Title: "${nodeProps.title}"\nContent: ${contentText}` },
    ],
  });
  const { concepts = [] } = JSON.parse(completion.choices[0].message.content!);

  const created: string[] = [];
  for (const name of concepts.slice(0, 5)) {
    const normalized = name.toLowerCase().trim();
    if (!normalized) continue;
    await session.run(
      `MERGE (c:Concept {name: $name})
       ON CREATE SET c.id = randomUUID(), c.aliases = '[]', c.created_at = $now
       WITH c
       MATCH (n:Node {id: $nodeId})
       MERGE (n)-[:HAS_CONCEPT]->(c)`,
      { name: normalized, now: new Date().toISOString(), nodeId: getNeo4j().int(parseInt(nodeId)) }
    );
    created.push(normalized);
  }
  res.json({ concepts: created });
}));

export default router;
