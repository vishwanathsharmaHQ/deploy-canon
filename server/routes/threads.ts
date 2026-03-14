import { Router } from 'express';
import { getNeo4j, toNum, getSession } from '../db/driver.js';
import { getNextId, formatThread, formatNode, vectorQuery, ENTITY_TYPES, RELATIONSHIP_TYPES } from '../db/queries.js';
import { requireAuth } from '../middleware/auth.js';
import { withSession, withTransaction } from '../middleware/session.js';
import { aiTimeout } from '../middleware/aiTimeout.js';
import { getGemini, generateEmbedding, getEmbeddingText } from '../services/gemini.js';
import { extractContentText, stripHtml } from '../services/contentParser.js';
import config from '../config.js';
import type { ClonedNode } from '../types/domain.js';

const router = Router();

// ── Argument Templates ───────────────────────────────────────────────────────
const TEMPLATES = [
  {
    key: 'toulmin',
    name: 'Toulmin Model',
    description: 'Claim -> Grounds -> Warrant -> Backing -> Qualifier -> Rebuttal',
    nodes: [
      { title: 'Central Claim', entityType: 'claim', role: 'root', content: '', parentIndex: 0, relationType: null },
      { title: 'Grounds (Evidence)', entityType: 'evidence', role: 'supporting', content: '', parentIndex: 0, relationType: 'SUPPORTS' },
      { title: 'Warrant (Reasoning)', entityType: 'context', role: 'context', content: '', parentIndex: 0, relationType: 'QUALIFIES' },
      { title: 'Backing (Support)', entityType: 'evidence', role: 'supporting', content: '', parentIndex: 2, relationType: 'SUPPORTS' },
      { title: 'Qualifier (Limitations)', entityType: 'context', role: 'context', content: '', parentIndex: 0, relationType: 'QUALIFIES' },
      { title: 'Rebuttal', entityType: 'counterpoint', role: 'opposing', content: '', parentIndex: 0, relationType: 'CONTRADICTS' },
    ]
  },
  {
    key: 'steelman',
    name: 'Steel Man Analysis',
    description: 'Build the strongest version of an opposing argument',
    nodes: [
      { title: 'Opposing Position', entityType: 'claim', role: 'root', content: '', parentIndex: 0, relationType: null },
      { title: 'Strongest Supporting Evidence', entityType: 'evidence', role: 'supporting', content: '', parentIndex: 0, relationType: 'SUPPORTS' },
      { title: 'Best Case Reasoning', entityType: 'context', role: 'context', content: '', parentIndex: 0, relationType: 'SUPPORTS' },
      { title: 'Strongest Counterpoint to Your View', entityType: 'counterpoint', role: 'opposing', content: '', parentIndex: 0, relationType: 'CONTRADICTS' },
      { title: 'Synthesis & Response', entityType: 'synthesis', role: 'supporting', content: '', parentIndex: 0, relationType: 'DERIVES_FROM' },
    ]
  },
  {
    key: 'cost_benefit',
    name: 'Cost-Benefit Analysis',
    description: 'Systematic evaluation of pros, cons, and trade-offs',
    nodes: [
      { title: 'Decision/Proposal', entityType: 'claim', role: 'root', content: '', parentIndex: 0, relationType: null },
      { title: 'Key Benefit 1', entityType: 'evidence', role: 'supporting', content: '', parentIndex: 0, relationType: 'SUPPORTS' },
      { title: 'Key Benefit 2', entityType: 'evidence', role: 'supporting', content: '', parentIndex: 0, relationType: 'SUPPORTS' },
      { title: 'Key Cost/Risk 1', entityType: 'counterpoint', role: 'opposing', content: '', parentIndex: 0, relationType: 'CONTRADICTS' },
      { title: 'Key Cost/Risk 2', entityType: 'counterpoint', role: 'opposing', content: '', parentIndex: 0, relationType: 'CONTRADICTS' },
      { title: 'Net Assessment', entityType: 'synthesis', role: 'supporting', content: '', parentIndex: 0, relationType: 'DERIVES_FROM' },
    ]
  },
  {
    key: 'literature_review',
    name: 'Literature Review',
    description: 'Synthesize multiple sources into themes and gaps',
    nodes: [
      { title: 'Research Question', entityType: 'question', role: 'root', content: '', parentIndex: 0, relationType: null },
      { title: 'Source 1 Findings', entityType: 'source', role: 'supporting', content: '', parentIndex: 0, relationType: 'REFERENCES' },
      { title: 'Source 2 Findings', entityType: 'source', role: 'supporting', content: '', parentIndex: 0, relationType: 'REFERENCES' },
      { title: 'Common Theme', entityType: 'context', role: 'context', content: '', parentIndex: 0, relationType: 'QUALIFIES' },
      { title: 'Research Gap', entityType: 'counterpoint', role: 'opposing', content: '', parentIndex: 0, relationType: 'CONTRADICTS' },
      { title: 'Synthesis', entityType: 'synthesis', role: 'supporting', content: '', parentIndex: 0, relationType: 'DERIVES_FROM' },
    ]
  },
  {
    key: 'decision_matrix',
    name: 'Decision Matrix',
    description: 'Compare options against weighted criteria',
    nodes: [
      { title: 'Decision to Make', entityType: 'claim', role: 'root', content: '', parentIndex: 0, relationType: null },
      { title: 'Option A', entityType: 'context', role: 'context', content: '', parentIndex: 0, relationType: 'QUALIFIES' },
      { title: 'Option B', entityType: 'context', role: 'context', content: '', parentIndex: 0, relationType: 'QUALIFIES' },
      { title: 'Pro: Option A', entityType: 'evidence', role: 'supporting', content: '', parentIndex: 1, relationType: 'SUPPORTS' },
      { title: 'Con: Option A', entityType: 'counterpoint', role: 'opposing', content: '', parentIndex: 1, relationType: 'CONTRADICTS' },
      { title: 'Pro: Option B', entityType: 'evidence', role: 'supporting', content: '', parentIndex: 2, relationType: 'SUPPORTS' },
      { title: 'Con: Option B', entityType: 'counterpoint', role: 'opposing', content: '', parentIndex: 2, relationType: 'CONTRADICTS' },
      { title: 'Recommendation', entityType: 'synthesis', role: 'supporting', content: '', parentIndex: 0, relationType: 'DERIVES_FROM' },
    ]
  },
];

// ── GET /templates — list argument templates ─────────────────────────────────
router.get('/templates', (_req, res) => {
  res.json(TEMPLATES.map(t => ({ key: t.key, name: t.name, description: t.description, nodeCount: t.nodes.length })));
});

// ── POST /from-template — create thread from template (requireAuth) ──────────
router.post(
  '/from-template',
  requireAuth,
  withTransaction(async (req, res) => {
    const tx = req.neo4jTx!;
    const { templateKey, title, description } = req.body;

    const template = TEMPLATES.find(t => t.key === templateKey);
    if (!template) {
      return res.status(400).json({ error: `Unknown template: ${templateKey}` });
    }
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const now = new Date().toISOString();
    const threadId = await getNextId('thread', tx);
    const metaStr = JSON.stringify({ title, description: description || '', template: templateKey });

    const threadResult = await tx.run(
      `CREATE (t:Thread {
        id: $id, title: $title, description: $description,
        thread_type: 'template', metadata: $metadata,
        created_at: $now, updated_at: $now
      }) RETURN t`,
      {
        id: getNeo4j().int(threadId),
        title,
        description: description || '',
        metadata: metaStr,
        now,
      }
    );

    // Create nodes from template, tracking created node IDs by index
    const createdNodeIds: number[] = [];
    const createdNodes: Array<{ id: number; title: string; entity_type: string; content: string }> = [];

    for (let i = 0; i < template.nodes.length; i++) {
      const tNode = template.nodes[i];
      const nodeId = await getNextId('node', tx);
      createdNodeIds.push(nodeId);

      await tx.run(
        `CREATE (n:Node { id:$id, title:$title, content:$content, entity_type:$entityType, metadata:$meta, created_at:$now, updated_at:$now })
         WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:INCLUDES {position: $pos, role: $role, added_at: $now}]->(n)`,
        {
          id: getNeo4j().int(nodeId),
          title: tNode.title,
          content: tNode.content,
          entityType: tNode.entityType,
          meta: JSON.stringify({ title: tNode.title }),
          now,
          threadId: getNeo4j().int(threadId),
          pos: getNeo4j().int(i),
          role: tNode.role || 'supporting',
        }
      );

      // Create typed relationship: for index > 0, link to parent node
      if (i > 0 && tNode.parentIndex !== undefined && tNode.parentIndex < createdNodeIds.length && tNode.relationType) {
        const relId = await getNextId('relationship', tx);
        await tx.run(
          `MATCH (c:Node {id:$cid}),(p:Node {id:$pid}) CREATE (c)-[:${tNode.relationType} {id: $relId, created_at: $now}]->(p)`,
          { cid: getNeo4j().int(nodeId), pid: getNeo4j().int(createdNodeIds[tNode.parentIndex]), relId: getNeo4j().int(relId), now }
        );
      }

      createdNodes.push({
        id: nodeId,
        title: tNode.title,
        entity_type: tNode.entityType,
        content: tNode.content,
      });
    }

    const thread = formatThread(threadResult.records[0].get('t').properties);
    const nodes = createdNodes.map(n => formatNode(
      { id: n.id, title: n.title, content: n.content, entity_type: n.entity_type, created_at: now, updated_at: now, metadata: JSON.stringify({ title: n.title }) }
    ));

    res.json({ ...thread, nodes });
  })
);

// ── GET / — list all threads ──────────────────────────────────────────────────
router.get(
  '/',
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const result = await session.run(
      'MATCH (t:Thread) RETURN t ORDER BY t.created_at DESC'
    );
    const threads = result.records.map(r => formatThread(r.get('t').properties));
    res.json(threads);
  })
);

// ── POST / — create thread (requireAuth) ──────────────────────────────────────
router.post(
  '/',
  requireAuth,
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const { title, description, content, metadata, thread_type } = req.body;

    const id = await getNextId('thread', session);
    const now = new Date().toISOString();
    const metaStr = JSON.stringify({ title, description, content, ...metadata });

    const result = await session.run(
      `CREATE (t:Thread {
        id: $id, title: $title, description: $description,
        thread_type: $threadType, metadata: $metadata,
        created_at: $now, updated_at: $now
      }) RETURN t`,
      {
        id: getNeo4j().int(id),
        title,
        description: description || '',
        threadType: thread_type || 'argument',
        metadata: metaStr,
        now,
      }
    );

    const thread = formatThread(result.records[0].get('t').properties);

    // Generate embedding asynchronously (don't block response)
    const embText = getEmbeddingText({ title, description, content }, 'thread');
    if (embText.trim()) {
      generateEmbedding(embText)
        .then(embedding => {
          if (embedding) {
            const s = getSession();
            s.run(
              'MATCH (t:Thread {id: $id}) SET t.embedding = $embedding, t.embedding_text = $text',
              { id: getNeo4j().int(id), embedding, text: embText }
            )
              .finally(() => s.close());
          }
        })
        .catch(e => console.warn('Thread embedding failed:', e.message));
    }

    res.json(thread);
  })
);

