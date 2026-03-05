import { Router } from 'express';
import { getNeo4j, toNum, getSession } from '../db/driver.js';
import { getNextId, formatNode, formatRelationship, formatSource, ENTITY_TYPES, RELATIONSHIP_TYPES } from '../db/queries.js';
import { requireAuth } from '../middleware/auth.js';
import { withSession, withTransaction } from '../middleware/session.js';
import { getOpenAI, generateEmbedding, getEmbeddingText } from '../services/openai.js';
import config from '../config.js';
import type { NodeData, RelationshipData, SourceData, EntityType, RelationType } from '../types/domain.js';

const router = Router();

/** Map legacy uppercase node types to new entity types */
const LEGACY_TYPE_MAP: Record<string, string> = {
  ROOT: 'claim', EVIDENCE: 'evidence', EXAMPLE: 'example',
  COUNTERPOINT: 'counterpoint', REFERENCE: 'source', CONTEXT: 'context',
  SYNTHESIS: 'synthesis', QUESTION: 'question', NOTE: 'note',
};
function normalizeEntityType(raw?: string): EntityType {
  if (!raw) return 'note';
  const mapped = LEGACY_TYPE_MAP[raw] ?? LEGACY_TYPE_MAP[raw.toUpperCase()];
  return (mapped ?? raw.toLowerCase()) as EntityType;
}

// GET /threads/:threadId/nodes - get thread nodes, relationships, and sources
router.get(
  '/threads/:threadId/nodes',
  withSession(async (req, res) => {
    const threadId = parseInt(req.params.threadId);
    const session = req.neo4jSession!;

    // Fetch nodes with INCLUDES metadata
    const nodesResult = await session.run(
      `MATCH (t:Thread {id: $threadId})-[inc:INCLUDES]->(n:Node)
       RETURN n, inc.position AS position, inc.role AS role
       ORDER BY inc.position`,
      { threadId: getNeo4j().int(threadId) }
    );

    const nodes = nodesResult.records.map(r => formatNode(r.get('n').properties));

    // Fetch typed relationships between nodes in this thread
    const relsResult = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:INCLUDES]->(a:Node)
       MATCH (t)-[:INCLUDES]->(b:Node)
       MATCH (a)-[r]->(b)
       WHERE type(r) IN ['SUPPORTS','CONTRADICTS','QUALIFIES','DERIVES_FROM','ILLUSTRATES','CITES','ADDRESSES','REFERENCES']
       RETURN r, type(r) AS relType, a.id AS source_id, b.id AS target_id`,
      { threadId: getNeo4j().int(threadId) }
    );

    const relationships: RelationshipData[] = relsResult.records.map(r =>
      formatRelationship(r.get('r').properties, r.get('relType'), r.get('source_id'), r.get('target_id'))
    );

    // Fetch sources cited by nodes in this thread
    const sourcesResult = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:INCLUDES]->(n:Node)-[:CITES]->(s:Source)
       RETURN DISTINCT s`,
      { threadId: getNeo4j().int(threadId) }
    );

    const sources: SourceData[] = sourcesResult.records.map(r => formatSource(r.get('s').properties));

    res.json({ nodes, relationships, sources });
  })
);

