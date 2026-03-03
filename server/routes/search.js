const router = require('express').Router();
const { getNeo4j, toNum } = require('../db/driver');
const { vectorQuery, formatThread, formatNode } = require('../db/queries');
const { requireAuth } = require('../middleware/auth');
const { withSession } = require('../middleware/session');
const { aiTimeout } = require('../middleware/aiTimeout');
const { getOpenAI, generateEmbedding } = require('../services/openai');

// Semantic search across threads and nodes
router.get('/semantic', withSession(async (req, res) => {
  const { q, limit = 20 } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });
  const session = req.neo4jSession;
  const k = Math.min(parseInt(limit), 50);
  let threads = [];
  let nodes = [];

  const queryEmbedding = await generateEmbedding(q).catch(() => null);
  if (queryEmbedding) {
    const threadResults = await vectorQuery(session, 'thread_embedding', k, queryEmbedding);
    threads = threadResults.records.map(r => ({
      ...formatThread(r.get('node').properties),
      relevance: r.get('score'),
    }));

    const nodeVectorResults = await vectorQuery(session, 'node_embedding', k, queryEmbedding);
    if (nodeVectorResults.records.length > 0) {
      const nodeIds = nodeVectorResults.records.map(r => r.get('node').properties.id);
      const scoreMap = {};
      nodeVectorResults.records.forEach(r => { scoreMap[String(r.get('node').properties.id)] = r.get('score'); });
      const nodeResults = await session.run(
        `MATCH (t:Thread)-[:HAS_NODE]->(n:Node) WHERE n.id IN $ids RETURN n, t.id AS threadId, t.title AS threadTitle`,
        { ids: nodeIds }
      );
      nodes = nodeResults.records.map(r => ({
        ...formatNode(r.get('n').properties, null),
        relevance: scoreMap[String(r.get('n').properties.id)] || 0,
        threadId: toNum(r.get('threadId')),
        threadTitle: r.get('threadTitle'),
      }));
      nodes.sort((a, b) => b.relevance - a.relevance);
    }
  }

  // Fallback: text-based search when vector returns nothing
  if (threads.length === 0 && nodes.length === 0) {
    const words = q.split(/\s+/).filter(w => w.length > 2);
    const pattern = `(?i).*${words.join('.*')}.*`;
    const textThreads = await session.run(
      `MATCH (t:Thread) WHERE t.title =~ $pat OR t.description =~ $pat OR t.content =~ $pat RETURN t LIMIT $k`,
      { pat: pattern, k: getNeo4j().int(k) }
    );
    threads = textThreads.records.map(r => ({ ...formatThread(r.get('t').properties), relevance: 0.5 }));
    const textNodes = await session.run(
      `MATCH (t:Thread)-[:HAS_NODE]->(n:Node) WHERE n.title =~ $pat OR n.content =~ $pat OR n.embedding_text =~ $pat RETURN n, t.id AS threadId, t.title AS threadTitle LIMIT $k`,
      { pat: pattern, k: getNeo4j().int(k) }
    );
    nodes = textNodes.records.map(r => ({
      ...formatNode(r.get('n').properties, null),
      relevance: 0.5,
      threadId: toNum(r.get('threadId')),
      threadTitle: r.get('threadTitle'),
    }));
  }

  res.json({ threads, nodes });
}));

// Q&A synthesis
router.post('/answer', requireAuth, aiTimeout, withSession(async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Question required' });
  const session = req.neo4jSession;

  const queryEmbedding = await generateEmbedding(question);
  if (!queryEmbedding) return res.json({ answer: 'No embeddings available yet.', sources: [] });

  const vectorResults = await vectorQuery(session, 'node_embedding', 10, queryEmbedding);
  if (!vectorResults.records.length) return res.json({ answer: 'No relevant knowledge found in your threads.', sources: [] });

  const goodNodeIds = vectorResults.records.filter(r => r.get('score') > 0.3).map(r => r.get('node').properties.id);
  if (!goodNodeIds.length) return res.json({ answer: 'No relevant knowledge found in your threads.', sources: [] });
  const scoreMap = {};
  vectorResults.records.forEach(r => { scoreMap[String(r.get('node').properties.id)] = r.get('score'); });

  const results = await session.run(
    `MATCH (t:Thread)-[:HAS_NODE]->(node:Node) WHERE node.id IN $ids RETURN node, t.id AS threadId, t.title AS threadTitle`,
    { ids: goodNodeIds }
  );
  if (!results.records.length) return res.json({ answer: 'No relevant knowledge found in your threads.', sources: [] });

  const context = results.records.map(r => {
    const p = r.get('node').properties;
    let c = String(p.content || '');
    try { const parsed = JSON.parse(c); c = parsed.description || parsed.point || parsed.explanation || c; } catch (e) {}
    c = c.replace(/<[^>]+>/g, ' ').substring(0, 500);
    return `[${p.node_type}] "${p.title}" (Thread: ${r.get('threadTitle')}): ${c}`;
  }).join('\n\n');

  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: 'Answer the question using ONLY the provided knowledge base excerpts. Cite sources by thread name. If the knowledge base doesn\'t contain enough information, say so.' },
      { role: 'user', content: `Question: ${question}\n\nKnowledge base:\n${context}` },
    ],
  });

  const sources = results.records.map(r => ({
    nodeId: toNum(r.get('node').properties.id),
    nodeTitle: r.get('node').properties.title,
    threadId: toNum(r.get('threadId')),
    threadTitle: r.get('threadTitle'),
    relevance: scoreMap[String(r.get('node').properties.id)] || 0,
  }));
  res.json({ answer: completion.choices[0].message.content, sources });
}));

// Find contradictions across threads
router.post('/contradictions', requireAuth, aiTimeout, withSession(async (req, res) => {
  const { threadId } = req.body;
  const session = req.neo4jSession;

  const nodesResult = await session.run(
    `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node) WHERE n.embedding IS NOT NULL RETURN n LIMIT 10`,
    { threadId: getNeo4j().int(parseInt(threadId)) }
  );

  const contradictions = [];
  for (const record of nodesResult.records) {
    const nodeProps = record.get('n').properties;
    const embedding = nodeProps.embedding;
    if (!embedding) continue;

    const vectorRes = await vectorQuery(session, 'node_embedding', 5, embedding);
    const candidateIds = vectorRes.records
      .filter(r => r.get('score') > 0.5 && String(r.get('node').properties.id) !== String(nodeProps.id))
      .map(r => r.get('node').properties.id);
    const simScoreMap = {};
    vectorRes.records.forEach(r => { simScoreMap[String(r.get('node').properties.id)] = r.get('score'); });

    let similarRecords = [];
    if (candidateIds.length > 0) {
      const similar = await session.run(
        `MATCH (t:Thread)-[:HAS_NODE]->(node:Node) WHERE node.id IN $ids AND t.id <> $threadId RETURN node, t.id AS threadId, t.title AS threadTitle`,
        { ids: candidateIds, threadId: getNeo4j().int(parseInt(threadId)) }
      );
      similarRecords = similar.records;
    }

    for (const r of similarRecords) {
      contradictions.push({
        sourceNode: { id: toNum(nodeProps.id), title: nodeProps.title, node_type: nodeProps.node_type },
        similarNode: { id: toNum(r.get('node').properties.id), title: r.get('node').properties.title, node_type: r.get('node').properties.node_type },
        threadId: toNum(r.get('threadId')),
        threadTitle: r.get('threadTitle'),
        similarity: simScoreMap[String(r.get('node').properties.id)] || 0,
      });
    }
  }
  res.json({ contradictions: contradictions.slice(0, 20) });
}));

module.exports = router;