// ── GET /search — search threads by text ──────────────────────────────────────
router.get(
  '/search',
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const result = await session.run(
      `MATCH (t:Thread)
       WHERE toLower(t.title) CONTAINS toLower($q)
          OR toLower(t.description) CONTAINS toLower($q)
          OR toLower(t.content) CONTAINS toLower($q)
       RETURN t ORDER BY t.created_at DESC`,
      { q: query }
    );

    const threads = result.records.map(r => formatThread(r.get('t').properties));
    res.json(threads);
  })
);

// ── PATCH /:threadId — update thread metadata (requireAuth) ──────────────────
router.patch(
  '/:threadId',
  requireAuth,
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const threadId = parseInt(req.params.threadId);
    const { thread_type, title, description } = req.body;

    const sets: string[] = [];
    const params: Record<string, unknown> = { id: getNeo4j().int(threadId) };

    if (thread_type) { sets.push('t.thread_type = $threadType'); params.threadType = thread_type; }
    if (title) { sets.push('t.title = $title'); params.title = title; }
    if (description !== undefined) { sets.push('t.description = $desc'); params.desc = description; }

    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    sets.push('t.updated_at = $now');
    params.now = new Date().toISOString();

    await session.run(
      `MATCH (t:Thread {id: $id}) SET ${sets.join(', ')} RETURN t`,
      params
    );
    res.json({ ok: true });
  })
);

// ── GET /random — random thread ───────────────────────────────────────────────
router.get(
  '/random',
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const result = await session.run(
      'MATCH (t:Thread) WITH t, rand() AS r ORDER BY r LIMIT 1 RETURN t'
    );
    if (!result.records.length) {
      return res.status(404).json({ error: 'No threads found' });
    }
    res.json(formatThread(result.records[0].get('t').properties));
  })
);

