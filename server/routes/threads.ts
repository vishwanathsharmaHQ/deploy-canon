import { Router } from 'express';
import { getNeo4j, toNum, getSession } from '../db/driver.js';
import { getNextId, formatThread, formatNode, vectorQuery, NODE_TYPES } from '../db/queries.js';
import { requireAuth } from '../middleware/auth.js';
import { withSession, withTransaction } from '../middleware/session.js';
import { aiTimeout } from '../middleware/aiTimeout.js';
import { getOpenAI, generateEmbedding, getEmbeddingText } from '../services/openai.js';
import { extractContentText, stripHtml } from '../services/contentParser.js';
import config from '../config.js';
import type { ClonedNode } from '../types/domain.js';

const router = Router();

// ── Argument Templates ───────────────────────────────────────────────────────
const TEMPLATES = [
  {
    key: 'toulmin',
    name: 'Toulmin Model',
    description: 'Claim → Grounds → Warrant → Backing → Qualifier → Rebuttal',
    nodes: [
      { title: 'Central Claim', nodeType: 'ROOT', content: '', parentIndex: 0 },
      { title: 'Grounds (Evidence)', nodeType: 'EVIDENCE', content: '', parentIndex: 0 },
      { title: 'Warrant (Reasoning)', nodeType: 'CONTEXT', content: '', parentIndex: 0 },
      { title: 'Backing (Support)', nodeType: 'EVIDENCE', content: '', parentIndex: 2 },
      { title: 'Qualifier (Limitations)', nodeType: 'CONTEXT', content: '', parentIndex: 0 },
      { title: 'Rebuttal', nodeType: 'COUNTERPOINT', content: '', parentIndex: 0 },
    ]
  },
  {
    key: 'steelman',
    name: 'Steel Man Analysis',
    description: 'Build the strongest version of an opposing argument',
    nodes: [
      { title: 'Opposing Position', nodeType: 'ROOT', content: '', parentIndex: 0 },
      { title: 'Strongest Supporting Evidence', nodeType: 'EVIDENCE', content: '', parentIndex: 0 },
      { title: 'Best Case Reasoning', nodeType: 'CONTEXT', content: '', parentIndex: 0 },
      { title: 'Strongest Counterpoint to Your View', nodeType: 'COUNTERPOINT', content: '', parentIndex: 0 },
      { title: 'Synthesis & Response', nodeType: 'SYNTHESIS', content: '', parentIndex: 0 },
    ]
  },
  {
    key: 'cost_benefit',
    name: 'Cost-Benefit Analysis',
    description: 'Systematic evaluation of pros, cons, and trade-offs',
    nodes: [
      { title: 'Decision/Proposal', nodeType: 'ROOT', content: '', parentIndex: 0 },
      { title: 'Key Benefit 1', nodeType: 'EVIDENCE', content: '', parentIndex: 0 },
      { title: 'Key Benefit 2', nodeType: 'EVIDENCE', content: '', parentIndex: 0 },
      { title: 'Key Cost/Risk 1', nodeType: 'COUNTERPOINT', content: '', parentIndex: 0 },
      { title: 'Key Cost/Risk 2', nodeType: 'COUNTERPOINT', content: '', parentIndex: 0 },
      { title: 'Net Assessment', nodeType: 'SYNTHESIS', content: '', parentIndex: 0 },
    ]
  },
  {
    key: 'literature_review',
    name: 'Literature Review',
    description: 'Synthesize multiple sources into themes and gaps',
    nodes: [
      { title: 'Research Question', nodeType: 'ROOT', content: '', parentIndex: 0 },
      { title: 'Source 1 Findings', nodeType: 'REFERENCE', content: '', parentIndex: 0 },
      { title: 'Source 2 Findings', nodeType: 'REFERENCE', content: '', parentIndex: 0 },
      { title: 'Common Theme', nodeType: 'CONTEXT', content: '', parentIndex: 0 },
      { title: 'Research Gap', nodeType: 'COUNTERPOINT', content: '', parentIndex: 0 },
      { title: 'Synthesis', nodeType: 'SYNTHESIS', content: '', parentIndex: 0 },
    ]
  },
  {
    key: 'decision_matrix',
    name: 'Decision Matrix',
    description: 'Compare options against weighted criteria',
    nodes: [
      { title: 'Decision to Make', nodeType: 'ROOT', content: '', parentIndex: 0 },
      { title: 'Option A', nodeType: 'CONTEXT', content: '', parentIndex: 0 },
      { title: 'Option B', nodeType: 'CONTEXT', content: '', parentIndex: 0 },
      { title: 'Pro: Option A', nodeType: 'EVIDENCE', content: '', parentIndex: 1 },
      { title: 'Con: Option A', nodeType: 'COUNTERPOINT', content: '', parentIndex: 1 },
      { title: 'Pro: Option B', nodeType: 'EVIDENCE', content: '', parentIndex: 2 },
      { title: 'Con: Option B', nodeType: 'COUNTERPOINT', content: '', parentIndex: 2 },
      { title: 'Recommendation', nodeType: 'SYNTHESIS', content: '', parentIndex: 0 },
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
    const metaStr = JSON.stringify({ title, description: description || '', thread_type: 'template', template: templateKey });

    const threadResult = await tx.run(
      `CREATE (t:Thread {
        id: $id, title: $title, description: $description,
        content: '', metadata: $metadata,
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
    const createdNodes: Array<{ id: number; title: string; node_type: string; content: string; parentId: number | null }> = [];

    for (let i = 0; i < template.nodes.length; i++) {
      const tNode = template.nodes[i];
      const nodeId = await getNextId('node', tx);
      createdNodeIds.push(nodeId);

      await tx.run(
        `CREATE (n:Node { id:$id, title:$title, content:$content, node_type:$nodeType, metadata:$meta, created_at:$now, updated_at:$now })
         WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:HAS_NODE]->(n)`,
        {
          id: getNeo4j().int(nodeId),
          title: tNode.title,
          content: tNode.content,
          nodeType: tNode.nodeType,
          meta: JSON.stringify({ title: tNode.title }),
          now,
          threadId: getNeo4j().int(threadId),
        }
      );

      // Determine parent: for index 0 (the ROOT), no parent; otherwise use parentIndex
      let parentId: number | null = null;
      if (i > 0 && tNode.parentIndex !== undefined && tNode.parentIndex < createdNodeIds.length) {
        parentId = createdNodeIds[tNode.parentIndex];
        await tx.run(
          `MATCH (p:Node {id:$pid}),(c:Node {id:$cid}) CREATE (p)-[:PARENT_OF]->(c)`,
          { pid: getNeo4j().int(parentId), cid: getNeo4j().int(nodeId) }
        );
      }

      createdNodes.push({
        id: nodeId,
        title: tNode.title,
        node_type: tNode.nodeType,
        content: tNode.content,
        parentId,
      });
    }

    const thread = formatThread(threadResult.records[0].get('t').properties);
    const nodes = createdNodes.map(n => formatNode(
      { id: n.id, title: n.title, content: n.content, node_type: n.node_type, created_at: now, updated_at: now, metadata: JSON.stringify({ title: n.title }) },
      n.parentId
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
    const { title, description, content, metadata } = req.body;

    const id = await getNextId('thread', session);
    const now = new Date().toISOString();
    const metaStr = JSON.stringify({ title, description, content, ...metadata });

    const result = await session.run(
      `CREATE (t:Thread {
        id: $id, title: $title, description: $description,
        content: $content, metadata: $metadata,
        created_at: $now, updated_at: $now
      }) RETURN t`,
      {
        id: getNeo4j().int(id),
        title,
        description: description || '',
        content: content || '',
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
          { title: 'Overview', content: gptContent.summary as string, type: 'SYNTHESIS' },
          ...events.map(e => ({ title: e.title, content: e.content, type: 'ROOT' })),
          { title: 'Synthesis', content: gptContent.synthesis as string, type: 'SYNTHESIS' },
        ];
        for (const entry of entries) {
          const nodeId = await getNextId('node', tx);
          await tx.run(
            `CREATE (n:Node { id:$id, title:$title, content:$content, node_type:$nodeType, metadata:$meta, created_at:$now, updated_at:$now })
             WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:HAS_NODE]->(n)`,
            { id: getNeo4j().int(nodeId), title: entry.title, content: entry.content, nodeType: entry.type, meta: JSON.stringify({ title: entry.title }), now: new Date().toISOString(), threadId: getNeo4j().int(threadId) }
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
        if (claim) entries.push({ title: claim.title, content: claim.content, type: 'ROOT' });
        for (const e of (gptContent.evidence || []) as { title: string; content: string }[]) {
          entries.push({ title: e.title, content: JSON.stringify(e), type: 'EVIDENCE' });
        }
        for (const cp of (gptContent.counterpoints || []) as { title: string; content: string }[]) {
          entries.push({ title: cp.title, content: JSON.stringify({ argument: cp.title, explanation: cp.content }), type: 'COUNTERPOINT' });
        }
        entries.push({ title: 'Synthesis', content: gptContent.synthesis as string, type: 'SYNTHESIS' });

        for (const entry of entries) {
          const nodeId = await getNextId('node', tx);
          await tx.run(
            `CREATE (n:Node { id:$id, title:$title, content:$content, node_type:$nodeType, metadata:$meta, created_at:$now, updated_at:$now })
             WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:HAS_NODE]->(n)`,
            { id: getNeo4j().int(nodeId), title: entry.title, content: entry.content, nodeType: entry.type, meta: JSON.stringify({ title: entry.title }), now: new Date().toISOString(), threadId: getNeo4j().int(threadId) }
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
            `CREATE (n:Node { id:$id, title:$title, content:$content, node_type:'ROOT', metadata:$meta, created_at:$now, updated_at:$now })
             WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:HAS_NODE]->(n)`,
            { id: getNeo4j().int(rootId), title: subj.title, content: subj.content, meta: JSON.stringify({ title: subj.title }), now: rootNow, threadId: getNeo4j().int(threadId) }
          );
          // Create child detail nodes
          for (const detail of subj.details || []) {
            const detailId = await getNextId('node', tx);
            await tx.run(
              `CREATE (n:Node { id:$id, title:$title, content:$content, node_type:'EVIDENCE', metadata:$meta, created_at:$now, updated_at:$now })
               WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:HAS_NODE]->(n)
               WITH n MATCH (p:Node {id:$parentId}) CREATE (p)-[:PARENT_OF]->(n)`,
              { id: getNeo4j().int(detailId), title: detail.title, content: detail.content, meta: JSON.stringify({ title: detail.title }), now: new Date().toISOString(), threadId: getNeo4j().int(threadId), parentId: getNeo4j().int(rootId) }
            );
          }
        }
        // Synthesis
        const synthId = await getNextId('node', tx);
        await tx.run(
          `CREATE (n:Node { id:$id, title:'Synthesis', content:$content, node_type:'SYNTHESIS', metadata:$meta, created_at:$now, updated_at:$now })
           WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:HAS_NODE]->(n)`,
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
          { title: 'Summary', content: gptContent.summary as string, type: 'SYNTHESIS' },
          { title: (gptContent.evidence as { source: string }).source, content: JSON.stringify(gptContent.evidence), type: 'EVIDENCE' },
          { title: (gptContent.example as { title: string }).title, content: JSON.stringify(gptContent.example), type: 'EXAMPLE' },
          { title: (gptContent.counterpoint as { argument: string }).argument, content: JSON.stringify(gptContent.counterpoint), type: 'COUNTERPOINT' },
          { title: 'Synthesis', content: gptContent.synthesis as string, type: 'SYNTHESIS' },
        ];
        for (const entry of nodeEntries) {
          const nodeId = await getNextId('node', tx);
          await tx.run(
            `CREATE (n:Node { id:$id, title:$title, content:$content, node_type:$nodeType, metadata:$meta, created_at:$now, updated_at:$now })
             WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:HAS_NODE]->(n)`,
            { id: getNeo4j().int(nodeId), title: entry.title, content: entry.content, nodeType: entry.type, meta: JSON.stringify({ title: entry.title }), now: new Date().toISOString(), threadId: getNeo4j().int(threadId) }
          );
        }
      };
    }

    const threadResponse = await getOpenAI().chat.completions.create({
      model: config.openai.chatModel,
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
        content: $content, metadata: $metadata,
        created_at: $now, updated_at: $now
      }) RETURN t`,
      {
        id: getNeo4j().int(threadId),
        title: topic,
        description: (gptContent.summary || '').substring(0, 255),
        content: gptContent.summary || '',
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
      RETURN n.node_type AS nodeType, count(n) AS cnt
      ORDER BY cnt DESC
    `);
    const nodeTypeDistribution: Record<string, number> = {};
    for (const rec of typeResult.records) {
      const nt = rec.get('nodeType');
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
      RETURN n.id AS id, n.title AS title, n.node_type AS nodeType,
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
        nodeType: r.get('nodeType') || 'ROOT',
        threadId: toNum(r.get('threadId')) ?? 0,
        threadTitle: tTitle,
        created_at: r.get('created_at') || '',
      };
    });

    // 6. Total evidence and counterpoints
    const evidenceResult = await session.run(`
      OPTIONAL MATCH (e:Node {node_type: 'EVIDENCE'})
      WITH count(e) AS evCount
      OPTIONAL MATCH (c:Node {node_type: 'COUNTERPOINT'})
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

// ── POST /:threadId/analyze — analyze thread confidence (requireAuth, aiTimeout)
router.post(
  '/:threadId/analyze',
  requireAuth,
  aiTimeout,
  withSession(async (req, res) => {
    const session = req.neo4jSession!;
    const threadId = parseInt(req.params.threadId);

    const result = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node) RETURN n ORDER BY n.created_at ASC`,
      { threadId: getNeo4j().int(threadId) }
    );

    const nodes = result.records.map(r => {
      const p = r.get('n').properties;
      return { id: toNum(p.id), title: p.title, node_type: p.node_type, content: p.content };
    });
    if (!nodes.length) return res.status(400).json({ error: 'No nodes found' });

    const rootNode = nodes.find(n => n.node_type === 'ROOT');
    if (!rootNode) return res.status(400).json({ error: 'No ROOT node found' });

    const nodesSummary = nodes
      .map(n => {
        let c = String(n.content || '');
        try {
          const p = JSON.parse(c);
          c = p.description || p.point || p.explanation || p.argument || c;
        } catch {
          /* raw */
        }
        return `[${n.node_type}] ${n.title}: ${c.replace(/<[^>]+>/g, ' ').substring(0, 400)}`;
      })
      .join('\n\n');

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
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
      `MATCH (t:Thread {id:$tid})-[:HAS_NODE]->(n:Node)
       OPTIONAL MATCH (parent:Node)-[:PARENT_OF]->(n)
       RETURN n, parent.id AS parentId ORDER BY n.created_at ASC`,
      { tid: getNeo4j().int(threadId) }
    );
    const origNodes = nRes.records.map(r => ({
      ...r.get('n').properties,
      id: toNum(r.get('n').properties.id),
      parentId: r.get('parentId') ? toNum(r.get('parentId')) : null,
    }));

    // Begin an explicit transaction for the clone
    const tx = session.beginTransaction();
    try {
      const now = new Date().toISOString();
      const forkTitle = altClaim || `Fork: ${orig.title}`;
      const newThreadId = await getNextId('Thread', tx);

      await tx.run(
        `CREATE (t:Thread {id:$id, title:$title, description:$desc, content:$content, metadata:$meta, created_at:$now, updated_at:$now})`,
        {
          id: getNeo4j().int(newThreadId),
          title: forkTitle,
          desc: orig.description || '',
          content: orig.content || '',
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
        if (node.node_type === 'ROOT' && altClaim) {
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
          `CREATE (n:Node {id:$id, title:$title, content:$content, node_type:$type, created_at:$now, updated_at:$now, metadata:$meta})`,
          {
            id: getNeo4j().int(newId),
            title,
            content,
            type: node.node_type,
            now,
            meta: node.metadata || '{}',
          }
        );
        await tx.run(
          `MATCH (t:Thread {id:$tid}),(n:Node {id:$nid}) CREATE (t)-[:HAS_NODE]->(n)`,
          { tid: getNeo4j().int(newThreadId), nid: getNeo4j().int(newId) }
        );
        cloned.push({
          id: newId,
          title,
          content,
          node_type: node.node_type,
          oldParentId: node.parentId,
          metadata: node.metadata,
        });
      }

      // Re-create PARENT_OF edges using the id map
      for (const n of cloned) {
        if (n.oldParentId && idMap[n.oldParentId]) {
          await tx.run(
            `MATCH (p:Node {id:$pid}),(c:Node {id:$cid}) CREATE (p)-[:PARENT_OF]->(c)`,
            { pid: getNeo4j().int(idMap[n.oldParentId]), cid: getNeo4j().int(n.id) }
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
            node_type: n.node_type,
            created_at: now2,
            updated_at: now2,
            metadata: n.metadata || '{}',
          },
          n.oldParentId ? idMap[n.oldParentId] : null
        )
      );

      res.json({
        thread: {
          id: newThreadId,
          title: forkTitle,
          description: orig.description || '',
          content: orig.content || '',
          metadata: { title: forkTitle, description: orig.description || '' },
          nodes: responseNodes,
          edges: [],
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
      `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node) RETURN n ORDER BY n.created_at ASC`,
      { threadId: getNeo4j().int(threadId) }
    );
    const nodes = read.records.map(r => {
      const p = r.get('n').properties;
      return { id: toNum(p.id), title: p.title, node_type: p.node_type, content: p.content };
    });

    // Use the specified node, or fall back to ROOT
    const targetNode = targetNodeId
      ? nodes.find(n => n.id === parseInt(targetNodeId))
      : nodes.find(n => n.node_type === 'ROOT');
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

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
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
          content: `Red-team this [${targetNode.node_type}] claim:\n\nTitle: "${targetNode.title}"\n\nContent: ${targetContent}`,
        },
      ],
    });
    const { counterpoints = [] } = JSON.parse(completion.choices[0].message.content!);

    // Return proposals only — not saved yet. Frontend shows Accept/Discard.
    const proposals = counterpoints.map((cp: { argument: string; explanation: string }) => ({
      title: cp.argument,
      content: JSON.stringify({ argument: cp.argument, explanation: cp.explanation }),
      nodeType: 'COUNTERPOINT',
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
      `MATCH (n:Node {id:$nodeId}) OPTIONAL MATCH (parent)-[:PARENT_OF]->(n) RETURN n, parent`,
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

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
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
      proposal: { title: steelTitle, content: steelContent, nodeType: 'COUNTERPOINT' },
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
      `MATCH (t:Thread {id: $tid})-[:HAS_NODE]->(n:Node)-[:RELATED_TO]-(m:Node)<-[:HAS_NODE]-(other:Thread)
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

    // Fetch all nodes with parent relationships
    const result = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node)
       OPTIONAL MATCH (n)-[:PARENT_OF]->(child:Node)
       OPTIONAL MATCH (parent:Node)-[:PARENT_OF]->(n)
       RETURN n, collect(DISTINCT child) AS children, collect(DISTINCT parent) AS parents
       ORDER BY n.created_at ASC`,
      { threadId: getNeo4j().int(threadId) }
    );

    if (!result.records.length) return res.status(400).json({ error: 'No nodes found' });

    // Build a tree description for the LLM
    const nodeTree = result.records.map(r => {
      const p = r.get('n').properties;
      const children = (r.get('children') as Array<{ properties: Record<string, unknown> }>)
        .filter(c => c && c.properties)
        .map(c => ({ id: toNum(c.properties.id), node_type: c.properties.node_type, title: c.properties.title }));
      const parents = (r.get('parents') as Array<{ properties: Record<string, unknown> }>)
        .filter(pa => pa && pa.properties)
        .map(pa => ({ id: toNum(pa.properties.id), node_type: pa.properties.node_type, title: pa.properties.title }));

      let content = String(p.content || '');
      try {
        const parsed = JSON.parse(content);
        content = parsed.description || parsed.explanation || parsed.argument || parsed.point || content;
      } catch { /* raw */ }

      return {
        id: toNum(p.id),
        title: p.title as string,
        node_type: p.node_type as string,
        content: stripHtml(content).substring(0, 500),
        parentIds: parents.map(pa => pa.id),
        childIds: children.map(c => c.id),
        childTypes: children.map(c => c.node_type),
      };
    });

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
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
      `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node)
       OPTIONAL MATCH (n)-[:PARENT_OF]->(child:Node)
       RETURN n, collect(child) AS children ORDER BY n.created_at ASC`,
      { threadId: getNeo4j().int(threadId) }
    );

    if (!result.records.length) return res.status(400).json({ error: 'No nodes found' });

    const nodesForPrompt = result.records.map(r => {
      const p = r.get('n').properties;
      const children = (r.get('children') as Array<{ properties: Record<string, unknown> }>)
        .filter(c => c && c.properties)
        .map(c => ({
          node_type: c.properties.node_type as string,
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
        node_type: p.node_type as string,
        content: content.replace(/<[^>]+>/g, ' ').substring(0, 300),
        childCount: children.length,
        childTypes: children.map(c => c.node_type),
      };
    });

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
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
      `MATCH (t:Thread {id:$tid})-[:HAS_NODE]->(n:Node)
       RETURN n ORDER BY n.created_at ASC`,
      { tid: getNeo4j().int(threadId) }
    );
    const origNodes = nRes.records.map(r => r.get('n').properties);
    const rootNode = origNodes.find((n: Record<string, unknown>) => n.node_type === 'ROOT');
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

    const openai = getOpenAI();

    // Step 1: Generate perspective names
    const perspectiveCompletion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
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
      const nodesCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
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
            content: $content, metadata: $metadata,
            created_at: $now, updated_at: $now
          })`,
          {
            id: getNeo4j().int(newThreadId),
            title: perspTitle,
            description: pDef.description,
            content: gptContent.rootClaim?.content || '',
            metadata: metaStr,
            now,
          }
        );

        // Create ROOT node
        const rootId = await getNextId('node', tx);
        await tx.run(
          `CREATE (n:Node { id:$id, title:$title, content:$content, node_type:'ROOT', metadata:$meta, created_at:$now, updated_at:$now })
           WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:HAS_NODE]->(n)`,
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
            `CREATE (n:Node { id:$id, title:$title, content:$content, node_type:'EVIDENCE', metadata:$meta, created_at:$now, updated_at:$now })
             WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:HAS_NODE]->(n)
             WITH n MATCH (p:Node {id:$parentId}) CREATE (p)-[:PARENT_OF]->(n)`,
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
            `CREATE (n:Node { id:$id, title:$title, content:$content, node_type:'COUNTERPOINT', metadata:$meta, created_at:$now, updated_at:$now })
             WITH n MATCH (t:Thread {id:$threadId}) CREATE (t)-[:HAS_NODE]->(n)
             WITH n MATCH (p:Node {id:$parentId}) CREATE (p)-[:PARENT_OF]->(n)`,
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
          `MATCH (t:Thread {id:$tid})-[:HAS_NODE]->(n:Node) RETURN n ORDER BY n.created_at ASC`,
          { tid: getNeo4j().int(newThreadId) }
        );

        const thread = formatThread(threadRes.records[0].get('t').properties);
        const threadNodes = nodesRes.records.map(r => formatNode(r.get('n').properties, null));
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
       OPTIONAL MATCH (p)-[:HAS_NODE]->(n:Node)
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
      `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node)
       OPTIONAL MATCH (parent:Node)-[:PARENT_OF]->(n)
       RETURN n, collect(DISTINCT parent) AS parents ORDER BY n.created_at ASC`,
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
        node_type: p.node_type as string,
        content: content.substring(0, 600),
        parentIds: parents,
      };
    });

    const threadTitle = threadProps.title || '';
    const threadDescription = threadProps.description || '';

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
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

    // 1. Fetch all nodes with their children's types
    const read = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node)
       OPTIONAL MATCH (n)-[:PARENT_OF]->(child:Node)
       RETURN n, collect(child.node_type) AS childTypes`,
      { threadId: getNeo4j().int(threadId) }
    );

    const allNodes = read.records.map(r => {
      const p = r.get('n').properties;
      const childTypes: string[] = r.get('childTypes') || [];
      return {
        id: toNum(p.id),
        title: p.title,
        node_type: p.node_type,
        content: p.content,
        childTypes,
      };
    });

    const totalNodes = allNodes.length;
    if (totalNodes === 0) {
      return res.json({ challenges: [], unchallengedCount: 0, totalNodes: 0 });
    }

    // 2. Identify unchallenged nodes: ROOT, EVIDENCE, or CONTEXT with no COUNTERPOINT children
    const challengeableTypes = ['ROOT', 'EVIDENCE', 'CONTEXT'];
    const unchallenged = allNodes.filter(n =>
      challengeableTypes.includes(n.node_type) &&
      !n.childTypes.includes('COUNTERPOINT')
    );

    const unchallengedCount = unchallenged.length;
    if (unchallengedCount === 0) {
      return res.json({ challenges: [], unchallengedCount: 0, totalNodes });
    }

    // 3. Pick up to 3 unchallenged nodes
    const selected = unchallenged.slice(0, 3);

    // 4. For each, call GPT-4o-mini to generate a challenge
    const openai = getOpenAI();
    const challenges = await Promise.all(
      selected.map(async (node) => {
        let nodeContent = String(node.content || '');
        try {
          const p = JSON.parse(nodeContent);
          nodeContent = p.description || p.point || p.explanation || p.argument || nodeContent;
        } catch { /* raw */ }
        nodeContent = nodeContent.replace(/<[^>]+>/g, ' ').substring(0, 600);

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
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
              content: `Challenge this [${node.node_type}] node:\n\nTitle: "${node.title}"\n\nContent: ${nodeContent}`,
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
            nodeType: 'COUNTERPOINT',
          },
          severity: (['high', 'medium', 'low'].includes(parsed.severity) ? parsed.severity : 'medium') as 'high' | 'medium' | 'low',
        };
      })
    );

    // 5. Return proposals
    res.json({ challenges, unchallengedCount, totalNodes });
  })
);

export default router;
