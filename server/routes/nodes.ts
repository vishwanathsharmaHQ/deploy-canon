import { Router } from 'express';
import { getNeo4j, toNum, getSession } from '../db/driver.js';
import { getNextId, formatNode, NODE_TYPES } from '../db/queries.js';
import { requireAuth } from '../middleware/auth.js';
import { withSession, withTransaction } from '../middleware/session.js';
import { getOpenAI, generateEmbedding, getEmbeddingText } from '../services/openai.js';
import config from '../config.js';
import type { NodeData } from '../types/domain.js';

const router = Router();

// GET /threads/:threadId/nodes - get thread nodes and edges
router.get(
  '/threads/:threadId/nodes',
  withSession(async (req, res) => {
    const threadId = parseInt(req.params.threadId);
    const session = req.neo4jSession!;

    const nodesResult = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node)
       OPTIONAL MATCH (parent:Node)-[:PARENT_OF]->(n)
       RETURN n, parent.id AS parent_id
       ORDER BY n.created_at`,
      { threadId: getNeo4j().int(threadId) }
    );

    const nodes = nodesResult.records.map(r => {
      const props = r.get('n').properties;
      const parentId = r.get('parent_id');
      return formatNode(props, parentId);
    });

    // Build edges from PARENT_OF relationships
    const edgesResult = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(src:Node)-[:PARENT_OF]->(tgt:Node)
       RETURN src.id AS source_id, tgt.id AS target_id`,
      { threadId: getNeo4j().int(threadId) }
    );

    const edges = edgesResult.records.map(r => ({
      source_id: toNum(r.get('source_id')),
      target_id: toNum(r.get('target_id')),
      relationship_type: 'parent-child',
    }));

    res.json({ nodes, edges });
  })
);

// POST /threads/:threadId/nodes - create node (with transaction)
router.post(
  '/threads/:threadId/nodes',
  requireAuth,
  withTransaction(async (req, res) => {
    const threadId = parseInt(req.params.threadId);
    const { title, content, nodeType, parentId, metadata } = req.body;
    const tx = req.neo4jTx!;

    const normalizedNodeType = typeof nodeType === 'number'
      ? NODE_TYPES[nodeType]
      : nodeType;

    const id = await getNextId('node', tx);
    const now = new Date().toISOString();
    const metaStr = JSON.stringify({
      title,
      description: content ? String(content).substring(0, 100) : '',
      ...metadata,
    });

    // Create node
    const nodeResult = await tx.run(
      `CREATE (n:Node {
        id: $id, title: $title, content: $content,
        node_type: $nodeType, metadata: $metadata,
        created_at: $now, updated_at: $now
      }) RETURN n`,
      { id: getNeo4j().int(id), title, content: content || '', nodeType: normalizedNodeType, metadata: metaStr, now }
    );

    // Link to thread
    await tx.run(
      `MATCH (t:Thread {id: $threadId}), (n:Node {id: $nodeId})
       CREATE (t)-[:HAS_NODE]->(n)`,
      { threadId: getNeo4j().int(threadId), nodeId: getNeo4j().int(id) }
    );

    // Link to parent if provided
    let resolvedParentId = null;
    if (parentId) {
      await tx.run(
        `MATCH (p:Node {id: $parentId}), (n:Node {id: $nodeId})
         CREATE (p)-[:PARENT_OF]->(n)`,
        { parentId: getNeo4j().int(parentId), nodeId: getNeo4j().int(id) }
      );
      resolvedParentId = parentId;
    }

    // withTransaction auto-commits on success
    const node = formatNode(nodeResult.records[0].get('n').properties, resolvedParentId);

    // Generate embedding asynchronously (fire-and-forget)
    const embText = getEmbeddingText({ title, content, node_type: normalizedNodeType }, 'node');
    if (embText.trim()) {
      generateEmbedding(embText).then(embedding => {
        if (embedding) {
          const s = getSession();
          s.run('MATCH (n:Node {id: $id}) SET n.embedding = $embedding, n.embedding_text = $text',
            { id: getNeo4j().int(id), embedding, text: embText })
            .finally(() => s.close());
        }
      }).catch(e => console.warn('Node embedding failed:', e.message));
    }

    res.json(node);
  })
);