// ── POST /generate — generate thread with GPT (requireAuth, aiTimeout) ───────
router.post(
  '/generate',
  requireAuth,
  aiTimeout,
  withTransaction(async (req, res) => {
    const tx = req.neo4jTx!;
    const { topic, threadType = 'standard' } = req.body;
    if (!topic) {
      return res.status(400).json({ error: 'Topic is required' });
    }

    // Build type-specific generation prompt
    let generationPrompt: string;
    let parseAndCreateNodes: (gptContent: Record<string, unknown>, threadId: number) => Promise<void>;

    if (threadType === 'historical') {
      generationPrompt = `Create a historical/timeline knowledge thread about the given topic.
Extract 4-6 chronological events or eras as separate items.

Respond with only the JSON object — no preamble, no explanation.

Format as JSON:
{
  "summary": "brief overview (2-3 sentences)",
  "events": [
    { "title": "Event/Era title", "content": "2-3 sentence description", "type": "ROOT" }
  ],
  "synthesis": "brief synthesis tying it together"
}`;
      parseAndCreateNodes = async (gptContent, threadId) => {
        const events = (gptContent.events || []) as { title: string; content: string; type?: string }[];
        const entries = [
          { title: 'Overview', content: gptContent.summary as string, type: 'synthesis' },
          ...events.map(e => ({ title: e.title, content: e.content, type: 'claim' })),
          { title: 'Synthesis', content: gptContent.synthesis as string, type: 'synthesis' },
        ];
        for (const entry of entries) {
          const nodeId = await getNextId('node', tx);
          await tx.run(
            `CREATE (n:Node { id:$id, title:$title, content:$content, entity_type:$entityType, metadata:$meta, created_at:$now, updated_at:$now })
             WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:INCLUDES {position: 0, role: 'supporting', added_at: $now}]->(n)`,
            { id: getNeo4j().int(nodeId), title: entry.title, content: entry.content, entityType: entry.type, meta: JSON.stringify({ title: entry.title }), now: new Date().toISOString(), threadId: getNeo4j().int(threadId) }
          );
        }
      };
    } else if (threadType === 'debate') {
      generationPrompt = `Create a debate knowledge thread about the given topic.
Identify a central claim, 2-3 supporting evidence points, and 2-3 counterpoints.

Respond with only the JSON object — no preamble, no explanation.

Format as JSON:
{
  "summary": "brief overview",
  "centralClaim": { "title": "The central claim", "content": "detailed description" },
  "evidence": [
    { "title": "supporting point", "content": "detail with source if possible" }
  ],
  "counterpoints": [
    { "title": "opposing argument", "content": "explanation" }
  ],
  "synthesis": "brief balanced assessment"
}`;
      parseAndCreateNodes = async (gptContent, threadId) => {
        const entries: { title: string; content: string; type: string }[] = [];
        const claim = gptContent.centralClaim as { title: string; content: string };
        if (claim) entries.push({ title: claim.title, content: claim.content, type: 'claim' });
        for (const e of (gptContent.evidence || []) as { title: string; content: string }[]) {
          entries.push({ title: e.title, content: JSON.stringify(e), type: 'evidence' });
        }
        for (const cp of (gptContent.counterpoints || []) as { title: string; content: string }[]) {
          entries.push({ title: cp.title, content: JSON.stringify({ argument: cp.title, explanation: cp.content }), type: 'counterpoint' });
        }
        entries.push({ title: 'Synthesis', content: gptContent.synthesis as string, type: 'synthesis' });

        for (const entry of entries) {
          const nodeId = await getNextId('node', tx);
          await tx.run(
            `CREATE (n:Node { id:$id, title:$title, content:$content, entity_type:$entityType, metadata:$meta, created_at:$now, updated_at:$now })
             WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:INCLUDES {position: 0, role: 'supporting', added_at: $now}]->(n)`,
            { id: getNeo4j().int(nodeId), title: entry.title, content: entry.content, entityType: entry.type, meta: JSON.stringify({ title: entry.title }), now: new Date().toISOString(), threadId: getNeo4j().int(threadId) }
          );
        }
      };
    } else if (threadType === 'comparison') {
      generationPrompt = `Create a comparison knowledge thread about the given topic.
Identify 2-3 subjects to compare, with key attributes for each.

Respond with only the JSON object — no preamble, no explanation.

Format as JSON:
{
  "summary": "brief overview of what is being compared",
  "subjects": [
    {
      "title": "Subject name",
      "content": "overview of this subject",
      "details": [
        { "title": "key attribute", "content": "description" }
      ]
    }
  ],
  "synthesis": "brief comparative conclusion"
}`;
      parseAndCreateNodes = async (gptContent, threadId) => {
        const subjects = (gptContent.subjects || []) as { title: string; content: string; details?: { title: string; content: string }[] }[];
        // Create subject ROOT nodes
        for (const subj of subjects) {
          const rootId = await getNextId('node', tx);
          const rootNow = new Date().toISOString();
          await tx.run(
            `CREATE (n:Node { id:$id, title:$title, content:$content, entity_type:'claim', metadata:$meta, created_at:$now, updated_at:$now })
             WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:INCLUDES {position: 0, role: 'supporting', added_at: $now}]->(n)`,
            { id: getNeo4j().int(rootId), title: subj.title, content: subj.content, meta: JSON.stringify({ title: subj.title }), now: rootNow, threadId: getNeo4j().int(threadId) }
          );
          // Create child detail nodes
          for (const detail of subj.details || []) {
            const detailId = await getNextId('node', tx);
            await tx.run(
              `CREATE (n:Node { id:$id, title:$title, content:$content, entity_type:'evidence', metadata:$meta, created_at:$now, updated_at:$now })
               WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:INCLUDES {position: 0, role: 'supporting', added_at: $now}]->(n)
               WITH n MATCH (p:Node {id:$parentId}) CREATE (n)-[:SUPPORTS {created_at: $now}]->(p)`,
              { id: getNeo4j().int(detailId), title: detail.title, content: detail.content, meta: JSON.stringify({ title: detail.title }), now: new Date().toISOString(), threadId: getNeo4j().int(threadId), parentId: getNeo4j().int(rootId) }
            );
          }
        }
        // Synthesis
        const synthId = await getNextId('node', tx);
        await tx.run(
          `CREATE (n:Node { id:$id, title:'Synthesis', content:$content, entity_type:'synthesis', metadata:$meta, created_at:$now, updated_at:$now })
           WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:INCLUDES {position: 0, role: 'supporting', added_at: $now}]->(n)`,
          { id: getNeo4j().int(synthId), title: 'Synthesis', content: gptContent.synthesis as string, meta: JSON.stringify({ title: 'Synthesis' }), now: new Date().toISOString(), threadId: getNeo4j().int(threadId) }
        );
      };
    } else {
      // Standard (default)
      generationPrompt = `Create a brief knowledge thread about the given topic with:
1. A short summary (2-3 sentences)
2. One key piece of evidence with source
3. One example
4. One counterpoint
5. A brief synthesis (1-2 sentences)

Respond with only the JSON object — no preamble, no explanation, no conversational openers.

Format as JSON:
{
  "summary": "brief summary",
  "evidence": {"point": "evidence", "source": "source"},
  "example": {"title": "title", "description": "brief description"},
  "counterpoint": {"argument": "point", "explanation": "brief explanation"},
  "synthesis": "brief synthesis"
}`;
      parseAndCreateNodes = async (gptContent, threadId) => {
        const nodeEntries = [
          { title: 'Summary', content: gptContent.summary as string, type: 'synthesis' },
          { title: (gptContent.evidence as { source: string }).source, content: JSON.stringify(gptContent.evidence), type: 'evidence' },
          { title: (gptContent.example as { title: string }).title, content: JSON.stringify(gptContent.example), type: 'example' },
          { title: (gptContent.counterpoint as { argument: string }).argument, content: JSON.stringify(gptContent.counterpoint), type: 'counterpoint' },
          { title: 'Synthesis', content: gptContent.synthesis as string, type: 'synthesis' },
        ];
        for (const entry of nodeEntries) {
          const nodeId = await getNextId('node', tx);
          await tx.run(
            `CREATE (n:Node { id:$id, title:$title, content:$content, entity_type:$entityType, metadata:$meta, created_at:$now, updated_at:$now })
             WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:INCLUDES {position: 0, role: 'supporting', added_at: $now}]->(n)`,
            { id: getNeo4j().int(nodeId), title: entry.title, content: entry.content, entityType: entry.type, meta: JSON.stringify({ title: entry.title }), now: new Date().toISOString(), threadId: getNeo4j().int(threadId) }
          );
        }
      };
    }

    const threadResponse = await getGemini().chat.completions.create({
      model: config.gemini.chatModel,
      messages: [
        { role: 'system', content: generationPrompt },
        { role: 'user', content: `Create a knowledge thread about: ${topic}` },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });

    const gptContent = JSON.parse(threadResponse.choices[0].message.content!);

    // Create thread
    const threadId = await getNextId('thread', tx);
    const now = new Date().toISOString();
    const threadMetaStr = JSON.stringify({
      title: topic,
      description: (gptContent.summary || '').substring(0, 255),
      thread_type: threadType,
    });

    const threadResult = await tx.run(
      `CREATE (t:Thread {
        id: $id, title: $title, description: $description,
        thread_type: $threadType, metadata: $metadata,
        created_at: $now, updated_at: $now
      }) RETURN t`,
      {
        id: getNeo4j().int(threadId),
        title: topic,
        description: (gptContent.summary || '').substring(0, 255),
        threadType: threadType,
        metadata: threadMetaStr,
        now,
      }
    );

    // Create type-specific nodes
    await parseAndCreateNodes(gptContent, threadId);

    const thread = formatThread(threadResult.records[0].get('t').properties);
    res.json(thread);
  })
);

// ── GET /dashboard/stats — epistemological dashboard stats ───────────────────
router.get(
  '/dashboard/stats',
  withSession(async (req, res) => {
    const session = req.neo4jSession!;

    // 1. Total threads and total nodes
    const countsResult = await session.run(`
      OPTIONAL MATCH (t:Thread)
      WITH count(t) AS threadCount
      OPTIONAL MATCH (n:Node)
      RETURN threadCount, count(n) AS nodeCount
    `);
    const totalThreads = toNum(countsResult.records[0]?.get('threadCount') ?? 0) ?? 0;
    const totalNodes = toNum(countsResult.records[0]?.get('nodeCount') ?? 0) ?? 0;

    // 2. Node type distribution
    const typeResult = await session.run(`
      MATCH (n:Node)
      RETURN n.entity_type AS entityType, count(n) AS cnt
      ORDER BY cnt DESC
    `);
    const nodeTypeDistribution: Record<string, number> = {};
    for (const rec of typeResult.records) {
      const nt = rec.get('entityType');
      if (nt) nodeTypeDistribution[nt] = toNum(rec.get('cnt')) ?? 0;
    }

    // 3. Average confidence across threads
    const confResult = await session.run(`
      MATCH (c:ConfidenceRecord)
      RETURN avg(c.score) AS avgConf
    `);
    const avgConfRaw = confResult.records[0]?.get('avgConf');
    const averageConfidence = avgConfRaw != null ? Math.round(Number(avgConfRaw) * 100) / 100 : null;

    // 4. Top 5 lowest confidence threads
    const lowConfResult = await session.run(`
      MATCH (t:Thread)<-[:BELONGS_TO]-(c:ConfidenceRecord)
      WITH t, c ORDER BY c.created_at DESC
      WITH t, head(collect(c)) AS latestConf
      RETURN t.id AS id, t.title AS title, COALESCE(t.metadata, '') AS metadata, latestConf.score AS confidence
      ORDER BY latestConf.score ASC
      LIMIT 5
    `);
    const lowConfidenceThreads = lowConfResult.records.map(r => {
      let threadTitle = r.get('title') || '';
      try {
        const meta = r.get('metadata');
        if (meta) {
          const parsed = typeof meta === 'string' ? JSON.parse(meta) : meta;
          if (parsed.title) threadTitle = parsed.title;
        }
      } catch { /* ignore */ }
      return {
        id: toNum(r.get('id')) ?? 0,
        title: threadTitle,
        confidence: Math.round(Number(r.get('confidence')) * 100) / 100,
      };
    });

    // 5. Recent activity (last 10 nodes created)
    const recentResult = await session.run(`
      MATCH (n:Node)-[:BELONGS_TO]->(t:Thread)
      RETURN n.id AS id, n.title AS title, n.entity_type AS entityType,
             t.id AS threadId, t.title AS threadTitle, COALESCE(t.metadata, '') AS threadMeta,
             n.created_at AS created_at
      ORDER BY n.created_at DESC
      LIMIT 10
    `);
    const recentNodes = recentResult.records.map(r => {
      let tTitle = r.get('threadTitle') || '';
      try {
        const meta = r.get('threadMeta');
        if (meta) {
          const parsed = typeof meta === 'string' ? JSON.parse(meta) : meta;
          if (parsed.title) tTitle = parsed.title;
        }
      } catch { /* ignore */ }
      return {
        id: toNum(r.get('id')) ?? 0,
        title: r.get('title') || 'Untitled',
        entityType: r.get('entityType') || 'claim',
        threadId: toNum(r.get('threadId')) ?? 0,
        threadTitle: tTitle,
        created_at: r.get('created_at') || '',
      };
    });

    // 6. Total evidence and counterpoints
    const evidenceResult = await session.run(`
      OPTIONAL MATCH (e:Node {entity_type: 'evidence'})
      WITH count(e) AS evCount
      OPTIONAL MATCH (c:Node {entity_type: 'counterpoint'})
      RETURN evCount, count(c) AS cpCount
    `);
    const totalEvidence = toNum(evidenceResult.records[0]?.get('evCount') ?? 0) ?? 0;
    const totalCounterpoints = toNum(evidenceResult.records[0]?.get('cpCount') ?? 0) ?? 0;

    res.json({
      totalThreads,
      totalNodes,
      nodeTypeDistribution,
      averageConfidence,
      lowConfidenceThreads,
      recentNodes,
      totalEvidence,
      totalCounterpoints,
    });
  })
);

// ── POST /compare — compare two threads (requireAuth, aiTimeout) ─────────────
router.post(
  '/compare',
  requireAuth,
  aiTimeout,
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const { threadIdA, threadIdB } = req.body;

    if (!threadIdA || !threadIdB) {
      return res.status(400).json({ error: 'threadIdA and threadIdB are required' });
    }
    if (threadIdA === threadIdB) {
      return res.status(400).json({ error: 'Cannot compare a thread with itself' });
    }

    // Fetch thread metadata
    const threadRes = await session.run(
      `MATCH (t:Thread) WHERE t.id IN [$a, $b] RETURN t`,
      { a: getNeo4j().int(threadIdA), b: getNeo4j().int(threadIdB) }
    );
    if (threadRes.records.length < 2) {
      return res.status(404).json({ error: 'One or both threads not found' });
    }

    const threadMap: Record<number, { id: number; title: string }> = {};
    for (const rec of threadRes.records) {
      const props = rec.get('t').properties;
      const id = toNum(props.id)!;
      threadMap[id] = { id, title: (props.title as string) || `Thread ${id}` };
    }

    // Fetch nodes with embeddings for both threads
    const nodesRes = await session.run(
      `MATCH (t:Thread)-[:INCLUDES]->(n:Node)
       WHERE t.id IN [$a, $b]
       OPTIONAL MATCH (n)-[:CHILD_OF]->(p:Node)
       RETURN t.id AS threadId, n, p.id AS parentId`,
      { a: getNeo4j().int(threadIdA), b: getNeo4j().int(threadIdB) }
    );

    interface CompNode {
      id: number;
      title: string;
      entity_type: string;
      content: string;
      content_preview: string;
      embedding: number[] | null;
    }

    const nodesA: CompNode[] = [];
    const nodesB: CompNode[] = [];

    for (const rec of nodesRes.records) {
      const tid = toNum(rec.get('threadId'))!;
      const props = rec.get('n').properties;
      const rawContent = (props.content as string) || '';
      const plainContent = stripHtml(rawContent).substring(0, 300);

      const node: CompNode = {
        id: toNum(props.id)!,
        title: (props.title as string) || 'Untitled',
        entity_type: (props.entity_type as string) || 'claim',
        content: rawContent,
        content_preview: plainContent.substring(0, 200),
        embedding: props.embedding ? (props.embedding as number[]) : null,
      };

      if (tid === threadIdA) nodesA.push(node);
      else nodesB.push(node);
    }

    // Cosine similarity helper
    function cosineSimilarity(a: number[], b: number[]): number {
      if (a.length !== b.length || a.length === 0) return 0;
      let dot = 0, magA = 0, magB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
      }
      const denom = Math.sqrt(magA) * Math.sqrt(magB);
      return denom === 0 ? 0 : dot / denom;
    }

    // Compute pairwise similarities
    interface SimilarityPair {
      nodeA: CompNode;
      nodeB: CompNode;
      similarity: number;
    }

    const allPairs: SimilarityPair[] = [];
    for (const nA of nodesA) {
      if (!nA.embedding) continue;
      for (const nB of nodesB) {
        if (!nB.embedding) continue;
        const sim = cosineSimilarity(nA.embedding, nB.embedding);
        allPairs.push({ nodeA: nA, nodeB: nB, similarity: sim });
      }
    }

    // Greedy matching: sort by similarity descending
    allPairs.sort((a, b) => b.similarity - a.similarity);

    const matchedA = new Set<number>();
    const matchedB = new Set<number>();
    const shared: SimilarityPair[] = [];

    // First pass: high-confidence matches (>0.85)
    for (const pair of allPairs) {
      if (matchedA.has(pair.nodeA.id) || matchedB.has(pair.nodeB.id)) continue;
      if (pair.similarity > 0.85) {
        shared.push(pair);
        matchedA.add(pair.nodeA.id);
        matchedB.add(pair.nodeB.id);
      }
    }

    // Second pass: moderate matches (0.6-0.85)
    for (const pair of allPairs) {
      if (matchedA.has(pair.nodeA.id) || matchedB.has(pair.nodeB.id)) continue;
      if (pair.similarity > 0.6) {
        shared.push(pair);
        matchedA.add(pair.nodeA.id);
        matchedB.add(pair.nodeB.id);
      }
    }

    // Unique nodes: no match above 0.6
    const uniqueToA = nodesA.filter(n => !matchedA.has(n.id));
    const uniqueToB = nodesB.filter(n => !matchedB.has(n.id));

    // Check for contradictions among top shared pairs using GPT-4o-mini
    const contradictions: Array<{ nodeA: CompNode; nodeB: CompNode; reason: string }> = [];

    if (shared.length > 0) {
      const topShared = shared.slice(0, 10);
      try {
        const gemini = getGemini();
        const pairsDescription = topShared.map((p, i) => (
          `Pair ${i + 1}:\n  A: "${p.nodeA.title}" — ${stripHtml(p.nodeA.content).substring(0, 200)}\n  B: "${p.nodeB.title}" — ${stripHtml(p.nodeB.content).substring(0, 200)}`
        )).join('\n\n');

        const gptRes = await gemini.chat.completions.create({
          model: config.gemini.chatModel,
          temperature: 0.2,
          messages: [{
            role: 'system',
            content: `You analyze pairs of knowledge nodes from two research threads to identify contradictions.
A contradiction means the two nodes make conflicting or incompatible claims about the same topic.
Merely covering different aspects of the same topic is NOT a contradiction.
Return a JSON array of objects for ONLY the contradictory pairs: [{"pairIndex": number, "reason": "brief explanation"}]
If no contradictions exist, return an empty array: []
Return ONLY the JSON array, no other text.`,
          }, {
            role: 'user',
            content: pairsDescription,
          }],
        });

        const content = gptRes.choices[0]?.message?.content?.trim() || '[]';
        let parsed: Array<{ pairIndex: number; reason: string }> = [];
        try {
          parsed = JSON.parse(content);
        } catch {
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        }

        for (const c of parsed) {
          const idx = c.pairIndex - 1;
          if (idx >= 0 && idx < topShared.length) {
            contradictions.push({
              nodeA: topShared[idx].nodeA,
              nodeB: topShared[idx].nodeB,
              reason: c.reason,
            });
          }
        }
      } catch (err) {
        console.error('Contradiction detection failed:', err);
      }
    }

    // Remove contradictions from shared list
    const contradictionKeys = new Set(
      contradictions.map(c => `${c.nodeA.id}-${c.nodeB.id}`)
    );
    const filteredShared = shared.filter(
      p => !contradictionKeys.has(`${p.nodeA.id}-${p.nodeB.id}`)
    );

    // Format response
    const fmt = (n: CompNode) => ({
      id: n.id,
      title: n.title,
      entity_type: n.entity_type,
      content_preview: n.content_preview,
    });

    res.json({
      threadA: { ...threadMap[threadIdA], nodeCount: nodesA.length },
      threadB: { ...threadMap[threadIdB], nodeCount: nodesB.length },
      shared: filteredShared.map(p => ({
        nodeA: fmt(p.nodeA),
        nodeB: fmt(p.nodeB),
        similarity: Math.round(p.similarity * 100) / 100,
      })),
      contradictions: contradictions.map(c => ({
        nodeA: fmt(c.nodeA),
        nodeB: fmt(c.nodeB),
        reason: c.reason,
      })),
      uniqueToA: uniqueToA.map(fmt),
      uniqueToB: uniqueToB.map(fmt),
    });
  })
);

