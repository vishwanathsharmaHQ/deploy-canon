const router = require('express').Router();
const { getNeo4j, toNum } = require('../db/driver');
const { getNextId, formatNode } = require('../db/queries');
const { requireAuth } = require('../middleware/auth');
const { withSession } = require('../middleware/session');

// Create snapshot
router.post('/:threadId/snapshots', requireAuth, withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { trigger, triggerDetail } = req.body;
  const session = req.neo4jSession;

  const nodesResult = await session.run(
    `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node)
     OPTIONAL MATCH (parent:Node)-[:PARENT_OF]->(n)
     RETURN n, parent.id AS parentId`,
    { threadId: getNeo4j().int(threadId) }
  );
  const nodeData = nodesResult.records.map(r => {
    const p = r.get('n').properties;
    return { id: toNum(p.id), title: p.title, content: p.content, node_type: p.node_type, parentId: toNum(r.get('parentId')) };
  });
  const edgeData = nodesResult.records
    .filter(r => r.get('parentId'))
    .map(r => ({ source: toNum(r.get('parentId')), target: toNum(r.get('n').properties.id) }));

  const confResult = await session.run(
    `MATCH (t:Thread {id: $threadId})-[:HAS_CONFIDENCE]->(c:ConfidenceEntry) RETURN c ORDER BY c.created_at DESC LIMIT 1`,
    { threadId: getNeo4j().int(threadId) }
  );
  const confScore = confResult.records.length ? confResult.records[0].get('c').properties.score : null;

  const verResult = await session.run(
    `MATCH (t:Thread {id: $threadId})-[:HAS_SNAPSHOT]->(s:Snapshot) RETURN count(s) AS c`,
    { threadId: getNeo4j().int(threadId) }
  );
  const version = toNum(verResult.records[0].get('c')) + 1;

  const id = await getNextId('snapshot', session);
  const now = new Date().toISOString();
  await session.run(
    `MATCH (t:Thread {id: $threadId})
     CREATE (s:Snapshot {
       id: $id, thread_id: $threadId, version: $version,
       trigger: $trigger, trigger_detail: $triggerDetail,
       node_data: $nodeData, edge_data: $edgeData,
       confidence_score: $confScore,
       created_at: $now
     })
     CREATE (t)-[:HAS_SNAPSHOT]->(s)`,
    {
      threadId: getNeo4j().int(threadId), id: getNeo4j().int(id), version: getNeo4j().int(version),
      trigger: trigger || 'manual', triggerDetail: triggerDetail || '',
      nodeData: JSON.stringify(nodeData), edgeData: JSON.stringify(edgeData),
      confScore: confScore, now
    }
  );
  res.json({ id, version, trigger, nodeCount: nodeData.length, created_at: now });
}));

// List snapshots
router.get('/:threadId/snapshots', withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const result = await req.neo4jSession.run(
    `MATCH (t:Thread {id: $threadId})-[:HAS_SNAPSHOT]->(s:Snapshot)
     RETURN s ORDER BY s.version DESC`,
    { threadId: getNeo4j().int(threadId) }
  );
  const snapshots = result.records.map(r => {
    const p = r.get('s').properties;
    const nodeData = p.node_data ? JSON.parse(p.node_data) : [];
    return {
      id: toNum(p.id), version: toNum(p.version), trigger: p.trigger,
      triggerDetail: p.trigger_detail, nodeCount: nodeData.length,
      confidenceScore: p.confidence_score, created_at: p.created_at,
    };
  });
  res.json(snapshots);
}));

// Diff two snapshots
router.get('/:threadId/snapshots/diff', withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { v1, v2 } = req.query;
  const result = await req.neo4jSession.run(
    `MATCH (t:Thread {id: $threadId})-[:HAS_SNAPSHOT]->(s:Snapshot)
     WHERE s.version IN [$v1, $v2]
     RETURN s ORDER BY s.version ASC`,
    { threadId: getNeo4j().int(threadId), v1: getNeo4j().int(parseInt(v1)), v2: getNeo4j().int(parseInt(v2)) }
  );
  if (result.records.length < 2) return res.status(400).json({ error: 'Both versions required' });

  const snap1 = JSON.parse(result.records[0].get('s').properties.node_data);
  const snap2 = JSON.parse(result.records[1].get('s').properties.node_data);

  const ids1 = new Set(snap1.map(n => n.id));
  const ids2 = new Set(snap2.map(n => n.id));
  const map1 = Object.fromEntries(snap1.map(n => [n.id, n]));

  const added = snap2.filter(n => !ids1.has(n.id));
  const removed = snap1.filter(n => !ids2.has(n.id));
  const modified = snap2.filter(n => ids1.has(n.id) && (map1[n.id].title !== n.title || map1[n.id].content !== n.content));

  res.json({ added, removed, modified, v1NodeCount: snap1.length, v2NodeCount: snap2.length });
}));

// Record confidence score
router.post('/:threadId/confidence', requireAuth, withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { score, breakdown, verdict } = req.body;
  const session = req.neo4jSession;

  const id = await getNextId('confidence', session);
  const now = new Date().toISOString();
  const nodeCount = await session.run(
    `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node) RETURN count(n) AS c`,
    { threadId: getNeo4j().int(threadId) }
  );

  await session.run(
    `MATCH (t:Thread {id: $threadId})
     CREATE (c:ConfidenceEntry {
       id: $id, thread_id: $threadId, score: $score,
       breakdown: $breakdown, verdict: $verdict,
       node_count: $nodeCount, created_at: $now
     })
     CREATE (t)-[:HAS_CONFIDENCE]->(c)`,
    {
      threadId: getNeo4j().int(threadId), id: getNeo4j().int(id),
      score: score, breakdown: JSON.stringify(breakdown || {}),
      verdict: verdict || '', nodeCount: getNeo4j().int(toNum(nodeCount.records[0].get('c'))), now
    }
  );
  res.json({ id, score, created_at: now });
}));

