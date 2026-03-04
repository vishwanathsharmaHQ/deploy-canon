import { Router } from 'express';
import { getNeo4j, toNum, getSession } from '../db/driver.js';
import { getNextId, formatNode, NODE_TYPES } from '../db/queries.js';
import { requireAuth } from '../middleware/auth.js';
import { withSession, withTransaction } from '../middleware/session.js';
import { getOpenAI, generateEmbedding, getEmbeddingText } from '../services/openai.js';
import config from '../config.js';
import type { NodeData } from '../types/domain.js';

const LEAF_NODE_TYPES = ['EVIDENCE', 'REFERENCE', 'EXAMPLE', 'COUNTERPOINT'];

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

    // Enforce leaf constraint: leaf nodes cannot have children
    if (parentId) {
      const parentResult = await tx.run(
        'MATCH (n:Node {id: $id}) RETURN n.node_type AS nodeType',
        { id: getNeo4j().int(parentId) }
      );
      if (parentResult.records.length) {
        const parentType = parentResult.records[0].get('nodeType');
        if (LEAF_NODE_TYPES.includes(parentType)) {
          return res.status(400).json({
            error: `Cannot add children to a ${parentType} node. Only ROOT, CONTEXT, and SYNTHESIS nodes can have children.`
          });
        }
      }
    }

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

      // Enforce leaf constraint for batch: check parent type once if parentId provided
      if (nodes.length > 0 && nodes[0].parentId) {
        const parentCheck = await tx.run(
          'MATCH (n:Node {id: $id}) RETURN n.node_type AS nodeType',
          { id: getNeo4j().int(nodes[0].parentId) }
        );
        if (parentCheck.records.length) {
          const parentType = parentCheck.records[0].get('nodeType');
          if (LEAF_NODE_TYPES.includes(parentType)) {
            return res.status(400).json({
              error: `Cannot add children to a ${parentType} node. Only ROOT, CONTEXT, and SYNTHESIS nodes can have children.`
            });
          }
        }
      }

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

// PATCH /threads/:threadId/nodes/:nodeId/parent - reparent a node
router.patch(
  '/threads/:threadId/nodes/:nodeId/parent',
  requireAuth,
  withTransaction(async (req, res) => {
    const threadId = parseInt(req.params.threadId);
    const nodeId = parseInt(req.params.nodeId);
    const { newParentId } = req.body; // number | null
    const tx = req.neo4jTx!;

    // Validate node exists in this thread
    const nodeCheck = await tx.run(
      `MATCH (t:Thread {id: $tid})-[:HAS_NODE]->(n:Node {id: $nid})
       RETURN n.node_type AS nodeType`,
      { tid: getNeo4j().int(threadId), nid: getNeo4j().int(nodeId) }
    );
    if (!nodeCheck.records.length) {
      return res.status(404).json({ error: 'Node not found in this thread' });
    }

    if (newParentId != null) {
      // Validate parent exists in this thread
      const parentCheck = await tx.run(
        `MATCH (t:Thread {id: $tid})-[:HAS_NODE]->(p:Node {id: $pid})
         RETURN p.node_type AS nodeType`,
        { tid: getNeo4j().int(threadId), pid: getNeo4j().int(newParentId) }
      );
      if (!parentCheck.records.length) {
        return res.status(404).json({ error: 'Parent node not found in this thread' });
      }

      // Enforce leaf constraint on new parent
      const parentType = parentCheck.records[0].get('nodeType');
      if (LEAF_NODE_TYPES.includes(parentType)) {
        return res.status(400).json({
          error: `Cannot reparent under a ${parentType} node. Only ROOT, CONTEXT, and SYNTHESIS nodes can have children.`
        });
      }

      // Check circular reference: newParentId must not be a descendant of nodeId
      const circularCheck = await tx.run(
        `MATCH path = (n:Node {id: $nid})-[:PARENT_OF*]->(d:Node {id: $pid})
         RETURN count(path) AS cnt`,
        { nid: getNeo4j().int(nodeId), pid: getNeo4j().int(newParentId) }
      );
      const cnt = circularCheck.records[0]?.get('cnt');
      const circCount = typeof cnt?.toNumber === 'function' ? cnt.toNumber() : (cnt ?? 0);
      if (circCount > 0) {
        return res.status(400).json({ error: 'Cannot reparent: would create a circular reference' });
      }
    }

    // Delete existing PARENT_OF relationship pointing to this node
    await tx.run(
      `MATCH (parent:Node)-[r:PARENT_OF]->(n:Node {id: $nid})
       DELETE r`,
      { nid: getNeo4j().int(nodeId) }
    );

    if (newParentId != null) {
      // Create new PARENT_OF relationship
      await tx.run(
        `MATCH (p:Node {id: $pid}), (n:Node {id: $nid})
         CREATE (p)-[:PARENT_OF]->(n)`,
        { pid: getNeo4j().int(newParentId), nid: getNeo4j().int(nodeId) }
      );
    } else {
      // Detaching to ROOT — update node_type
      await tx.run(
        `MATCH (n:Node {id: $nid})
         SET n.node_type = 'ROOT', n.updated_at = $now`,
        { nid: getNeo4j().int(nodeId), now: new Date().toISOString() }
      );
    }

    res.json({ ok: true, newParentId: newParentId ?? null });
  })
);