// ── GET /citations/network — citation network visualization ───────────────────
router.get(
  '/citations/network',
  requireAuth,
  withSession(async (req, res) => {
    const session = req.neo4jSession!;

    // 1. Query all REFERENCE and EVIDENCE nodes across all threads
    const result = await session.run(`
      MATCH (t:Thread)-[:INCLUDES]->(n:Node)
      WHERE n.entity_type IN ['source', 'evidence']
      RETURN n, t.id AS threadId, t.title AS threadTitle,
             t.description AS threadDescription
      ORDER BY n.created_at DESC
    `);

    // 2. Extract sources from node content/metadata
    const urlRegex = /https?:\/\/[^\s<>"',;)}\]]+/gi;
    const sourceMap = new Map<string, {
      id: string;
      title: string;
      url?: string;
      threadIds: Set<number>;
      threads: Map<number, string>;
      nodes: Array<{ id: number; title: string; threadId: number }>;
    }>();

    for (const record of result.records) {
      const props = record.get('n').properties;
      const nodeId = toNum(props.id) ?? 0;
      const nodeTitle: string = props.title || props.metadata?.title || 'Untitled';
      const nodeContent: string = props.content || '';
      const threadId = toNum(record.get('threadId')) ?? 0;
      const threadTitle: string = record.get('threadTitle') || record.get('threadDescription') || `Thread ${threadId}`;

      // Extract URLs from content
      const urls = nodeContent.match(urlRegex) || [];

      if (urls.length > 0) {
        for (const url of urls) {
          const cleanUrl = url.replace(/[.,;:!?)}\]]+$/, '');
          const key = cleanUrl.toLowerCase();
          let urlTitle: string;
          try {
            const parsed = new URL(cleanUrl);
            urlTitle = parsed.hostname.replace(/^www\./, '') + (parsed.pathname !== '/' ? parsed.pathname.substring(0, 50) : '');
          } catch {
            urlTitle = cleanUrl.substring(0, 60);
          }

          if (!sourceMap.has(key)) {
            const hash = Buffer.from(key).toString('base64url').substring(0, 16);
            sourceMap.set(key, {
              id: `src-${hash}`,
              title: urlTitle,
              url: cleanUrl,
              threadIds: new Set(),
              threads: new Map(),
              nodes: [],
            });
          }
          const src = sourceMap.get(key)!;
          src.threadIds.add(threadId);
          src.threads.set(threadId, threadTitle);
          src.nodes.push({ id: nodeId, title: nodeTitle, threadId });
        }
      } else {
        const normalizedTitle = nodeTitle.toLowerCase().trim().replace(/\s+/g, ' ');
        const key = `title:${normalizedTitle}`;

        if (!sourceMap.has(key)) {
          const hash = Buffer.from(key).toString('base64url').substring(0, 16);
          sourceMap.set(key, {
            id: `src-${hash}`,
            title: nodeTitle,
            threadIds: new Set(),
            threads: new Map(),
            nodes: [],
          });
        }
        const src = sourceMap.get(key)!;
        src.threadIds.add(threadId);
        src.threads.set(threadId, threadTitle);
        src.nodes.push({ id: nodeId, title: nodeTitle, threadId });
      }
    }

    // 3. Detect single points of failure
    const threadEvidenceSources = new Map<number, Map<string, number>>();
    for (const [key, src] of sourceMap) {
      for (const node of src.nodes) {
        if (!threadEvidenceSources.has(node.threadId)) {
          threadEvidenceSources.set(node.threadId, new Map());
        }
        const tMap = threadEvidenceSources.get(node.threadId)!;
        tMap.set(key, (tMap.get(key) || 0) + 1);
      }
    }

    const spofKeys = new Set<string>();
    for (const [, sourceCounts] of threadEvidenceSources) {
      if (sourceCounts.size === 1) {
        const [onlyKey] = sourceCounts.keys();
        spofKeys.add(onlyKey);
      }
    }

    // 4. Format sources
    const sources = Array.from(sourceMap.entries()).map(([key, src]) => ({
      id: src.id,
      title: src.title,
      url: src.url,
      referenceCount: src.nodes.length,
      threadCount: src.threadIds.size,
      threads: Array.from(src.threads.entries()).map(([id, title]) => ({ id, title })),
      nodes: src.nodes,
      isSinglePointOfFailure: spofKeys.has(key),
    }));

    sources.sort((a, b) => b.referenceCount - a.referenceCount);

    // 5. Build connections: sources that share threads
    const connections: Array<{ sourceA: string; sourceB: string; sharedThreads: number }> = [];
    const sourceEntries = Array.from(sourceMap.entries());
    for (let i = 0; i < sourceEntries.length; i++) {
      for (let j = i + 1; j < sourceEntries.length; j++) {
        const [, srcA] = sourceEntries[i];
        const [, srcB] = sourceEntries[j];
        let shared = 0;
        for (const tid of srcA.threadIds) {
          if (srcB.threadIds.has(tid)) shared++;
        }
        if (shared > 0) {
          connections.push({ sourceA: srcA.id, sourceB: srcB.id, sharedThreads: shared });
        }
      }
    }

    // 6. Stats
    const totalSources = sources.length;
    const avgReferencesPerSource = totalSources > 0
      ? Math.round((sources.reduce((sum, s) => sum + s.referenceCount, 0) / totalSources) * 100) / 100
      : 0;
    const singlePointOfFailureCount = sources.filter(s => s.isSinglePointOfFailure).length;

    res.json({
      sources,
      connections,
      stats: {
        totalSources,
        avgReferencesPerSource,
        singlePointOfFailureCount,
      },
    });
  })
);

// ── POST /:threadId/analyze — analyze thread confidence (requireAuth, aiTimeout)
router.post(
  '/:threadId/analyze',
  requireAuth,
  aiTimeout,
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const threadId = parseInt(req.params.threadId);

    const result = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:INCLUDES]->(n:Node) RETURN n ORDER BY n.created_at ASC`,
      { threadId: getNeo4j().int(threadId) }
    );

    const nodes = result.records.map(r => {
      const p = r.get('n').properties;
      return { id: toNum(p.id), title: p.title, entity_type: p.entity_type, content: p.content };
    });
    if (!nodes.length) return res.status(400).json({ error: 'No nodes found' });

    const rootNode = nodes.find(n => n.entity_type === 'claim');
    if (!rootNode) return res.status(400).json({ error: 'No claim node found' });

    const nodesSummary = nodes
      .map(n => {
        let c = String(n.content || '');
        try {
          const p = JSON.parse(c);
          c = p.description || p.point || p.explanation || p.argument || c;
        } catch {
          /* raw */
        }
        return `[${n.entity_type}] ${n.title}: ${c.replace(/<[^>]+>/g, ' ').substring(0, 400)}`;
      })
      .join('\n\n');

    const gemini = getGemini();
    const completion = await gemini.chat.completions.create({
      model: config.gemini.chatModel,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are an expert argument analyst. Analyse the strength of a knowledge thread and return a JSON confidence assessment.
Return exactly this JSON structure:
{
  "score": <0-100 integer, overall confidence>,
  "verdict": "<one of: Well-Supported | Moderately-Supported | Weakly-Supported | Contested>",
  "breakdown": {
    "evidenceStrength": <0-100>,
    "counterpointCoverage": <0-100, how well counterpoints are addressed>,
    "sourcingQuality": <0-100>,
    "logicalCoherence": <0-100>
  },
  "strengths": ["<strength 1>", "<strength 2>"],
  "gaps": ["<gap 1>", "<gap 2>"],
  "summary": "<2-3 sentence plain-English analysis>"
}`,
        },
        {
          role: 'user',
          content: `ROOT claim: "${rootNode.title}"\n\nAll nodes:\n${nodesSummary}`,
        },
      ],
    });

    res.json(JSON.parse(completion.choices[0].message.content!));
  })
);

