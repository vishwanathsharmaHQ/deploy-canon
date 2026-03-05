import { Router } from 'express';
import { getNeo4j, toNum } from '../db/driver.js';
import { formatNode } from '../db/queries.js';
import { requireAuth } from '../middleware/auth.js';
import { withSession } from '../middleware/session.js';
import { aiTimeout } from '../middleware/aiTimeout.js';
import { getOpenAI } from '../services/openai.js';

const router = Router();

function sm2(quality: number, repetitions: number, easiness: number, interval: number) {
  let newEF = easiness + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (newEF < 1.3) newEF = 1.3;
  if (quality < 3) return { easiness: newEF, interval: 1, repetitions: 0 };
  const newReps = repetitions + 1;
  const newInterval = newReps === 1 ? 1 : newReps === 2 ? 6 : Math.round(interval * newEF);
  return { easiness: newEF, interval: newInterval, repetitions: newReps };
}

router.post('/init', requireAuth, withSession(async (req, res) => {
  const { threadId } = req.body;
  const session = req.neo4jSession!;
  const now = new Date().toISOString().split('T')[0];
  await session.run(
    `MATCH (t:Thread {id: $threadId})-[:INCLUDES]->(n:Node)
     WHERE n.review_due_date IS NULL
     SET n.review_easiness = 2.5, n.review_interval = 0, n.review_repetitions = 0,
         n.review_due_date = $now, n.review_last_date = null, n.review_quality = null`,
    { threadId: getNeo4j().int(parseInt(threadId)), now }
  );
  const count = await session.run(
    `MATCH (t:Thread {id: $threadId})-[:INCLUDES]->(n:Node) WHERE n.review_due_date IS NOT NULL RETURN count(n) AS c`,
    { threadId: getNeo4j().int(parseInt(threadId)) }
  );
  res.json({ ok: true, reviewableNodes: toNum(count.records[0].get('c')) });
}));

router.get('/due', withSession(async (req, res) => {
  const { threadId } = req.query;
  const session = req.neo4jSession!;
  const today = new Date().toISOString().split('T')[0];
  let query: string, params: Record<string, unknown>;
  if (threadId) {
    query = `MATCH (t:Thread {id: $threadId})-[:INCLUDES]->(n:Node)
             WHERE n.review_due_date IS NOT NULL AND n.review_due_date <= $today
             RETURN n ORDER BY n.review_due_date ASC`;
    params = { threadId: getNeo4j().int(parseInt(threadId as string)), today };
  } else {
    query = `MATCH (n:Node) WHERE n.review_due_date IS NOT NULL AND n.review_due_date <= $today
             RETURN n ORDER BY n.review_due_date ASC LIMIT 50`;
    params = { today };
  }
  const result = await session.run(query, params);
  res.json(result.records.map(r => formatNode(r.get('n').properties)));
}));

router.post('/submit', requireAuth, withSession(async (req, res) => {
  const { nodeId, quality } = req.body;
  if (quality < 0 || quality > 5) return res.status(400).json({ error: 'Quality must be 0-5' });
  const session = req.neo4jSession!;

  const nodeResult = await session.run('MATCH (n:Node {id: $id}) RETURN n', { id: getNeo4j().int(parseInt(nodeId)) });
  if (!nodeResult.records.length) return res.status(404).json({ error: 'Node not found' });
  const props = nodeResult.records[0].get('n').properties;

  const result = sm2(
    quality,
    props.review_repetitions ? toNum(props.review_repetitions)! : 0,
    props.review_easiness || 2.5,
    props.review_interval ? toNum(props.review_interval)! : 0
  );
  const today = new Date();
  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + result.interval);

  await session.run(
    `MATCH (n:Node {id: $id})
     SET n.review_easiness = $easiness, n.review_interval = $interval,
         n.review_repetitions = $reps, n.review_due_date = $due,
         n.review_last_date = $last, n.review_quality = $quality`,
    {
      id: getNeo4j().int(parseInt(nodeId)),
      easiness: result.easiness, interval: getNeo4j().int(result.interval),
      reps: getNeo4j().int(result.repetitions),
      due: dueDate.toISOString().split('T')[0],
      last: today.toISOString().split('T')[0],
      quality: getNeo4j().int(quality),
    }
  );
  res.json({ ...result, dueDate: dueDate.toISOString().split('T')[0] });
}));

