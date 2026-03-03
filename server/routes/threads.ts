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
    const { topic } = req.body;
    if (!topic) {
      return res.status(400).json({ error: 'Topic is required' });
    }

    const threadResponse = await getOpenAI().chat.completions.create({
      model: config.openai.chatModel,
      messages: [
        {
          role: 'system',
          content: `Create a brief knowledge thread about the given topic with:
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
}`,
        },
        {
          role: 'user',
          content: `Create a knowledge thread about: ${topic}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    const gptContent = JSON.parse(threadResponse.choices[0].message.content!);

    // Create thread
    const threadId = await getNextId('thread', tx);
    const now = new Date().toISOString();
    const threadMetaStr = JSON.stringify({
      title: topic,
      description: gptContent.summary.substring(0, 255),
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
        description: gptContent.summary.substring(0, 255),
        content: gptContent.summary,
        metadata: threadMetaStr,
        now,
      }
    );

    // Create nodes: SYNTHESIS, EVIDENCE, EXAMPLE, COUNTERPOINT, SYNTHESIS
    const nodeEntries = [
      { title: 'Summary', content: gptContent.summary, type: 'SYNTHESIS' },
      { title: gptContent.evidence.source, content: JSON.stringify(gptContent.evidence), type: 'EVIDENCE' },
      { title: gptContent.example.title, content: JSON.stringify(gptContent.example), type: 'EXAMPLE' },
      { title: gptContent.counterpoint.argument, content: JSON.stringify(gptContent.counterpoint), type: 'COUNTERPOINT' },
      { title: 'Synthesis', content: gptContent.synthesis, type: 'SYNTHESIS' },
    ];

    for (const entry of nodeEntries) {
      const nodeId = await getNextId('node', tx);
      const nodeMeta = JSON.stringify({ title: entry.title });
      await tx.run(
        `CREATE (n:Node {
          id: $id, title: $title, content: $content,
          node_type: $nodeType, metadata: $metadata,
          created_at: $now, updated_at: $now
        })
        WITH n
        MATCH (t:Thread {id: $threadId})
        CREATE (t)-[:HAS_NODE]->(n)`,
        {
          id: getNeo4j().int(nodeId),
          title: entry.title,
          content: entry.content,
          nodeType: entry.type,
          metadata: nodeMeta,
          now,
          threadId: getNeo4j().int(threadId),
        }
      );
    }

    const thread = formatThread(threadResult.records[0].get('t').properties);
    res.json(thread);
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

export default router;