// ── POST /:threadId/fork — fork thread (requireAuth, aiTimeout) ──────────────
router.post(
  '/:threadId/fork',
  requireAuth,
  aiTimeout,
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const threadId = parseInt(req.params.threadId);
    const { altClaim } = req.body;

    const tRes = await session.run(
      `MATCH (t:Thread {id:$tid}) RETURN t`,
      { tid: getNeo4j().int(threadId) }
    );
    if (!tRes.records.length) return res.status(404).json({ error: 'Thread not found' });
    const orig = tRes.records[0].get('t').properties;

    const nRes = await session.run(
      `MATCH (t:Thread {id:$tid})-[inc:INCLUDES]->(n:Node)
       RETURN n, inc.position AS position, inc.role AS role ORDER BY inc.position ASC`,
      { tid: getNeo4j().int(threadId) }
    );
    const origNodes = nRes.records.map(r => ({
      ...r.get('n').properties,
      id: toNum(r.get('n').properties.id),
      position: toNum(r.get('position')) ?? 0,
      role: r.get('role') || 'supporting',
    }));

    // Fetch typed relationships between nodes
    const relRes = await session.run(
      `MATCH (t:Thread {id:$tid})-[:INCLUDES]->(a:Node)
       MATCH (t)-[:INCLUDES]->(b:Node)
       MATCH (a)-[r]->(b)
       WHERE type(r) IN ['SUPPORTS','CONTRADICTS','QUALIFIES','DERIVES_FROM','ILLUSTRATES','CITES','ADDRESSES','REFERENCES']
       RETURN a.id AS srcId, b.id AS tgtId, type(r) AS relType, properties(r) AS relProps`,
      { tid: getNeo4j().int(threadId) }
    );
    const origRels = relRes.records.map(r => ({
      srcId: toNum(r.get('srcId'))!,
      tgtId: toNum(r.get('tgtId'))!,
      relType: r.get('relType') as string,
      relProps: r.get('relProps') as Record<string, unknown>,
    }));

    // Begin an explicit transaction for the clone
    const tx = session.beginTransaction();
    try {
      const now = new Date().toISOString();
      const forkTitle = altClaim || `Fork: ${orig.title}`;
      const newThreadId = await getNextId('Thread', tx);

      await tx.run(
        `CREATE (t:Thread {id:$id, title:$title, description:$desc, thread_type:$threadType, metadata:$meta, created_at:$now, updated_at:$now})`,
        {
          id: getNeo4j().int(newThreadId),
          title: forkTitle,
          desc: orig.description || '',
          threadType: orig.thread_type || 'argument',
          meta: orig.metadata || '{}',
          now,
        }
      );

      const idMap: Record<number, number> = {};
      const cloned: ClonedNode[] = [];
      for (const node of origNodes) {
        const newId = await getNextId('Node', tx);
        idMap[node.id] = newId;
        let title = node.title;
        let content = node.content || '';
        if (node.entity_type === 'claim' && altClaim) {
          title = altClaim;
          try {
            const p = JSON.parse(content);
            if (p.title) {
              p.title = altClaim;
              content = JSON.stringify(p);
            }
          } catch {
            /* raw */
          }
        }
        await tx.run(
          `CREATE (n:Node {id:$id, title:$title, content:$content, entity_type:$type, created_at:$now, updated_at:$now, metadata:$meta})`,
          {
            id: getNeo4j().int(newId),
            title,
            content,
            type: node.entity_type,
            now,
            meta: node.metadata || '{}',
          }
        );
        await tx.run(
          `MATCH (t:Thread {id:$tid}),(n:Node {id:$nid}) CREATE (t)-[:INCLUDES {position: $pos, role: $role, added_at: $now}]->(n)`,
          { tid: getNeo4j().int(newThreadId), nid: getNeo4j().int(newId), pos: getNeo4j().int(node.position), role: node.role, now }
        );
        cloned.push({
          id: newId,
          title,
          content,
          entity_type: node.entity_type,
          oldParentId: null,
          metadata: node.metadata,
        });
      }

      // Re-create typed relationships using the id map
      for (const rel of origRels) {
        const newSrc = idMap[rel.srcId];
        const newTgt = idMap[rel.tgtId];
        if (newSrc && newTgt && RELATIONSHIP_TYPES.includes(rel.relType as any)) {
          const relId = await getNextId('relationship', tx);
          await tx.run(
            `MATCH (a:Node {id:$src}),(b:Node {id:$tgt}) CREATE (a)-[:${rel.relType} {id: $relId, created_at: $now}]->(b)`,
            { src: getNeo4j().int(newSrc), tgt: getNeo4j().int(newTgt), relId: getNeo4j().int(relId), now }
          );
        }
      }
      await tx.commit();

      // Create FORKED_FROM relationship after transaction commits
      await session.run(
        `MATCH (orig:Thread {id: $origId}), (fork:Thread {id: $forkId}) CREATE (fork)-[:FORKED_FROM]->(orig)`,
        { origId: getNeo4j().int(threadId), forkId: getNeo4j().int(newThreadId) }
      );

      const now2 = now; // same timestamp
      const responseNodes = cloned.map(n =>
        formatNode(
          {
            id: n.id,
            title: n.title,
            content: n.content,
            entity_type: n.entity_type,
            created_at: now2,
            updated_at: now2,
            metadata: n.metadata || '{}',
          }
        )
      );

      res.json({
        thread: {
          id: newThreadId,
          title: forkTitle,
          description: orig.description || '',
          thread_type: orig.thread_type || 'argument',
          metadata: { title: forkTitle, description: orig.description || '' },
          nodes: responseNodes,
          relationships: [],
          forkedFrom: threadId,
        },
      });
    } catch (e) {
      try {
        await tx.rollback();
      } catch {
        /* connection may be dead */
      }
      throw e;
    }
  })
);

// ── POST /:threadId/redteam — red team a thread (requireAuth, aiTimeout) ─────
router.post(
  '/:threadId/redteam',
  requireAuth,
  aiTimeout,
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const threadId = parseInt(req.params.threadId);
    const { nodeId: targetNodeId } = req.body; // optional — defaults to ROOT

    const read = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:INCLUDES]->(n:Node) RETURN n ORDER BY n.created_at ASC`,
      { threadId: getNeo4j().int(threadId) }
    );
    const nodes = read.records.map(r => {
      const p = r.get('n').properties;
      return { id: toNum(p.id), title: p.title, entity_type: p.entity_type, content: p.content };
    });

    // Use the specified node, or fall back to ROOT
    const targetNode = targetNodeId
      ? nodes.find(n => n.id === parseInt(targetNodeId))
      : nodes.find(n => n.entity_type === 'claim');
    if (!targetNode) return res.status(400).json({ error: 'Target node not found' });

    // Extract plain text from target node content
    let targetContent = String(targetNode.content || '');
    try {
      const p = JSON.parse(targetContent);
      targetContent = p.description || p.point || p.explanation || p.argument || targetContent;
    } catch {
      /* raw */
    }
    targetContent = targetContent.replace(/<[^>]+>/g, ' ').substring(0, 600);

    const gemini = getGemini();
    const completion = await gemini.chat.completions.create({
      model: config.gemini.chatModel,
      temperature: 0.85,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a rigorous red-team critic. Attack the given claim by identifying 3-5 of its weakest points.
Each attack should target a specific gap: missing evidence, logical leaps, unstated assumptions, alternative explanations, or weak sourcing.
Return JSON: { "counterpoints": [{ "argument": "<concise attack title, max 12 words>", "explanation": "<2-3 HTML paragraphs with the critique>" }] }`,
        },
        {
          role: 'user',
          content: `Red-team this [${targetNode.entity_type}] claim:\n\nTitle: "${targetNode.title}"\n\nContent: ${targetContent}`,
        },
      ],
    });
    const { counterpoints = [] } = JSON.parse(completion.choices[0].message.content!);

    // Return proposals only — not saved yet. Frontend shows Accept/Discard.
    const proposals = counterpoints.map((cp: { argument: string; explanation: string }) => ({
      title: cp.argument,
      content: JSON.stringify({ argument: cp.argument, explanation: cp.explanation }),
      entityType: 'counterpoint',
    }));
    res.json({ proposals, parentNodeId: targetNode.id });
  })
);