router.get('/stats', withSession(async (req, res) => {
  const { threadId } = req.query;
  const session = req.neo4jSession!;
  const today = new Date().toISOString().split('T')[0];
  let query: string, params: Record<string, unknown>;
  if (threadId) {
    query = `MATCH (t:Thread {id: $threadId})-[:INCLUDES]->(n:Node)
             WITH count(n) AS total,
                  count(CASE WHEN n.review_due_date IS NOT NULL THEN 1 END) AS reviewable,
                  count(CASE WHEN n.review_due_date <= $today AND n.review_due_date IS NOT NULL THEN 1 END) AS due,
                  count(CASE WHEN n.review_repetitions >= 5 THEN 1 END) AS mastered,
                  count(CASE WHEN n.review_last_date IS NOT NULL THEN 1 END) AS reviewed
             RETURN total, reviewable, due, mastered, reviewed`;
    params = { threadId: getNeo4j().int(parseInt(threadId as string)), today };
  } else {
    query = `MATCH (n:Node)
             WITH count(n) AS total,
                  count(CASE WHEN n.review_due_date IS NOT NULL THEN 1 END) AS reviewable,
                  count(CASE WHEN n.review_due_date <= $today AND n.review_due_date IS NOT NULL THEN 1 END) AS due,
                  count(CASE WHEN n.review_repetitions >= 5 THEN 1 END) AS mastered,
                  count(CASE WHEN n.review_last_date IS NOT NULL THEN 1 END) AS reviewed
             RETURN total, reviewable, due, mastered, reviewed`;
    params = { today };
  }
  const result = await session.run(query, params);
  const r = result.records[0];
  res.json({
    total: toNum(r.get('total')),
    reviewable: toNum(r.get('reviewable')),
    due: toNum(r.get('due')),
    mastered: toNum(r.get('mastered')),
    reviewed: toNum(r.get('reviewed')),
  });
}));

router.get('/decay', withSession(async (req, res) => {
  const { threadId } = req.query;
  const session = req.neo4jSession!;
  const result = await session.run(
    `MATCH (t:Thread {id: $threadId})-[:INCLUDES]->(n:Node)
     WHERE n.review_due_date IS NOT NULL
     RETURN n.id AS id, n.review_due_date AS due, n.review_interval AS interval, n.review_easiness AS easiness`,
    { threadId: getNeo4j().int(parseInt(threadId as string)) }
  );
  const today = new Date();
  const decay = result.records.map(r => {
    const due = new Date(r.get('due'));
    const interval = toNum(r.get('interval')) || 1;
    const daysSinceDue = Math.max(0, (today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
    const decayPercent = Math.min(100, Math.round((daysSinceDue / Math.max(interval, 1)) * 100));
    return { nodeId: toNum(r.get('id')), decayPercent, daysSinceDue: Math.round(daysSinceDue) };
  });
  res.json(decay);
}));

router.post('/quiz', requireAuth, aiTimeout, withSession(async (req, res) => {
  const { nodeId, quizType } = req.body;
  const session = req.neo4jSession!;

  const nodeResult = await session.run('MATCH (n:Node {id: $id}) RETURN n', { id: getNeo4j().int(parseInt(nodeId)) });
  if (!nodeResult.records.length) return res.status(404).json({ error: 'Node not found' });
  const props = nodeResult.records[0].get('n').properties;

  let contentText = String(props.content || '');
  try { const p = JSON.parse(contentText); contentText = p.description || p.point || p.explanation || p.argument || contentText; } catch {}
  contentText = contentText.replace(/<[^>]+>/g, ' ').substring(0, 1000);

  const openai = getOpenAI();
  const prompt = quizType === 'steelman'
    ? `Create a steelman challenge for this COUNTERPOINT. Ask the user to rewrite it in its strongest form. Return JSON: { "question": "<challenge text>", "hint": "<what a strong version should include>", "idealAnswer": "<a model steelmanned version>" }`
    : `Create a recall quiz question about this knowledge node. Return JSON: { "question": "<question testing recall of key facts>", "hint": "<a helpful hint>", "idealAnswer": "<the correct detailed answer>" }`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini', temperature: 0.6,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: `[${props.node_type}] "${props.title}": ${contentText}` },
    ],
  });
  res.json(JSON.parse(completion.choices[0].message.content!));
}));

export default router;
