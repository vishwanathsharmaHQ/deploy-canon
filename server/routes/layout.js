const router = require('express').Router();
const { getNeo4j } = require('../db/driver');
const { requireAuth } = require('../middleware/auth');
const { withSession } = require('../middleware/session');

// ── Thread layout ─────────────────────────────────────────────────────────────

router.put('/:threadId/layout', requireAuth, withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { layout } = req.body;
  await req.neo4jSession.run(
    `MATCH (t:Thread {id: $threadId}) SET t.layout = $layout`,
    { threadId: getNeo4j().int(threadId), layout: JSON.stringify(layout) }
  );
  res.json({ layout });
}));

router.get('/:threadId/layout', withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const result = await req.neo4jSession.run(
    'MATCH (t:Thread {id: $threadId}) RETURN t.layout AS layout',
    { threadId: getNeo4j().int(threadId) }
  );
  const layoutStr = result.records[0]?.get('layout');
  res.json(layoutStr ? JSON.parse(layoutStr) : null);
}));

router.delete('/:threadId/layout', requireAuth, withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  await req.neo4jSession.run(
    'MATCH (t:Thread {id: $threadId}) REMOVE t.layout',
    { threadId: getNeo4j().int(threadId) }
  );
  res.json({});
}));

// ── Thread canvas ─────────────────────────────────────────────────────────────

router.put('/:threadId/canvas', requireAuth, withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { canvas } = req.body;
  await req.neo4jSession.run(
    `MATCH (t:Thread {id: $threadId}) SET t.canvas = $canvas`,
    { threadId: getNeo4j().int(threadId), canvas: JSON.stringify(canvas) }
  );
  res.json({ canvas });
}));

router.get('/:threadId/canvas', withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const result = await req.neo4jSession.run(
    'MATCH (t:Thread {id: $threadId}) RETURN t.canvas AS canvas',
    { threadId: getNeo4j().int(threadId) }
  );
  const canvasStr = result.records[0]?.get('canvas');
  res.json(canvasStr ? JSON.parse(canvasStr) : null);
}));

router.delete('/:threadId/canvas', requireAuth, withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  await req.neo4jSession.run(
    'MATCH (t:Thread {id: $threadId}) REMOVE t.canvas',
    { threadId: getNeo4j().int(threadId) }
  );
  res.json({});
}));

// ── Thread content ────────────────────────────────────────────────────────────

router.put('/:threadId/content', requireAuth, withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { content } = req.body;
  const { formatThread } = require('../db/queries');
  const now = new Date().toISOString();
  const result = await req.neo4jSession.run(
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
  await req.neo4jSession.run(
    `MATCH (t:Thread {id: $threadId}) SET t.article_sequence = $sequence`,
    { threadId: getNeo4j().int(threadId), sequence: JSON.stringify(sequence) }
  );
  res.json({ sequence });
}));

router.get('/:threadId/sequence', withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const result = await req.neo4jSession.run(
    'MATCH (t:Thread {id: $threadId}) RETURN t.article_sequence AS sequence',
    { threadId: getNeo4j().int(threadId) }
  );
  const seqStr = result.records[0]?.get('sequence');
  res.json(seqStr ? JSON.parse(seqStr) : null);
}));

router.delete('/:threadId/sequence', requireAuth, withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  await req.neo4jSession.run(
    'MATCH (t:Thread {id: $threadId}) REMOVE t.article_sequence',
    { threadId: getNeo4j().int(threadId) }
  );
  res.json({});
}));

module.exports = router;