// PATCH /threads/:threadId/nodes/:nodeId/order - update chronological_order
router.patch(
  '/threads/:threadId/nodes/:nodeId/order',
  requireAuth,
  withSession(async (req, res) => {
    const nodeId = parseInt(req.params.nodeId);
    const { chronological_order } = req.body;
    const session = req.neo4jSession!;

    if (chronological_order == null || typeof chronological_order !== 'number') {
      return res.status(400).json({ error: 'chronological_order (number) is required' });
    }

    // Fetch current metadata, merge chronological_order, save back
    const result = await session.run(
      'MATCH (n:Node {id: $nid}) RETURN n.metadata AS meta',
      { nid: getNeo4j().int(nodeId) }
    );
    if (!result.records.length) {
      return res.status(404).json({ error: 'Node not found' });
    }

    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(result.records[0].get('meta') || '{}');
    } catch { /* ignore */ }

    meta.chronological_order = chronological_order;

    await session.run(
      `MATCH (n:Node {id: $nid})
       SET n.metadata = $meta, n.updated_at = $now`,
      { nid: getNeo4j().int(nodeId), meta: JSON.stringify(meta), now: new Date().toISOString() }
    );

    res.json({ ok: true, chronological_order });
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

Node types fall into two categories:

EXPANDABLE types (can have children — use for broad topics):
- ROOT: Broad topics or claims that deserve sub-exploration with their own child nodes.
- CONTEXT: Background information that could have supporting details.
- SYNTHESIS: Summary or conclusions tying together multiple points.

LEAF types (terminal knowledge — no children):
- EVIDENCE: ONLY for specific, verifiable factual claims with identifiable sources. Content format: point and source.
- REFERENCE: Cited sources, URLs, papers. Content format: source details.
- EXAMPLE: Specific illustrative examples. Content format: title and description.
- COUNTERPOINT: Opposing views or critiques. Content format: argument and explanation.

KEY: If a suggestion describes a broad sub-topic with potential sub-points, use ROOT — not EVIDENCE. EVIDENCE is strictly for specific facts with concrete sources.

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

// POST /threads/:threadId/nodes/:nodeId/enrich — enrich a ROOT node with more detail + generate children
router.post(
  '/threads/:threadId/nodes/:nodeId/enrich',
  requireAuth,
  withTransaction(async (req, res) => {
    const threadId = parseInt(req.params.threadId);
    const nodeId = parseInt(req.params.nodeId);
    const tx = req.neo4jTx!;

    // Fetch the node
    const nodeResult = await tx.run(
      'MATCH (n:Node {id: $id}) RETURN n',
      { id: getNeo4j().int(nodeId) }
    );
    if (!nodeResult.records.length) {
      return res.status(404).json({ error: 'Node not found' });
    }
    const nodeProps = nodeResult.records[0].get('n').properties;
    const nodeTitle = nodeProps.title;
    const nodeContent = nodeProps.content || '';
    const nodeType = nodeProps.node_type;

    // Fetch thread context
    let threadTitle = '';
    const threadResult = await tx.run(
      'MATCH (t:Thread {id: $id}) RETURN t.title AS title',
      { id: getNeo4j().int(threadId) }
    );
    if (threadResult.records.length) {
      threadTitle = threadResult.records[0].get('title') || '';
    }

    // Ask AI to enrich
    const response = await getOpenAI().chat.completions.create({
      model: config.openai.chatModel,
      messages: [{
        role: 'system',
        content: `You are a research expert enriching a knowledge graph node.

Given a node from a knowledge thread, do TWO things:
1. Write a richer, more detailed version of the node's content (2-3 paragraphs, include specific facts, dates, names, and sources where possible).
2. Generate 3-5 child nodes that break down this topic into specific sub-points.

Child node types (LEAF types only — they won't have their own children):
- EVIDENCE: Specific verifiable facts with sources
- EXAMPLE: Concrete illustrative examples
- CONTEXT: Background information
- COUNTERPOINT: Opposing views or nuances
- REFERENCE: Key sources or citations

Return ONLY valid JSON (no markdown fencing):
{
  "enrichedContent": "the enriched content for the parent node (plain text or HTML)",
  "children": [
    { "type": "EVIDENCE|EXAMPLE|CONTEXT|COUNTERPOINT|REFERENCE", "title": "short title", "content": "detailed content" }
  ]
}`,
      }, {
        role: 'user',
        content: `Thread: "${threadTitle}"\nNode type: ${nodeType}\nNode title: "${nodeTitle}"\nCurrent content: ${nodeContent}`,
      }],
      temperature: 0.7,
    });

    const raw = response.choices[0].message.content || '{}';
    const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
    const parsed = JSON.parse(cleaned);

    // Update the node's content with enriched version
    const now = new Date().toISOString();
    if (parsed.enrichedContent) {
      await tx.run(
        `MATCH (n:Node {id: $id})
         SET n.content = $content, n.updated_at = $now,
             n.metadata = $meta`,
        {
          id: getNeo4j().int(nodeId),
          content: parsed.enrichedContent,
          now,
          meta: JSON.stringify({ title: nodeTitle, description: String(parsed.enrichedContent).substring(0, 100) }),
        }
      );
    }

    // Create child nodes
    const createdChildren: NodeData[] = [];
    for (const child of parsed.children || []) {
      if (!child.title || !child.content || !NODE_TYPES.includes(child.type)) continue;
      const childId = await getNextId('node', tx);
      await tx.run(
        `CREATE (n:Node { id:$id, title:$title, content:$content, node_type:$type, metadata:$meta, created_at:$now, updated_at:$now })`,
        { id: getNeo4j().int(childId), title: child.title, content: child.content, type: child.type, meta: JSON.stringify({ title: child.title }), now }
      );
      await tx.run(
        `MATCH (t:Thread {id:$tid}),(n:Node {id:$nid}) CREATE (t)-[:HAS_NODE]->(n)`,
        { tid: getNeo4j().int(threadId), nid: getNeo4j().int(childId) }
      );
      await tx.run(
        `MATCH (p:Node {id:$pid}),(n:Node {id:$nid}) CREATE (p)-[:PARENT_OF]->(n)`,
        { pid: getNeo4j().int(nodeId), nid: getNeo4j().int(childId) }
      );
      createdChildren.push(formatNode(
        { id: childId, title: child.title, content: child.content, node_type: child.type, created_at: now, updated_at: now, metadata: '{}' },
        nodeId
      ));
    }

    // Generate embeddings asynchronously
    for (const cn of createdChildren) {
      const embText = getEmbeddingText({ title: cn.title, content: cn.content, node_type: cn.node_type }, 'node');
      if (embText.trim()) {
        generateEmbedding(embText).then(embedding => {
          if (embedding) {
            const s = getSession();
            s.run('MATCH (n:Node {id: $id}) SET n.embedding = $embedding, n.embedding_text = $text',
              { id: getNeo4j().int(cn.id!), embedding, text: embText })
              .finally(() => s.close());
          }
        }).catch(e => console.warn('Enrich node embedding failed:', e.message));
      }
    }

    res.json({
      enrichedContent: parsed.enrichedContent || nodeContent,
      children: createdChildren,
    });
  })
);

export default router;