// POST /threads/:threadId/nodes/batch - batch create nodes (with transaction)
router.post(
  '/threads/:threadId/nodes/batch',
  requireAuth,
  async (req, res, next) => {
    const threadId = parseInt(req.params.threadId);
    const { nodes } = req.body;
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return res.status(400).json({ error: 'nodes array required' });
    }

    // Fetch existing node titles for duplicate detection BEFORE starting tx
    let existingTitles: string[] = [];
    try {
      const preSession = getSession();
      try {
        const existingResult = await preSession.run(
          'MATCH (t:Thread {id: $tid})-[:HAS_NODE]->(n:Node) RETURN n.title AS title',
          { tid: getNeo4j().int(threadId) }
        );
        existingTitles = existingResult.records.map(r => (r.get('title') || '').toLowerCase().trim());
      } finally {
        await preSession.close();
      }
    } catch { /* ignore — proceed without dedup */ }

    // Store existingTitles on req so the transaction handler can access them
    req.existingTitles = existingTitles;

    // Delegate to the transaction-wrapped handler
    withTransaction(async (req, res) => {
      const tx = req.neo4jTx!;
      const existingTitles = req.existingTitles!;

      const createdNodes: NodeData[] = [];
      const duplicateSkipped: string[] = [];
      const now = new Date().toISOString();

      for (const n of nodes) {
        // Duplicate detection: skip if title matches or is substring of existing
        const candidateTitle = (n.title || '').toLowerCase().trim();
        if (candidateTitle && existingTitles.some(et => et === candidateTitle || et.includes(candidateTitle) || candidateTitle.includes(et))) {
          duplicateSkipped.push(n.title);
          continue;
        }
        existingTitles.push(candidateTitle); // prevent intra-batch duplicates too

        // Sanitize EVIDENCE source URLs
        let content = n.content || '';
        if (typeof content === 'string' && content.startsWith('{')) {
          try {
            const parsed = JSON.parse(content);
            if (parsed.source && typeof parsed.source === 'string') {
              parsed.source = parsed.source.trim().replace(/[)\]}>]+$/, '');
            }
            content = JSON.stringify(parsed);
          } catch { /* keep as-is */ }
        }

        const nodeType = typeof n.nodeType === 'number'
          ? NODE_TYPES[n.nodeType]
          : n.nodeType;

        const nid = await getNextId('node', tx);
        await tx.run(
          `CREATE (nd:Node { id:$id, title:$title, content:$content, node_type:$type, metadata:$meta, created_at:$now, updated_at:$now })`,
          { id: getNeo4j().int(nid), title: n.title, content, type: nodeType, meta: JSON.stringify({ title: n.title }), now }
        );
        await tx.run(
          `MATCH (t:Thread {id:$tid}),(nd:Node {id:$nid}) CREATE (t)-[:HAS_NODE]->(nd)`,
          { tid: getNeo4j().int(threadId), nid: getNeo4j().int(nid) }
        );
        if (n.parentId) {
          await tx.run(
            `MATCH (p:Node {id:$pid}),(nd:Node {id:$nid}) CREATE (p)-[:PARENT_OF]->(nd)`,
            { pid: getNeo4j().int(n.parentId), nid: getNeo4j().int(nid) }
          );
        }
        createdNodes.push(formatNode(
          { id: nid, title: n.title, content, node_type: nodeType, created_at: now, updated_at: now, metadata: '{}' },
          n.parentId || null
        ));
      }

      // withTransaction auto-commits on success

      // Generate embeddings asynchronously for all created nodes
      for (const cn of createdNodes) {
        const embText = getEmbeddingText({ title: cn.title, content: cn.content, node_type: cn.node_type }, 'node');
        if (embText.trim()) {
          generateEmbedding(embText).then(embedding => {
            if (embedding) {
              const s = getSession();
              s.run('MATCH (n:Node {id: $id}) SET n.embedding = $embedding, n.embedding_text = $text',
                { id: getNeo4j().int(cn.id!), embedding, text: embText })
                .finally(() => s.close());
            }
          }).catch(e => console.warn('Batch node embedding failed:', e.message));
        }
      }

      res.json({ createdNodes, duplicateSkipped });
    })(req, res, next);
  }
);