// ── POST /:threadId/nodes/:nodeId/steelman — steelman a node (requireAuth, aiTimeout)
router.post(
  '/:threadId/nodes/:nodeId/steelman',
  requireAuth,
  aiTimeout,
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const nodeId = parseInt(req.params.nodeId);

    const read = await session.run(
      `MATCH (n:Node {id:$nodeId}) OPTIONAL MATCH (n)-[r]->(parent:Node) WHERE type(r) IN ['SUPPORTS','CONTRADICTS','QUALIFIES','DERIVES_FROM','ILLUSTRATES','CITES','ADDRESSES','REFERENCES'] RETURN n, parent`,
      { nodeId: getNeo4j().int(nodeId) }
    );
    if (!read.records.length) return res.status(404).json({ error: 'Node not found' });

    const nodeProps = read.records[0].get('n').properties;
    const parentRaw = read.records[0].get('parent');
    const parentId = parentRaw ? toNum(parentRaw.properties.id) : null;

    let argument = nodeProps.title;
    let explanation = '';
    try {
      const p = JSON.parse(nodeProps.content);
      argument = p.argument || nodeProps.title;
      explanation = p.explanation || '';
    } catch {
      explanation = String(nodeProps.content || '');
    }

    const gemini = getGemini();
    const completion = await gemini.chat.completions.create({
      model: config.gemini.chatModel,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a philosophical steelmanner. Rewrite the given argument in its STRONGEST possible form.
Add the best available evidence, sharpen the logic, remove strawman elements, and make it as compelling and hard to dismiss as possible.
Return JSON: { "argument": "<improved title, max 12 words>", "explanation": "<2-4 HTML paragraphs>" }`,
        },
        {
          role: 'user',
          content: `Steelman this:\n\nTitle: "${argument}"\nArgument: ${explanation.replace(/<[^>]+>/g, ' ')}`,
        },
      ],
    });
    const parsed = JSON.parse(completion.choices[0].message.content!);
    const steelTitle = parsed.argument;
    const steelContent = JSON.stringify({ argument: parsed.argument, explanation: parsed.explanation });

    // Return proposal only — not saved yet. Frontend shows Accept/Discard.
    res.json({
      proposal: { title: steelTitle, content: steelContent, entityType: 'counterpoint' },
      parentId,
    });
  })
);

// ── GET /:threadId/related — get related threads by embedding similarity ─────
router.get(
  '/:threadId/related',
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const threadId = parseInt(req.params.threadId);

    const threadResult = await session.run(
      'MATCH (t:Thread {id: $id}) RETURN t.embedding AS embedding',
      { id: getNeo4j().int(threadId) }
    );
    const embedding = threadResult.records[0]?.get('embedding');
    if (!embedding) return res.json([]);

    const results = await vectorQuery(session, 'thread_embedding', 6, embedding);
    const related = results.records
      .filter(r => toNum(r.get('node').properties.id) !== threadId)
      .slice(0, 5)
      .map(r => ({
        ...formatThread(r.get('node').properties),
        relevance: r.get('score'),
      }));
    res.json(related);
  })
);

// ── GET /:threadId/related-threads — get threads related via fork or shared links ──
router.get(
  '/:threadId/related-threads',
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const threadId = parseInt(req.params.threadId);

    // Threads that were forked from this thread
    const forksRes = await session.run(
      `MATCH (fork:Thread)-[:FORKED_FROM]->(t:Thread {id: $tid}) RETURN fork`,
      { tid: getNeo4j().int(threadId) }
    );
    const forks = forksRes.records.map(r => formatThread(r.get('fork').properties));

    // Thread this was forked from
    const parentRes = await session.run(
      `MATCH (t:Thread {id: $tid})-[:FORKED_FROM]->(orig:Thread) RETURN orig`,
      { tid: getNeo4j().int(threadId) }
    );
    const forkedFrom = parentRes.records.length
      ? formatThread(parentRes.records[0].get('orig').properties)
      : null;

    // Threads connected via shared node RELATED_TO links
    const linkedRes = await session.run(
      `MATCH (t:Thread {id: $tid})-[:INCLUDES]->(n:Node)-[:RELATED_TO]-(m:Node)<-[:INCLUDES]-(other:Thread)
       WHERE other.id <> $tid
       RETURN DISTINCT other`,
      { tid: getNeo4j().int(threadId) }
    );
    const linkedThreads = linkedRes.records.map(r => formatThread(r.get('other').properties));

    res.json({ forks, forkedFrom, linkedThreads });
  })
);

// ── POST /:threadId/validate — reasoning chain validation ────────────────────
router.post(
  '/:threadId/validate',
  requireAuth,
  aiTimeout,
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const threadId = parseInt(req.params.threadId);

    // Fetch all nodes with their relationships
    const result = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:INCLUDES]->(n:Node)
       OPTIONAL MATCH (n)-[rOut]->(target:Node) WHERE type(rOut) IN ['SUPPORTS','CONTRADICTS','QUALIFIES','DERIVES_FROM','ILLUSTRATES','CITES','ADDRESSES','REFERENCES']
       OPTIONAL MATCH (source:Node)-[rIn]->(n) WHERE type(rIn) IN ['SUPPORTS','CONTRADICTS','QUALIFIES','DERIVES_FROM','ILLUSTRATES','CITES','ADDRESSES','REFERENCES']
       RETURN n, collect(DISTINCT target) AS targets, collect(DISTINCT source) AS sources
       ORDER BY n.created_at ASC`,
      { threadId: getNeo4j().int(threadId) }
    );

    if (!result.records.length) return res.status(400).json({ error: 'No nodes found' });

    // Build a graph description for the LLM
    const nodeTree = result.records.map(r => {
      const p = r.get('n').properties;
      const children = (r.get('targets') as Array<{ properties: Record<string, unknown> }>)
        .filter(c => c && c.properties)
        .map(c => ({ id: toNum(c.properties.id), entity_type: c.properties.entity_type, title: c.properties.title }));
      const parents = (r.get('sources') as Array<{ properties: Record<string, unknown> }>)
        .filter(pa => pa && pa.properties)
        .map(pa => ({ id: toNum(pa.properties.id), entity_type: pa.properties.entity_type, title: pa.properties.title }));

      let content = String(p.content || '');
      try {
        const parsed = JSON.parse(content);
        content = parsed.description || parsed.explanation || parsed.argument || parsed.point || content;
      } catch { /* raw */ }

      return {
        id: toNum(p.id),
        title: p.title as string,
        entity_type: p.entity_type as string,
        content: stripHtml(content).substring(0, 500),
        parentIds: parents.map(pa => pa.id),
        childIds: children.map(c => c.id),
        childTypes: children.map(c => c.entity_type),
      };
    });

    const gemini = getGemini();
    const completion = await gemini.chat.completions.create({
      model: config.gemini.chatModel,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a rigorous logical analyst. Analyze the reasoning chain in this argument tree and identify issues.

For each issue found, categorize it as one of:
- "fallacy" — a logical fallacy (name the specific fallacy: ad hominem, straw man, appeal to authority, false dichotomy, etc.)
- "missing_link" — a gap in reasoning where the argument jumps from A to C without establishing B
- "circular" — circular reasoning where node A supports B which supports A (or longer cycles)
- "over_reliance" — multiple nodes depending on a single source or piece of evidence
- "unsupported" — a claim made without any supporting evidence nodes
- "contradiction" — two nodes in the tree that contradict each other

For each issue, specify:
- The node ID(s) involved
- A short description (1-2 sentences)
- Severity: "high", "medium", or "low"
- A suggestion for how to fix it (1 sentence)

Also provide an overall "chain_strength" score from 0-100 and a 1-2 sentence summary.

Return exactly this JSON:
{
  "chain_strength": <0-100>,
  "summary": "<overall assessment>",
  "issues": [
    {
      "type": "<fallacy|missing_link|circular|over_reliance|unsupported|contradiction>",
      "fallacy_name": "<specific fallacy name, only if type is fallacy>",
      "node_ids": [<involved node IDs>],
      "description": "<what the issue is>",
      "severity": "<high|medium|low>",
      "suggestion": "<how to fix>"
    }
  ]
}

If the argument is well-structured with no issues, return an empty issues array with a high chain_strength.`,
        },
        {
          role: 'user',
          content: `Argument tree:\n${JSON.stringify(nodeTree, null, 2)}`,
        },
      ],
    });

    const parsed = JSON.parse(completion.choices[0].message.content!);
    res.json(parsed);
  })
);

// ── GET /:threadId/node-confidence — per-node confidence scoring ─────────────
router.get(
  '/:threadId/node-confidence',
  requireAuth,
  aiTimeout,
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const threadId = parseInt(req.params.threadId);

    const result = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:INCLUDES]->(n:Node)
       OPTIONAL MATCH (other:Node)-[r]->(n) WHERE type(r) IN ['SUPPORTS','CONTRADICTS','QUALIFIES','DERIVES_FROM','ILLUSTRATES','CITES','ADDRESSES','REFERENCES']
       RETURN n, collect(DISTINCT other) AS supporters ORDER BY n.created_at ASC`,
      { threadId: getNeo4j().int(threadId) }
    );

    if (!result.records.length) return res.status(400).json({ error: 'No nodes found' });

    const nodesForPrompt = result.records.map(r => {
      const p = r.get('n').properties;
      const children = (r.get('supporters') as Array<{ properties: Record<string, unknown> }>)
        .filter(c => c && c.properties)
        .map(c => ({
          entity_type: c.properties.entity_type as string,
          title: c.properties.title as string,
        }));
      let content = String(p.content || '');
      try {
        const parsed = JSON.parse(content);
        content = parsed.description || parsed.point || parsed.explanation || parsed.argument || content;
      } catch { /* raw */ }
      return {
        id: toNum(p.id),
        title: p.title as string,
        entity_type: p.entity_type as string,
        content: content.replace(/<[^>]+>/g, ' ').substring(0, 300),
        childCount: children.length,
        childTypes: children.map(c => c.entity_type),
      };
    });

    const gemini = getGemini();
    const completion = await gemini.chat.completions.create({
      model: config.gemini.chatModel,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are an expert argument analyst. For each node in a knowledge thread, assign a confidence score from 0 to 100.
Consider:
- Whether the node has supporting evidence children (more children = more support)
- Quality and specificity of the content (vague claims score lower)
- Node type expectations: ROOT nodes need strong support from children to score high; EVIDENCE/REFERENCE nodes score based on content quality; EXAMPLE nodes are inherently lower-stakes; COUNTERPOINT nodes score based on how well they challenge the argument.

Return exactly this JSON:
{ "scores": { "<nodeId>": <0-100 integer>, ... } }
Include every node ID provided.`,
        },
        {
          role: 'user',
          content: `Nodes:\n${JSON.stringify(nodesForPrompt, null, 2)}`,
        },
      ],
    });

    const parsed = JSON.parse(completion.choices[0].message.content!);
    const scores: Record<string, number> = parsed.scores || {};

    // Update each node's confidence_score in Neo4j
    for (const [nodeId, score] of Object.entries(scores)) {
      await session.run(
        `MATCH (n:Node {id: $nodeId}) SET n.confidence_score = $score`,
        { nodeId: getNeo4j().int(parseInt(nodeId)), score: typeof score === 'number' ? score : 0 }
      );
    }

    // Convert string keys to numbers for response
    const numericScores: Record<number, number> = {};
    for (const [k, v] of Object.entries(scores)) {
      numericScores[parseInt(k)] = typeof v === 'number' ? v : 0;
    }

    res.json({ scores: numericScores });
  })
);

// ── POST /:threadId/perspectives — generate multi-perspective threads ────────
router.post(
  '/:threadId/perspectives',
  requireAuth,
  aiTimeout,
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const threadId = parseInt(req.params.threadId);

    // Fetch the original thread
    const tRes = await session.run(
      `MATCH (t:Thread {id:$tid}) RETURN t`,
      { tid: getNeo4j().int(threadId) }
    );
    if (!tRes.records.length) return res.status(404).json({ error: 'Thread not found' });
    const orig = tRes.records[0].get('t').properties;

    // Find the ROOT claim
    const nRes = await session.run(
      `MATCH (t:Thread {id:$tid})-[:INCLUDES]->(n:Node)
       RETURN n ORDER BY n.created_at ASC`,
      { tid: getNeo4j().int(threadId) }
    );
    const origNodes = nRes.records.map(r => r.get('n').properties);
    const rootNode = origNodes.find((n: Record<string, unknown>) => n.entity_type === 'claim');
    const rootClaim = rootNode ? String(rootNode.title || orig.title) : String(orig.title);

    let rootContent = '';
    if (rootNode) {
      try {
        const parsed = JSON.parse(String(rootNode.content || ''));
        rootContent = parsed.description || parsed.point || parsed.argument || String(rootNode.content || '');
      } catch {
        rootContent = String(rootNode.content || '');
      }
    }

    const gemini = getGemini();

    // Step 1: Generate perspective names
    const perspectiveCompletion = await gemini.chat.completions.create({
      model: config.gemini.chatModel,
      temperature: 0.8,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You identify distinct intellectual perspectives on a topic. Return 2-3 perspectives, each with a name and brief description.
Return JSON: { "perspectives": [{ "name": "Perspective Name", "description": "1-sentence description of this viewpoint" }] }`,
        },
        {
          role: 'user',
          content: `Topic/claim: "${rootClaim}"\n\nContext: ${rootContent.replace(/<[^>]+>/g, ' ').substring(0, 400)}`,
        },
      ],
    });

    const { perspectives: perspectiveDefs } = JSON.parse(perspectiveCompletion.choices[0].message.content!);
    if (!perspectiveDefs || !perspectiveDefs.length) {
      return res.status(500).json({ error: 'Failed to generate perspectives' });
    }

    // Step 2: For each perspective, generate a thread with nodes
    const createdThreads: ReturnType<typeof formatThread>[] = [];

    for (const pDef of perspectiveDefs as { name: string; description: string }[]) {
      const nodesCompletion = await gemini.chat.completions.create({
        model: config.gemini.chatModel,
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are arguing from the "${pDef.name}" perspective (${pDef.description}).
Generate an argument tree about the given topic from this specific viewpoint.

Return JSON:
{
  "rootClaim": { "title": "The central claim from this perspective (max 15 words)", "content": "2-3 sentence explanation" },
  "evidence": [
    { "title": "Supporting point title", "content": "2-3 sentence detail" }
  ],
  "counterpoint": { "title": "Main objection this perspective would raise", "content": "2-3 sentence explanation" }
}
Include 1-2 evidence items and exactly 1 counterpoint.`,
          },
          {
            role: 'user',
            content: `Topic: "${rootClaim}"`,
          },
        ],
      });

      const gptContent = JSON.parse(nodesCompletion.choices[0].message.content!);

      // Create the perspective thread
      const tx = session.beginTransaction();
      try {
        const newThreadId = await getNextId('thread', tx);
        const now = new Date().toISOString();
        const perspTitle = `${pDef.name}: ${(gptContent.rootClaim?.title || rootClaim).substring(0, 100)}`;
        const metaStr = JSON.stringify({
          title: perspTitle,
          description: pDef.description,
          perspective_of: threadId,
          perspective_name: pDef.name,
        });

        await tx.run(
          `CREATE (t:Thread {
            id: $id, title: $title, description: $description,
            thread_type: 'argument', metadata: $metadata,
            created_at: $now, updated_at: $now
          })`,
          {
            id: getNeo4j().int(newThreadId),
            title: perspTitle,
            description: pDef.description,
            metadata: metaStr,
            now,
          }
        );

        // Create ROOT node
        const rootId = await getNextId('node', tx);
        await tx.run(
          `CREATE (n:Node { id:$id, title:$title, content:$content, entity_type:'claim', metadata:$meta, created_at:$now, updated_at:$now })
           WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:INCLUDES {position: 0, role: 'root', added_at: $now}]->(n)`,
          {
            id: getNeo4j().int(rootId),
            title: gptContent.rootClaim?.title || rootClaim,
            content: gptContent.rootClaim?.content || '',
            meta: JSON.stringify({ title: gptContent.rootClaim?.title || rootClaim }),
            now,
            threadId: getNeo4j().int(newThreadId),
          }
        );

        // Create EVIDENCE nodes
        for (const ev of (gptContent.evidence || []) as { title: string; content: string }[]) {
          const evId = await getNextId('node', tx);
          await tx.run(
            `CREATE (n:Node { id:$id, title:$title, content:$content, entity_type:'evidence', metadata:$meta, created_at:$now, updated_at:$now })
             WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:INCLUDES {position: 0, role: 'supporting', added_at: $now}]->(n)
             WITH n MATCH (p:Node {id:$parentId}) CREATE (n)-[:SUPPORTS {created_at: $now}]->(p)`,
            {
              id: getNeo4j().int(evId),
              title: ev.title,
              content: JSON.stringify(ev),
              meta: JSON.stringify({ title: ev.title }),
              now,
              threadId: getNeo4j().int(newThreadId),
              parentId: getNeo4j().int(rootId),
            }
          );
        }

        // Create COUNTERPOINT node
        if (gptContent.counterpoint) {
          const cpId = await getNextId('node', tx);
          await tx.run(
            `CREATE (n:Node { id:$id, title:$title, content:$content, entity_type:'counterpoint', metadata:$meta, created_at:$now, updated_at:$now })
             WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:INCLUDES {position: 0, role: 'opposing', added_at: $now}]->(n)
             WITH n MATCH (p:Node {id:$parentId}) CREATE (n)-[:CONTRADICTS {created_at: $now}]->(p)`,
            {
              id: getNeo4j().int(cpId),
              title: gptContent.counterpoint.title,
              content: JSON.stringify({ argument: gptContent.counterpoint.title, explanation: gptContent.counterpoint.content }),
              meta: JSON.stringify({ title: gptContent.counterpoint.title }),
              now,
              threadId: getNeo4j().int(newThreadId),
              parentId: getNeo4j().int(rootId),
            }
          );
        }

        await tx.commit();

        // Create PERSPECTIVE_OF relationship after commit
        await session.run(
          `MATCH (p:Thread {id: $perspId}), (o:Thread {id: $origId}) CREATE (p)-[:PERSPECTIVE_OF]->(o)`,
          { perspId: getNeo4j().int(newThreadId), origId: getNeo4j().int(threadId) }
        );

        // Fetch the created thread with nodes for response
        const threadRes = await session.run(
          `MATCH (t:Thread {id:$tid}) RETURN t`,
          { tid: getNeo4j().int(newThreadId) }
        );
        const nodesRes = await session.run(
          `MATCH (t:Thread {id:$tid})-[:INCLUDES]->(n:Node) RETURN n ORDER BY n.created_at ASC`,
          { tid: getNeo4j().int(newThreadId) }
        );

        const thread = formatThread(threadRes.records[0].get('t').properties);
        const threadNodes = nodesRes.records.map((r, idx) => ({
          node: formatNode(r.get('n').properties),
          position: idx,
          role: 'supporting',
        }));
        createdThreads.push({ ...thread, nodes: threadNodes } as ReturnType<typeof formatThread>);
      } catch (e) {
        try { await tx.rollback(); } catch { /* connection may be dead */ }
        throw e;
      }
    }

    res.json({ perspectives: createdThreads });
  })
);

// ── GET /:threadId/perspectives — get perspective threads ────────────────────
router.get(
  '/:threadId/perspectives',
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const threadId = parseInt(req.params.threadId);

    const result = await session.run(
      `MATCH (p:Thread)-[:PERSPECTIVE_OF]->(t:Thread {id: $tid})
       OPTIONAL MATCH (p)-[:INCLUDES]->(n:Node)
       RETURN p, count(n) AS nodeCount ORDER BY p.created_at ASC`,
      { tid: getNeo4j().int(threadId) }
    );

    const perspectives = result.records.map(r => {
      const thread = formatThread(r.get('p').properties);
      const nodeCount = toNum(r.get('nodeCount'));
      let perspectiveName = '';
      try {
        const meta = JSON.parse(String(r.get('p').properties.metadata || '{}'));
        perspectiveName = meta.perspective_name || '';
      } catch { /* ignore */ }
      return { ...thread, nodeCount, perspectiveName };
    });

    res.json({ perspectives });
  })
);

// ── GET /:threadId/summary — return cached summary if it exists ──────────────
router.get(
  '/:threadId/summary',
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const threadId = parseInt(req.params.threadId);

    const result = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_SUMMARY]->(s:Summary)
       RETURN s ORDER BY s.generated_at DESC LIMIT 1`,
      { threadId: getNeo4j().int(threadId) }
    );

    if (!result.records.length) return res.status(404).json({ error: 'No summary found' });

    const props = result.records[0].get('s').properties;
    res.json({
      executive_summary: props.executive_summary,
      key_arguments: JSON.parse(String(props.key_arguments || '[]')),
      overall_verdict: props.overall_verdict,
      word_count: toNum(props.word_count),
      generated_at: props.generated_at,
    });
  })
);