// POST /threads/:threadId/nodes - create node (with transaction)
router.post(
  '/threads/:threadId/nodes',
  requireAuth,
  withTransaction(async (req, res) => {
    const threadId = parseInt(req.params.threadId);
    const {
      title, content,
      entityType, entity_type: entityTypeAlt,
      metadata, position, role,
      connectTo,
    } = req.body;
    const tx = req.neo4jTx!;

    const resolvedEntityType = normalizeEntityType(entityType || entityTypeAlt);
    if (!ENTITY_TYPES.includes(resolvedEntityType)) {
      return res.status(400).json({ error: `Invalid entity_type: ${resolvedEntityType}. Valid types: ${ENTITY_TYPES.join(', ')}` });
    }

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
        entity_type: $entityType, metadata: $metadata,
        created_at: $now, updated_at: $now
      }) RETURN n`,
      { id: getNeo4j().int(id), title, content: content || '', entityType: resolvedEntityType, metadata: metaStr, now }
    );

    // Get current node count for default position
    const countResult = await tx.run(
      `MATCH (t:Thread {id: $threadId})-[:INCLUDES]->(n:Node) RETURN count(n) AS cnt`,
      { threadId: getNeo4j().int(threadId) }
    );
    const currentCount = toNum(countResult.records[0]?.get('cnt')) ?? 0;

    // Link to thread with INCLUDES
    await tx.run(
      `MATCH (t:Thread {id: $threadId}), (n:Node {id: $nodeId})
       CREATE (t)-[:INCLUDES {position: $position, role: $role, added_at: $now}]->(n)`,
      {
        threadId: getNeo4j().int(threadId),
        nodeId: getNeo4j().int(id),
        position: getNeo4j().int(position ?? currentCount),
        role: role || 'supporting',
        now,
      }
    );

    // Create typed relationship if connectTo is provided
    if (connectTo && connectTo.targetId && connectTo.relationType) {
      const relType = connectTo.relationType as RelationType;
      if (!RELATIONSHIP_TYPES.includes(relType)) {
        return res.status(400).json({ error: `Invalid relationType: ${relType}` });
      }
      const relId = await getNextId('relationship', tx);
      const relProps = {
        id: getNeo4j().int(relId),
        created_at: now,
        ...(connectTo.properties || {}),
      };
      await tx.run(
        `MATCH (a:Node {id: $src}), (b:Node {id: $tgt})
         CREATE (a)-[r:${relType} $props]->(b)
         RETURN r`,
        {
          src: getNeo4j().int(id),
          tgt: getNeo4j().int(connectTo.targetId),
          props: relProps,
        }
      );
    }

    const node = formatNode(nodeResult.records[0].get('n').properties);

    // Generate embedding asynchronously (fire-and-forget)
    const embText = getEmbeddingText({ title, content, entity_type: resolvedEntityType }, 'node');
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
          'MATCH (t:Thread {id: $tid})-[:INCLUDES]->(n:Node) RETURN n.title AS title',
          { tid: getNeo4j().int(threadId) }
        );
        existingTitles = existingResult.records.map(r => (r.get('title') || '').toLowerCase().trim());
      } finally {
        await preSession.close();
      }
    } catch { /* ignore -- proceed without dedup */ }

    // Store existingTitles on req so the transaction handler can access them
    req.existingTitles = existingTitles;

    // Delegate to the transaction-wrapped handler
    withTransaction(async (req, res) => {
      const tx = req.neo4jTx!;
      const existingTitles = req.existingTitles!;

      const createdNodes: NodeData[] = [];
      const duplicateSkipped: string[] = [];
      const now = new Date().toISOString();

      // Get current max position
      const posResult = await tx.run(
        `MATCH (t:Thread {id: $tid})-[inc:INCLUDES]->(n:Node) RETURN COALESCE(max(inc.position), -1) AS maxPos`,
        { tid: getNeo4j().int(threadId) }
      );
      let nextPosition = (toNum(posResult.records[0]?.get('maxPos')) ?? -1) + 1;

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

        const entityType = normalizeEntityType(n.entityType || n.entity_type || n.nodeType);

        const nid = await getNextId('node', tx);
        await tx.run(
          `CREATE (nd:Node { id:$id, title:$title, content:$content, entity_type:$type, metadata:$meta, created_at:$now, updated_at:$now })`,
          { id: getNeo4j().int(nid), title: n.title, content, type: entityType, meta: JSON.stringify({ title: n.title }), now }
        );
        await tx.run(
          `MATCH (t:Thread {id:$tid}),(nd:Node {id:$nid}) CREATE (t)-[:INCLUDES {position: $pos, role: $role, added_at: $now}]->(nd)`,
          { tid: getNeo4j().int(threadId), nid: getNeo4j().int(nid), pos: getNeo4j().int(nextPosition), role: n.role || 'supporting', now }
        );
        nextPosition++;

        // Create typed relationship if connectTo is provided
        if (n.connectTo && n.connectTo.targetId && n.connectTo.relationType) {
          const relType = n.connectTo.relationType as RelationType;
          if (RELATIONSHIP_TYPES.includes(relType)) {
            const relId = await getNextId('relationship', tx);
            await tx.run(
              `MATCH (a:Node {id:$src}),(b:Node {id:$tgt}) CREATE (a)-[r:${relType} {id: $relId, created_at: $now}]->(b)`,
              { src: getNeo4j().int(nid), tgt: getNeo4j().int(n.connectTo.targetId), relId: getNeo4j().int(relId), now }
            );
          }
        }

        createdNodes.push(formatNode(
          { id: nid, title: n.title, content, entity_type: entityType, created_at: now, updated_at: now, metadata: '{}' }
        ));
      }

      // Generate embeddings asynchronously for all created nodes
      for (const cn of createdNodes) {
        const embText = getEmbeddingText({ title: cn.title, content: cn.content, entity_type: cn.entity_type }, 'node');
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
    const node = formatNode(nodeProps);

    // Regenerate embedding asynchronously
    const embText = getEmbeddingText({ title, content, entity_type: nodeProps.entity_type }, 'node');
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

    // Check for outgoing typed relationships
    const relResult = await session.run(
      `MATCH (n:Node {id: $nid})-[r]->()
       WHERE type(r) IN ['SUPPORTS','CONTRADICTS','QUALIFIES','DERIVES_FROM','ILLUSTRATES','CITES','ADDRESSES','REFERENCES']
       RETURN count(r) as cnt`,
      { nid: getNeo4j().int(nodeId) }
    );
    const relCount = toNum(relResult.records[0]?.get('cnt')) ?? 0;

    if (relCount > 0 && !force) {
      return res.json({ hasRelationships: true, relationshipCount: relCount });
    }

    await session.run('MATCH (n:Node {id: $nid}) DETACH DELETE n', { nid: getNeo4j().int(nodeId) });
    res.json({ deleted: true });
  })
);

// PATCH /threads/:threadId/nodes/:nodeId/order - update position in INCLUDES relationship
router.patch(
  '/threads/:threadId/nodes/:nodeId/order',
  requireAuth,
  withSession(async (req, res) => {
    const threadId = parseInt(req.params.threadId);
    const nodeId = parseInt(req.params.nodeId);
    const { chronological_order, position } = req.body;
    const session = req.neo4jSession!;

    const newPosition = position ?? chronological_order;
    if (newPosition == null || typeof newPosition !== 'number') {
      return res.status(400).json({ error: 'position (number) is required' });
    }

    // Update position on the INCLUDES relationship
    const result = await session.run(
      `MATCH (t:Thread {id: $tid})-[inc:INCLUDES]->(n:Node {id: $nid})
       SET inc.position = $pos
       RETURN inc`,
      { tid: getNeo4j().int(threadId), nid: getNeo4j().int(nodeId), pos: getNeo4j().int(newPosition) }
    );

    if (!result.records.length) {
      return res.status(404).json({ error: 'Node not found in thread' });
    }

    res.json({ ok: true, position: newPosition });
  })
);

// POST /nodes/suggest - suggest nodes with AI
router.post(
  '/nodes/suggest',
  requireAuth,
  async (req, res) => {
    const { nodeId, entityType, entity_type: entityTypeAlt, content, title } = req.body;

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

Entity types available:
- claim: A central assertion or thesis
- evidence: Specific, verifiable factual data with identifiable sources
- source: A cited reference, URL, paper, or dataset
- context: Background information or framing
- example: Specific illustrative examples
- counterpoint: Opposing views or critiques
- synthesis: Summary or conclusions tying together multiple points
- question: An open question worth exploring
- note: General annotations or observations

For each suggestion, also specify a relationship type to the parent node:
- SUPPORTS: evidence or reasoning that backs the parent
- CONTRADICTS: opposes or undermines the parent
- QUALIFIES: adds nuance or conditions
- DERIVES_FROM: logically follows from the parent
- ILLUSTRATES: provides a concrete example
- CITES: references a source
- ADDRESSES: responds to a question
- REFERENCES: links to related content

Respond with only the JSON array -- no preamble, no explanation.

Format your response as a JSON array of node suggestions:
[
  {
    "type": "entity_type",
    "title": "Node Title",
    "content": "Node Content",
    "relationType": "RELATIONSHIP_TYPE"
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

// POST /threads/:threadId/nodes/:nodeId/enrich -- enrich a node with more detail + generate children
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
    const entityType = nodeProps.entity_type || 'note';

    // Fetch thread context
    let threadTitle = '';
    const threadResult = await tx.run(
      'MATCH (t:Thread {id: $id}) RETURN t.title AS title',
      { id: getNeo4j().int(threadId) }
    );
    if (threadResult.records.length) {
      threadTitle = threadResult.records[0].get('title') || '';
    }

    // Get current max position
    const posResult = await tx.run(
      `MATCH (t:Thread {id: $tid})-[inc:INCLUDES]->(n:Node) RETURN COALESCE(max(inc.position), -1) AS maxPos`,
      { tid: getNeo4j().int(threadId) }
    );
    let nextPosition = (toNum(posResult.records[0]?.get('maxPos')) ?? -1) + 1;

    // Ask AI to enrich
    const response = await getOpenAI().chat.completions.create({
      model: config.openai.chatModel,
      messages: [{
        role: 'system',
        content: `You are a research expert enriching a knowledge graph node.

Given a node from a knowledge thread, do TWO things:
1. Write a richer, more detailed version of the node's content (2-3 paragraphs, include specific facts, dates, names, and sources where possible).
2. Generate 3-5 related nodes that break down this topic into specific sub-points.

For each child node, specify:
- type: one of 'evidence', 'example', 'context', 'counterpoint', 'source', 'claim', 'synthesis', 'question', 'note'
- relationType: one of 'SUPPORTS', 'CONTRADICTS', 'QUALIFIES', 'DERIVES_FROM', 'ILLUSTRATES', 'CITES', 'ADDRESSES', 'REFERENCES'

Return ONLY valid JSON (no markdown fencing):
{
  "enrichedContent": "the enriched content for the parent node (plain text or HTML)",
  "children": [
    { "type": "evidence", "relationType": "SUPPORTS", "title": "short title", "content": "detailed content" }
  ]
}`,
      }, {
        role: 'user',
        content: `Thread: "${threadTitle}"\nEntity type: ${entityType}\nNode title: "${nodeTitle}"\nCurrent content: ${nodeContent}`,
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

    // Create child nodes with typed relationships
    const createdChildren: NodeData[] = [];
    for (const child of parsed.children || []) {
      const childEntityType: EntityType = ENTITY_TYPES.includes(child.type) ? child.type : 'note';
      const childRelType: RelationType = RELATIONSHIP_TYPES.includes(child.relationType) ? child.relationType : 'SUPPORTS';
      if (!child.title || !child.content) continue;

      const childId = await getNextId('node', tx);
      await tx.run(
        `CREATE (n:Node { id:$id, title:$title, content:$content, entity_type:$type, metadata:$meta, created_at:$now, updated_at:$now })`,
        { id: getNeo4j().int(childId), title: child.title, content: child.content, type: childEntityType, meta: JSON.stringify({ title: child.title }), now }
      );
      await tx.run(
        `MATCH (t:Thread {id:$tid}),(n:Node {id:$nid}) CREATE (t)-[:INCLUDES {position: $pos, role: 'supporting', added_at: $now}]->(n)`,
        { tid: getNeo4j().int(threadId), nid: getNeo4j().int(childId), pos: getNeo4j().int(nextPosition), now }
      );
      nextPosition++;

      // Create typed relationship from child to parent node
      const relId = await getNextId('relationship', tx);
      await tx.run(
        `MATCH (a:Node {id:$src}),(b:Node {id:$tgt}) CREATE (a)-[r:${childRelType} {id: $relId, created_at: $now}]->(b)`,
        { src: getNeo4j().int(childId), tgt: getNeo4j().int(nodeId), relId: getNeo4j().int(relId), now }
      );

      createdChildren.push(formatNode(
        { id: childId, title: child.title, content: child.content, entity_type: childEntityType, created_at: now, updated_at: now, metadata: '{}' }
      ));
    }

    // Generate embeddings asynchronously
    for (const cn of createdChildren) {
      const embText = getEmbeddingText({ title: cn.title, content: cn.content, entity_type: cn.entity_type }, 'node');
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