// PUT /threads/:threadId/nodes/:nodeId - update node
router.put(
  '/threads/:threadId/nodes/:nodeId',
  requireAuth,
  withSession(async (req, res) => {
    const nodeId = parseInt(req.params.nodeId);
    const { title, content } = req.body;
    const session = req.neo4jSession!;

    const now = new Date().toISOString();
    const metaStr = JSON.stringify({
      title,
      description: content ? String(content).substring(0, 100) : '',
    });

    const result = await session.run(
      `MATCH (n:Node {id: $nodeId})
       SET n.title = $title, n.content = $content, n.metadata = $metadata, n.updated_at = $now
       RETURN n`,
      { nodeId: getNeo4j().int(nodeId), title, content: content || '', metadata: metaStr, now }
    );

    if (!result.records.length) return res.status(404).json({ error: 'Node not found' });

    const nodeProps = result.records[0].get('n').properties;
    const node = formatNode(nodeProps, null);

    // Regenerate embedding asynchronously
    const embText = getEmbeddingText({ title, content, node_type: nodeProps.node_type }, 'node');
    if (embText.trim()) {
      generateEmbedding(embText).then(embedding => {
        if (embedding) {
          const s = getSession();
          s.run('MATCH (n:Node {id: $id}) SET n.embedding = $embedding, n.embedding_text = $text',
            { id: getNeo4j().int(nodeId), embedding, text: embText })
            .finally(() => s.close());
        }
      }).catch(e => console.warn('Node re-embedding failed:', e.message));
    }

    res.json(node);
  })
);

// DELETE /threads/:threadId/nodes/:nodeId - delete node
router.delete(
  '/threads/:threadId/nodes/:nodeId',
  requireAuth,
  withSession(async (req, res) => {
    const nodeId = parseInt(req.params.nodeId);
    const force = req.query.force === 'true';
    const session = req.neo4jSession!;

    // Check for children
    const childResult = await session.run(
      'MATCH (n:Node {id: $nid})-[:PARENT_OF]->(c) RETURN count(c) as cnt',
      { nid: getNeo4j().int(nodeId) }
    );
    const childCount = childResult.records[0]?.get('cnt')?.toNumber?.() ?? childResult.records[0]?.get('cnt') ?? 0;

    if (childCount > 0 && !force) {
      return res.json({ hasChildren: true, childCount });
    }

    await session.run('MATCH (n:Node {id: $nid}) DETACH DELETE n', { nid: getNeo4j().int(nodeId) });
    res.json({ deleted: true });
  })
);

// POST /nodes/suggest - suggest nodes with AI
router.post(
  '/nodes/suggest',
  requireAuth,
  async (req, res) => {
    const { nodeId, nodeType, content, title } = req.body;

    try {
      let nodeContent: unknown = content;
      if (typeof content === 'string' && (content.startsWith('{') || content.startsWith('['))) {
        try {
          nodeContent = JSON.parse(content);
        } catch (e) {
          console.log('Failed to parse content as JSON:', e);
        }
      }

      let contentForGPT = '';
      if (typeof nodeContent === 'object' && nodeContent !== null) {
        const obj = nodeContent as Record<string, string>;
        if (obj.content) {
          contentForGPT = obj.content;
        } else if (obj.explanation) {
          contentForGPT = `${obj.argument}\n${obj.explanation}`;
        } else if (obj.point) {
          contentForGPT = `${obj.point}\nSource: ${obj.source}`;
        } else if (obj.description) {
          contentForGPT = `${obj.title}\n${obj.description}`;
        }
      } else {
        contentForGPT = String(nodeContent);
      }

      const response = await getOpenAI().chat.completions.create({
        model: config.openai.chatModel,
        messages: [{
          role: 'system',
          content: `You are an expert at analyzing content and suggesting relevant nodes for a knowledge graph.
For the given content, suggest 3-4 relevant nodes that would enrich the discussion.
Each node should have:
1. A type (one of: EVIDENCE, REFERENCE, CONTEXT, EXAMPLE, COUNTERPOINT, SYNTHESIS)
2. A title (concise but descriptive)
3. Content that follows the format for that node type:
   - EVIDENCE: point and source
   - EXAMPLE: title and description
   - COUNTERPOINT: argument and explanation
   - Others: regular text content

Respond with only the JSON array — no preamble, no explanation.

Format your response as a JSON array of node suggestions:
[
  {
    "type": "NODE_TYPE",
    "title": "Node Title",
    "content": "Node Content (formatted based on type)"
  }
]`,
        }, {
          role: 'user',
          content: `Generate relevant nodes for this content:\nTitle: ${title}\nContent: ${contentForGPT}`,
        }],
        temperature: 0.7,
      });

      const suggestions = JSON.parse(response.choices[0].message.content!);
      res.json({ suggestions });
    } catch (err: unknown) {
      console.error('Error generating suggestions:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

export default router;