// ── POST /:threadId/summary — generate executive summary via AI ──────────────
router.post(
  '/:threadId/summary',
  requireAuth,
  aiTimeout,
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const threadId = parseInt(req.params.threadId);

    // Fetch thread
    const tRes = await session.run(
      `MATCH (t:Thread {id: $threadId}) RETURN t`,
      { threadId: getNeo4j().int(threadId) }
    );
    if (!tRes.records.length) return res.status(404).json({ error: 'Thread not found' });
    const threadProps = tRes.records[0].get('t').properties;

    // Fetch all nodes
    const nRes = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:INCLUDES]->(n:Node)
       OPTIONAL MATCH (source:Node)-[rel]->(n) WHERE type(rel) IN ['SUPPORTS','CONTRADICTS','QUALIFIES','DERIVES_FROM','ILLUSTRATES','CITES','ADDRESSES','REFERENCES']
       RETURN n, collect(DISTINCT source) AS parents ORDER BY n.created_at ASC`,
      { threadId: getNeo4j().int(threadId) }
    );

    if (!nRes.records.length) return res.status(400).json({ error: 'No nodes found in thread' });

    // Build node descriptions for the LLM
    let totalWordCount = 0;
    const nodeDescriptions = nRes.records.map(r => {
      const p = r.get('n').properties;
      let content = String(p.content || '');
      try {
        const parsed = JSON.parse(content);
        content = parsed.description || parsed.explanation || parsed.argument || parsed.point || content;
      } catch { /* raw */ }
      content = stripHtml(content);
      totalWordCount += content.split(/\s+/).filter(Boolean).length;

      const parents = (r.get('parents') as Array<{ properties: Record<string, unknown> }>)
        .filter(pa => pa && pa.properties)
        .map(pa => toNum(pa.properties.id));

      return {
        id: toNum(p.id),
        title: p.title as string,
        entity_type: p.entity_type as string,
        content: content.substring(0, 600),
        parentIds: parents,
      };
    });

    const threadTitle = threadProps.title || '';
    const threadDescription = threadProps.description || '';

    const gemini = getGemini();
    const completion = await gemini.chat.completions.create({
      model: config.gemini.chatModel,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are an expert summarizer. Given an argument thread with its nodes, generate a comprehensive executive summary.

Return exactly this JSON:
{
  "executive_summary": "<2-3 paragraph overview of the thread's argument, key points, and conclusions>",
  "key_arguments": [
    {
      "title": "<argument title>",
      "supporting_evidence_count": <number of evidence/support nodes>,
      "confidence": <0.0-1.0 confidence score>
    }
  ],
  "overall_verdict": "<one-line assessment of the thread's argument strength and conclusion>"
}

Guidelines:
- The executive_summary should be readable by someone unfamiliar with the thread
- Include 3-6 key arguments
- Confidence scores should reflect how well-supported each argument is based on the evidence nodes
- The overall_verdict should be a single, clear sentence`,
        },
        {
          role: 'user',
          content: `Thread: "${threadTitle}"\nDescription: ${threadDescription}\n\nNodes:\n${JSON.stringify(nodeDescriptions, null, 2)}`,
        },
      ],
    });

    const parsed = JSON.parse(completion.choices[0].message.content!);
    const now = new Date().toISOString();

    const summary = {
      executive_summary: parsed.executive_summary || '',
      key_arguments: parsed.key_arguments || [],
      overall_verdict: parsed.overall_verdict || '',
      word_count: totalWordCount,
      generated_at: now,
    };

    // Delete old summary if exists, then create new one
    await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_SUMMARY]->(s:Summary) DETACH DELETE s`,
      { threadId: getNeo4j().int(threadId) }
    );

    await session.run(
      `MATCH (t:Thread {id: $threadId})
       CREATE (s:Summary {
         executive_summary: $executive_summary,
         key_arguments: $key_arguments,
         overall_verdict: $overall_verdict,
         word_count: $word_count,
         generated_at: $generated_at
       })
       CREATE (t)-[:HAS_SUMMARY]->(s)`,
      {
        threadId: getNeo4j().int(threadId),
        executive_summary: summary.executive_summary,
        key_arguments: JSON.stringify(summary.key_arguments),
        overall_verdict: summary.overall_verdict,
        word_count: getNeo4j().int(summary.word_count),
        generated_at: now,
      }
    );

    res.json(summary);
  })
);

// ── POST /:threadId/devils-advocate — auto-challenge unchallenged nodes (requireAuth, aiTimeout)
router.post(
  '/:threadId/devils-advocate',
  requireAuth,
  aiTimeout,
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const threadId = parseInt(req.params.threadId);

    // 1. Fetch all nodes with types of nodes that have relationships pointing to them (i.e. "supporting" nodes)
    const read = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:INCLUDES]->(n:Node)
       OPTIONAL MATCH (supporter:Node)-[r]->(n) WHERE type(r) IN ['SUPPORTS','CONTRADICTS','QUALIFIES','DERIVES_FROM','ILLUSTRATES','CITES','ADDRESSES','REFERENCES']
       RETURN n, collect(type(r)) AS incomingRelTypes`,
      { threadId: getNeo4j().int(threadId) }
    );

    const allNodes = read.records.map(r => {
      const p = r.get('n').properties;
      const childTypes: string[] = r.get('incomingRelTypes') || [];
      return {
        id: toNum(p.id),
        title: p.title,
        entity_type: p.entity_type,
        content: p.content,
        childTypes,
      };
    });

    const totalNodes = allNodes.length;
    if (totalNodes === 0) {
      return res.json({ challenges: [], unchallengedCount: 0, totalNodes: 0 });
    }

    // 2. Identify unchallenged nodes: claim, evidence, or context with no CONTRADICTS relationships
    const challengeableTypes = ['claim', 'evidence', 'context'];
    const unchallenged = allNodes.filter(n =>
      challengeableTypes.includes(n.entity_type) &&
      !n.childTypes.includes('CONTRADICTS')
    );

    const unchallengedCount = unchallenged.length;
    if (unchallengedCount === 0) {
      return res.json({ challenges: [], unchallengedCount: 0, totalNodes });
    }

    // 3. Pick up to 3 unchallenged nodes
    const selected = unchallenged.slice(0, 3);

    // 4. For each, call GPT-4o-mini to generate a challenge
    const gemini = getGemini();
    const challenges = await Promise.all(
      selected.map(async (node) => {
        let nodeContent = String(node.content || '');
        try {
          const p = JSON.parse(nodeContent);
          nodeContent = p.description || p.point || p.explanation || p.argument || nodeContent;
        } catch { /* raw */ }
        nodeContent = nodeContent.replace(/<[^>]+>/g, ' ').substring(0, 600);

        const completion = await gemini.chat.completions.create({
          model: config.gemini.chatModel,
          temperature: 0.85,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `You are a devil's advocate analyst. Your job is to challenge arguments that haven't been stress-tested yet.
Given a node from an argument tree, generate:
1. A probing question that challenges the claim
2. A counterargument that could weaken the position
3. A severity rating based on how serious the gap is

Return JSON: {
  "challengeQuestion": "<a probing question starting with 'Have you considered...' or similar>",
  "counterargument": { "title": "<concise counter-title, max 12 words>", "content": "<2-3 HTML paragraphs with the counterargument>" },
  "severity": "high" | "medium" | "low"
}

Severity guide:
- "high": fundamental flaw, missing critical evidence, or logical fallacy
- "medium": notable gap or unaddressed alternative explanation
- "low": minor nuance or edge case worth considering`,
            },
            {
              role: 'user',
              content: `Challenge this [${node.entity_type}] node:\n\nTitle: "${node.title}"\n\nContent: ${nodeContent}`,
            },
          ],
        });

        const parsed = JSON.parse(completion.choices[0].message.content!);
        return {
          targetNodeId: node.id,
          targetNodeTitle: node.title,
          challengeQuestion: parsed.challengeQuestion || 'Have you considered alternative viewpoints?',
          counterargument: {
            title: parsed.counterargument?.title || 'Counterpoint',
            content: parsed.counterargument?.content || '<p>Consider an alternative perspective.</p>',
            entityType: 'counterpoint',
          },
          severity: (['high', 'medium', 'low'].includes(parsed.severity) ? parsed.severity : 'medium') as 'high' | 'medium' | 'low',
        };
      })
    );

    // 5. Return proposals
    res.json({ challenges, unchallengedCount, totalNodes });
  })
);