// List confidence history
router.get('/:threadId/confidence', withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const result = await req.neo4jSession.run(
    `MATCH (t:Thread {id: $threadId})-[:HAS_CONFIDENCE]->(c:ConfidenceEntry)
     RETURN c ORDER BY c.created_at ASC`,
    { threadId: getNeo4j().int(threadId) }
  );
  const entries = result.records.map(r => {
    const p = r.get('c').properties;
    return {
      id: toNum(p.id), score: p.score, verdict: p.verdict,
      breakdown: p.breakdown ? JSON.parse(p.breakdown) : {},
      nodeCount: toNum(p.node_count), created_at: p.created_at,
    };
  });
  res.json(entries);
}));

// Unified timeline
router.get('/:threadId/timeline', withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = req.neo4jSession;
  const events = [];

  const threadResult = await session.run(
    'MATCH (t:Thread {id: $id}) RETURN t.created_at AS created_at, t.title AS title',
    { id: getNeo4j().int(threadId) }
  );
  if (threadResult.records.length) {
    events.push({ type: 'thread_created', title: threadResult.records[0].get('title'), timestamp: threadResult.records[0].get('created_at') });
  }

  const nodesResult = await session.run(
    `MATCH (t:Thread {id: $id})-[:HAS_NODE]->(n:Node) RETURN n.id AS id, n.title AS title, n.node_type AS nodeType, n.created_at AS created_at`,
    { id: getNeo4j().int(threadId) }
  );
  for (const r of nodesResult.records) {
    events.push({ type: 'node_added', nodeId: toNum(r.get('id')), title: r.get('title'), nodeType: r.get('nodeType'), timestamp: r.get('created_at') });
  }

  const snapResult = await session.run(
    `MATCH (t:Thread {id: $id})-[:HAS_SNAPSHOT]->(s:Snapshot) RETURN s.version AS version, s.trigger AS trigger, s.created_at AS created_at`,
    { id: getNeo4j().int(threadId) }
  );
  for (const r of snapResult.records) {
    events.push({ type: 'snapshot', version: toNum(r.get('version')), trigger: r.get('trigger'), timestamp: r.get('created_at') });
  }

  const confResult = await session.run(
    `MATCH (t:Thread {id: $id})-[:HAS_CONFIDENCE]->(c:ConfidenceEntry) RETURN c.score AS score, c.verdict AS verdict, c.created_at AS created_at`,
    { id: getNeo4j().int(threadId) }
  );
  for (const r of confResult.records) {
    events.push({ type: 'confidence', score: r.get('score'), verdict: r.get('verdict'), timestamp: r.get('created_at') });
  }

  events.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
  res.json(events);
}));

// Node version history
router.get('/:threadId/nodes/:nodeId/history', withSession(async (req, res) => {
  const nodeId = parseInt(req.params.nodeId);
  const result = await req.neo4jSession.run('MATCH (n:Node {id: $id}) RETURN n.history AS history', { id: getNeo4j().int(nodeId) });
  const raw = result.records[0]?.get('history');
  res.json({ history: raw ? JSON.parse(raw) : [] });
}));

// Export thread
router.post('/:threadId/export', withSession(async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { format } = req.body;
  const session = req.neo4jSession;

  const threadResult = await session.run('MATCH (t:Thread {id: $id}) RETURN t', { id: getNeo4j().int(threadId) });
  if (!threadResult.records.length) return res.status(404).json({ error: 'Thread not found' });
  const thread = threadResult.records[0].get('t').properties;

  const nodesResult = await session.run(
    `MATCH (t:Thread {id: $id})-[:HAS_NODE]->(n:Node)
     OPTIONAL MATCH (parent:Node)-[:PARENT_OF]->(n)
     RETURN n, parent.id AS parentId ORDER BY n.created_at ASC`,
    { id: getNeo4j().int(threadId) }
  );
  const nodes = nodesResult.records.map(r => {
    const p = r.get('n').properties;
    return { id: toNum(p.id), title: p.title, content: p.content, node_type: p.node_type, parentId: toNum(r.get('parentId')) };
  });

  if (format === 'json') {
    return res.json({ thread: { id: toNum(thread.id), title: thread.title, description: thread.description }, nodes });
  }

  // Default: markdown
  const NODE_TYPE_EMOJI = { ROOT: '#', EVIDENCE: '>', REFERENCE: '@', CONTEXT: '~', EXAMPLE: '*', COUNTERPOINT: '!', SYNTHESIS: '=' };
  let md = `# ${thread.title}\n\n${thread.description || ''}\n\n---\n\n`;
  for (const node of nodes) {
    let content = node.content || '';
    try {
      const p = JSON.parse(content);
      content = p.description || p.point || p.explanation || p.argument || content;
    } catch (e) {}
    content = content.replace(/<[^>]+>/g, '');
    md += `## ${NODE_TYPE_EMOJI[node.node_type] || ''} [${node.node_type}] ${node.title}\n\n${content}\n\n`;
  }
  res.json({ markdown: md, title: thread.title });
}));

module.exports = router;
