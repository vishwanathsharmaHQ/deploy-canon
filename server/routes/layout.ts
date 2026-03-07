import { Router } from 'express';
import { getNeo4j, toNum } from '../db/driver.js';
import { formatThread } from '../db/queries.js';
import { requireAuth } from '../middleware/auth.js';
import { withSession } from '../middleware/session.js';

const router = Router();

// ── Thread layout ─────────────────────────────────────────────────────────────

router.put('/:threadId/layout', requireAuth, withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { layout } = req.body;
  await req.neo4jSession!.run(
    `MATCH (t:Thread {id: $threadId}) SET t.layout = $layout`,
    { threadId: getNeo4j().int(threadId), layout: JSON.stringify(layout) }
  );
  res.json({ layout });
}));

router.get('/:threadId/layout', withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const result = await req.neo4jSession!.run(
    'MATCH (t:Thread {id: $threadId}) RETURN t.layout AS layout',
    { threadId: getNeo4j().int(threadId) }
  );
  const layoutStr = result.records[0]?.get('layout');
  res.json(layoutStr ? JSON.parse(layoutStr) : null);
}));

router.delete('/:threadId/layout', requireAuth, withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  await req.neo4jSession!.run(
    'MATCH (t:Thread {id: $threadId}) REMOVE t.layout',
    { threadId: getNeo4j().int(threadId) }
  );
  res.json({});
}));

// ── Thread canvas ─────────────────────────────────────────────────────────────

router.put('/:threadId/canvas', requireAuth, withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { canvas } = req.body;
  await req.neo4jSession!.run(
    `MATCH (t:Thread {id: $threadId}) SET t.canvas = $canvas`,
    { threadId: getNeo4j().int(threadId), canvas: JSON.stringify(canvas) }
  );
  res.json({ canvas });
}));

router.get('/:threadId/canvas', withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const result = await req.neo4jSession!.run(
    'MATCH (t:Thread {id: $threadId}) RETURN t.canvas AS canvas',
    { threadId: getNeo4j().int(threadId) }
  );
  const canvasStr = result.records[0]?.get('canvas');
  res.json(canvasStr ? JSON.parse(canvasStr) : null);
}));

router.delete('/:threadId/canvas', requireAuth, withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  await req.neo4jSession!.run(
    'MATCH (t:Thread {id: $threadId}) REMOVE t.canvas',
    { threadId: getNeo4j().int(threadId) }
  );
  res.json({});
}));

// ── Thread content ────────────────────────────────────────────────────────────

router.put('/:threadId/content', requireAuth, withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { content } = req.body;
  const now = new Date().toISOString();
  const result = await req.neo4jSession!.run(
    `MATCH (t:Thread {id: $threadId})
     SET t.content = $content, t.updated_at = $now
     RETURN t`,
    { threadId: getNeo4j().int(threadId), content: content || '', now }
  );
  res.json(formatThread(result.records[0].get('t').properties));
}));

// ── Article sequence ──────────────────────────────────────────────────────────

router.put('/:threadId/sequence', requireAuth, withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { sequence } = req.body;
  await req.neo4jSession!.run(
    `MATCH (t:Thread {id: $threadId}) SET t.article_sequence = $sequence`,
    { threadId: getNeo4j().int(threadId), sequence: JSON.stringify(sequence) }
  );
  res.json({ sequence });
}));

router.get('/:threadId/sequence', withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const result = await req.neo4jSession!.run(
    'MATCH (t:Thread {id: $threadId}) RETURN t.article_sequence AS sequence',
    { threadId: getNeo4j().int(threadId) }
  );
  const seqStr = result.records[0]?.get('sequence');
  res.json(seqStr ? JSON.parse(seqStr) : null);
}));

// ── Highlights ───────────────────────────────────────────────────────────────

router.get('/:threadId/highlights', withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const result = await req.neo4jSession!.run(
    'MATCH (t:Thread {id: $threadId}) RETURN t.highlights AS highlights',
    { threadId: getNeo4j().int(threadId) }
  );
  const str = result.records[0]?.get('highlights');
  res.json(str ? JSON.parse(str) : {});
}));

router.put('/:threadId/highlights', requireAuth, withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { highlights } = req.body;
  await req.neo4jSession!.run(
    'MATCH (t:Thread {id: $threadId}) SET t.highlights = $highlights',
    { threadId: getNeo4j().int(threadId), highlights: JSON.stringify(highlights) }
  );
  res.json({ highlights });
}));

// ── Suggest sequence (AI) ────────────────────────────────────────────────────

router.post('/:threadId/sequence/suggest', requireAuth, withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const result = await req.neo4jSession!.run(
    `MATCH (t:Thread {id: $threadId})-[:INCLUDES]->(n:Node) RETURN n ORDER BY n.created_at ASC`,
    { threadId: getNeo4j().int(threadId) }
  );
  const nodes = result.records.map(r => {
    const p = r.get('n').properties;
    return { id: toNum(p.id), title: p.title, entity_type: p.entity_type };
  });
  if (!nodes.length) return res.json({ sequence: [] });

  const { getOpenAI } = await import('../services/openai.js');
  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a knowledge organizer. Given a list of argument nodes, return the optimal reading sequence as a JSON array of node IDs.
Return exactly: { "sequence": [<id1>, <id2>, ...] }
Order them so the narrative flows logically: ROOT claim first, then supporting evidence, counterpoints, and synthesis.`,
      },
      {
        role: 'user',
        content: nodes.map(n => `ID ${n.id}: [${n.entity_type}] ${n.title}`).join('\n'),
      },
    ],
  });
  const parsed = JSON.parse(completion.choices[0].message.content!);
  res.json({ sequence: parsed.sequence || [] });
}));

router.delete('/:threadId/sequence', requireAuth, withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  await req.neo4jSession!.run(
    'MATCH (t:Thread {id: $threadId}) REMOVE t.article_sequence',
    { threadId: getNeo4j().int(threadId) }
  );
  res.json({});
}));

export default router;