// ── POST /:threadId/watch — search web for new evidence relevant to thread
router.post(
  '/:threadId/watch',
  requireAuth,
  aiTimeout,
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const threadId = parseInt(req.params.threadId);
    let { query } = req.body as { query?: string };

    // 1. Fetch thread + nodes
    const threadRead = await session.run(
      `MATCH (t:Thread {id: $threadId})
       OPTIONAL MATCH (t)-[:INCLUDES]->(n:Node)
       RETURN t, collect(n) AS nodes`,
      { threadId: getNeo4j().int(threadId) }
    );

    if (threadRead.records.length === 0) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    const threadProps = threadRead.records[0].get('t').properties;
    const threadTitle = threadProps.title || threadProps.metadata?.title || `Thread ${threadId}`;
    const rawNodes = threadRead.records[0].get('nodes') || [];

    const nodesList = rawNodes.map((n: any) => {
      const p = n.properties;
      return {
        id: toNum(p.id),
        title: p.title,
        entity_type: p.entity_type,
        content: String(p.content || '').replace(/<[^>]+>/g, ' ').substring(0, 300),
      };
    });

    // 2. Auto-generate query if not provided
    if (!query || !query.trim()) {
      const rootNode = nodesList.find((n: any) => n.entity_type === 'claim');
      const rootContent = rootNode ? rootNode.content.substring(0, 200) : '';
      query = `${threadTitle} ${rootContent}`.trim();
    }

    // 3. Build nodes summary for context
    const nodesSummary = nodesList
      .slice(0, 15)
      .map((n: any) => `[${n.entity_type}] "${n.title}": ${n.content.substring(0, 150)}`)
      .join('\n');

    // 4. Call OpenAI with web_search_preview
    const gemini = getGemini();
    const completion = await gemini.chat.completions.create({
      model: config.gemini.chatModel,
      messages: [
        {
          role: 'system',
          content: `You are a research assistant. Search the web for recent evidence related to the following argument thread. For each finding, assess whether it supports, contradicts, or extends existing nodes.

Return JSON with this exact structure:
{
  "findings": [
    {
      "title": "Brief title of the finding",
      "content": "2-3 sentence summary of what was found",
      "source_url": "https://actual-url-found",
      "relevance": "high" | "medium" | "low",
      "relationship": "supports" | "contradicts" | "extends",
      "relatedNodeId": <id of most relevant existing node or null>,
      "relatedNodeTitle": "<title of that node or empty string>",
      "proposedNodeType": "EVIDENCE" | "COUNTERPOINT"
    }
  ]
}

Return between 1 and 5 findings. Only include genuinely relevant results. If a finding contradicts existing claims, use "COUNTERPOINT" as proposedNodeType. Otherwise use "EVIDENCE".`,
        },
        {
          role: 'user',
          content: `Thread: "${threadTitle}"\n\nExisting nodes:\n${nodesSummary}\n\nSearch query: "${query}"\n\nFind recent web evidence related to this thread and return JSON with your findings.`,
        },
      ],
      tools: [{ type: 'web_search_preview' }] as any,
      response_format: { type: 'json_object' },
    } as any);

    // 5. Parse response
    let findings: any[] = [];
    try {
      const content = completion.choices[0].message.content;
      if (content) {
        const parsed = JSON.parse(content);
        findings = Array.isArray(parsed.findings) ? parsed.findings : [];
      }
    } catch {
      // If parsing fails, return empty findings
    }

    // 6. Sanitize and validate findings
    findings = findings.map((f: any) => ({
      title: String(f.title || 'Untitled finding'),
      content: String(f.content || ''),
      source_url: String(f.source_url || ''),
      relevance: ['high', 'medium', 'low'].includes(f.relevance) ? f.relevance : 'medium',
      relationship: ['supports', 'contradicts', 'extends'].includes(f.relationship) ? f.relationship : 'extends',
      relatedNodeId: typeof f.relatedNodeId === 'number' ? f.relatedNodeId : null,
      relatedNodeTitle: String(f.relatedNodeTitle || ''),
      proposedEntityType: f.proposedNodeType === 'COUNTERPOINT' ? 'counterpoint' : 'evidence',
    }));

    res.json({
      query,
      findings,
      searched_at: new Date().toISOString(),
    });
  })
);

export default router;
