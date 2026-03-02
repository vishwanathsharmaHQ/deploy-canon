require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'changeme-in-production';

const app = express();
const port = process.env.PORT || 3001;

// ── Lazy-initialise heavy deps so startup errors are visible in responses ──
let _neo4j, _driver, _openai, _initError;

function getDriver() {
  if (_initError) throw _initError;
  if (_driver) return _driver;
  try {
    _neo4j = require('neo4j-driver');
    _driver = _neo4j.driver(
      process.env.NEO4J_URI,
      _neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
    );
    return _driver;
  } catch (e) {
    _initError = e;
    throw e;
  }
}

function getNeo4j() {
  getDriver(); // ensures _neo4j is set
  return _neo4j;
}

function getOpenAI() {
  if (_openai) return _openai;
  const OpenAI = require('openai');
  _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 50000 });
  return _openai;
}

// Timeout middleware for AI operations
const aiTimeout = (req, res, next) => {
  res.setTimeout(50000, () => {
    res.status(504).send('Request timeout');
  });
  next();
};

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Apply timeout middleware to AI routes
app.use(['/api/nodes/suggest', '/api/threads/generate', '/api/chat', '/api/chat/extract'], aiTimeout);

// Serve static files from the ./dist directory
const staticDir = path.join(__dirname, 'dist');
app.use(express.static(staticDir));

// Catch init errors on first API call so we see the real message
app.use('/api', (req, res, next) => {
  try { getDriver(); } catch (e) {
    return res.status(500).json({ initError: e.message });
  }
  next();
});

// Helper: get next sequential ID (accepts session or transaction)
async function getNextId(label, runner) {
  const result = await runner.run(
    `MERGE (c:Counter {name: $label})
     ON CREATE SET c.seq = 1
     ON MATCH SET c.seq = c.seq + 1
     RETURN c.seq AS id`,
    { label }
  );
  return result.records[0].get('id').toNumber();
}

// Helper: convert Neo4j integer to JS number
function toNum(val) {
  if (val == null) return null;
  if (getNeo4j().isInt(val)) return val.toNumber();
  return val;
}

// ── Vector query helper (graceful fallback when indexes don't exist) ──────────
async function vectorQuery(session, indexName, k, embedding) {
  try {
    return await session.run(
      `CALL db.index.vector.queryNodes($indexName, $k, $embedding) YIELD node, score RETURN node, score ORDER BY score DESC`,
      { indexName, k: getNeo4j().int(k), embedding }
    );
  } catch (err) {
    if (err.message && (
      err.message.includes('no such vector schema index') ||
      err.message.includes('There is no such index') ||
      err.message.includes('IndexNotFoundError')
    ) || err.code === 'Neo.ClientError.Procedure.ProcedureCallFailed') {
      return { records: [] };
    }
    throw err;
  }
}

// ── Auto-setup: ensure vector indexes exist on startup ────────────────────────
let _indexesEnsured = false;
async function ensureVectorIndexes() {
  if (_indexesEnsured) return;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run(`
      CREATE VECTOR INDEX thread_embedding IF NOT EXISTS
      FOR (t:Thread) ON (t.embedding)
      OPTIONS {indexConfig: {
        \`vector.dimensions\`: 1536,
        \`vector.similarity_function\`: 'cosine'
      }}
    `);
    await session.run(`
      CREATE VECTOR INDEX node_embedding IF NOT EXISTS
      FOR (n:Node) ON (n.embedding)
      OPTIONS {indexConfig: {
        \`vector.dimensions\`: 1536,
        \`vector.similarity_function\`: 'cosine'
      }}
    `);
    _indexesEnsured = true;
    console.log('Vector indexes ensured.');
  } catch (err) {
    console.warn('Vector index auto-setup failed (non-fatal):', err.message);
  } finally {
    await session.close();
  }
}

// Backfill embeddings for any nodes/threads missing them (runs in background, non-blocking)
async function backfillEmbeddings() {
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const threadResult = await session.run(
      `MATCH (t:Thread) WHERE t.embedding IS NULL RETURN t LIMIT 20`
    );
    for (const record of threadResult.records) {
      const props = record.get('t').properties;
      const text = getEmbeddingText({ title: props.title, description: props.description, content: props.content }, 'thread');
      if (!text.trim()) continue;
      try {
        const embedding = await generateEmbedding(text);
        if (embedding) {
          await session.run(
            `MATCH (t:Thread {id: $id}) SET t.embedding = $embedding, t.embedding_text = $text`,
            { id: props.id, embedding, text }
          );
        }
      } catch (e) { /* skip */ }
    }
    const nodeResult = await session.run(
      `MATCH (n:Node) WHERE n.embedding IS NULL RETURN n LIMIT 50`
    );
    for (const record of nodeResult.records) {
      const props = record.get('n').properties;
      const text = getEmbeddingText({ title: props.title, content: props.content, node_type: props.node_type }, 'node');
      if (!text.trim()) continue;
      try {
        const embedding = await generateEmbedding(text);
        if (embedding) {
          await session.run(
            `MATCH (n:Node {id: $id}) SET n.embedding = $embedding, n.embedding_text = $text`,
            { id: props.id, embedding, text }
          );
        }
      } catch (e) { /* skip */ }
    }
  } catch (err) {
    console.warn('Embedding backfill failed (non-fatal):', err.message);
  } finally {
    await session.close();
  }
}

// ── Embedding helpers ──────────────────────────────────────────────────────────
async function generateEmbedding(text) {
  if (!text || !text.trim()) return null;
  const openai = getOpenAI();
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.substring(0, 8000),
  });
  return response.data[0].embedding;
}

function getEmbeddingText(entity, type) {
  if (type === 'thread') {
    return [entity.title, entity.description, entity.content].filter(Boolean).join('\n').substring(0, 8000);
  }
  // type === 'node'
  let contentText = entity.content || '';
  if (typeof contentText === 'string' && (contentText.startsWith('{') || contentText.startsWith('['))) {
    try {
      const parsed = JSON.parse(contentText);
      contentText = parsed.description || parsed.point || parsed.explanation || parsed.argument || parsed.content || contentText;
    } catch (e) { /* keep raw */ }
  }
  contentText = String(contentText).replace(/<[^>]+>/g, ' ');
  return [entity.title, `[${entity.node_type || ''}]`, contentText].filter(Boolean).join('\n').substring(0, 8000);
}

// Helper: format thread record for API response
function formatThread(props) {
  return {
    id: toNum(props.id),
    title: props.title,
    description: props.description,
    content: props.content,
    metadata: {
      title: props.title,
      description: props.description,
      ...(props.metadata ? JSON.parse(props.metadata) : {})
    },
    created_at: props.created_at,
    updated_at: props.updated_at,
    nodes: []
  };
}

// Helper: format node record for API response
function formatNode(props, parentId) {
  return {
    id: toNum(props.id),
    title: props.title,
    content: props.content,
    node_type: props.node_type,
    parent_id: toNum(parentId),
    metadata: {
      title: props.title,
      description: props.content ? String(props.content).substring(0, 100) : '',
      ...(props.metadata ? JSON.parse(props.metadata) : {})
    },
    created_at: props.created_at,
    updated_at: props.updated_at,
    type: ['ROOT', 'EVIDENCE', 'REFERENCE', 'CONTEXT', 'EXAMPLE', 'COUNTERPOINT', 'SYNTHESIS'].indexOf(props.node_type)
  };
}

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const existing = await session.run('MATCH (u:User {email: $email}) RETURN u', { email });
    if (existing.records.length > 0) return res.status(409).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    const id = await getNextId('user', session);
    const now = new Date().toISOString();
    await session.run(
      'CREATE (u:User {id: $id, name: $name, email: $email, password: $hash, created_at: $now})',
      { id: getNeo4j().int(id), name: name || '', email, hash, now }
    );
    const token = jwt.sign({ id, email, name: name || '' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id, email, name: name || '' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run('MATCH (u:User {email: $email}) RETURN u', { email });
    if (!result.records.length) return res.status(401).json({ error: 'Invalid credentials' });
    const u = result.records[0].get('u').properties;
    const valid = await bcrypt.compare(password, u.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const id = toNum(u.id);
    const token = jwt.sign({ id, email: u.email, name: u.name || '' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id, email: u.email, name: u.name || '' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Thread endpoints
app.get('/api/threads', async (req, res) => {
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      'MATCH (t:Thread) RETURN t ORDER BY t.created_at DESC'
    );
    const threads = result.records.map(r => formatThread(r.get('t').properties));
    res.json(threads);
  } catch (err) {
    console.error('Error fetching threads:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.post('/api/threads', requireAuth, async (req, res) => {
  const { title, description, content, metadata } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const id = await getNextId('thread', session);
    const now = new Date().toISOString();
    const metaStr = JSON.stringify({ title, description, content, ...metadata });

    const result = await session.run(
      `CREATE (t:Thread {
        id: $id, title: $title, description: $description,
        content: $content, metadata: $metadata,
        created_at: $now, updated_at: $now
      }) RETURN t`,
      { id: getNeo4j().int(id), title, description: description || '', content: content || '', metadata: metaStr, now }
    );

    const thread = formatThread(result.records[0].get('t').properties);

    // Generate embedding asynchronously (don't block response)
    const embText = getEmbeddingText({ title, description, content }, 'thread');
    if (embText.trim()) {
      generateEmbedding(embText).then(embedding => {
        if (embedding) {
          const s = getDriver().session({ database: process.env.NEO4J_DATABASE });
          s.run('MATCH (t:Thread {id: $id}) SET t.embedding = $embedding, t.embedding_text = $text', { id: getNeo4j().int(id), embedding, text: embText })
            .finally(() => s.close());
        }
      }).catch(e => console.warn('Thread embedding failed:', e.message));
    }

    res.json(thread);
  } catch (err) {
    console.error('Error creating thread:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Node endpoints
app.get('/api/threads/:threadId/nodes', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
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
      relationship_type: 'parent-child'
    }));

    res.json({ nodes, edges });
  } catch (err) {
    console.error('Error fetching nodes:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.post('/api/threads/:threadId/nodes', requireAuth, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { title, content, nodeType, parentId, metadata } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  const tx = session.beginTransaction();

  try {
    const normalizedNodeType = typeof nodeType === 'number'
      ? ['ROOT', 'EVIDENCE', 'REFERENCE', 'CONTEXT', 'EXAMPLE', 'COUNTERPOINT', 'SYNTHESIS'][nodeType]
      : nodeType;

    const id = await getNextId('node', tx);
    const now = new Date().toISOString();
    const metaStr = JSON.stringify({
      title,
      description: content ? String(content).substring(0, 100) : '',
      ...metadata
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

    await tx.commit();

    const node = formatNode(nodeResult.records[0].get('n').properties, resolvedParentId);

    // Generate embedding asynchronously
    const embText = getEmbeddingText({ title, content, node_type: normalizedNodeType }, 'node');
    if (embText.trim()) {
      generateEmbedding(embText).then(embedding => {
        if (embedding) {
          const s = getDriver().session({ database: process.env.NEO4J_DATABASE });
          s.run('MATCH (n:Node {id: $id}) SET n.embedding = $embedding, n.embedding_text = $text', { id: getNeo4j().int(id), embedding, text: embText })
            .finally(() => s.close());
        }
      }).catch(e => console.warn('Node embedding failed:', e.message));
    }

    res.json(node);
  } catch (err) {
    await tx.rollback();
    console.error('Error creating node:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Batch-create multiple nodes (used when user accepts AI-proposed nodes)
app.post('/api/threads/:threadId/nodes/batch', requireAuth, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { nodes } = req.body; // [{ title, content, nodeType, parentId }]
  if (!Array.isArray(nodes) || nodes.length === 0) return res.status(400).json({ error: 'nodes array required' });

  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });

  // Fetch existing node titles for duplicate detection (before starting tx)
  let existingTitles = [];
  try {
    const existingResult = await session.run(
      'MATCH (t:Thread {id: $tid})-[:HAS_NODE]->(n:Node) RETURN n.title AS title',
      { tid: getNeo4j().int(threadId) }
    );
    existingTitles = existingResult.records.map(r => (r.get('title') || '').toLowerCase().trim());
  } catch (e) { /* ignore — proceed without dedup */ }

  const tx = session.beginTransaction();
  try {

    const createdNodes = [];
    const duplicateSkipped = [];
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
        } catch (e) { /* keep as-is */ }
      }

      const nodeType = typeof n.nodeType === 'number'
        ? ['ROOT','EVIDENCE','REFERENCE','CONTEXT','EXAMPLE','COUNTERPOINT','SYNTHESIS'][n.nodeType]
        : n.nodeType;
      const nid = await getNextId('node', tx);
      await tx.run(
        `CREATE (nd:Node { id:$id, title:$title, content:$content, node_type:$type, metadata:$meta, created_at:$now, updated_at:$now })`,
        { id: getNeo4j().int(nid), title: n.title, content: content, type: nodeType, meta: JSON.stringify({ title: n.title }), now }
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
      createdNodes.push(formatNode({ id: nid, title: n.title, content: content, node_type: nodeType, created_at: now, updated_at: now, metadata: '{}' }, n.parentId || null));
    }
    await tx.commit();

    // Generate embeddings asynchronously for all created nodes
    for (const cn of createdNodes) {
      const embText = getEmbeddingText({ title: cn.title, content: cn.content, node_type: cn.node_type }, 'node');
      if (embText.trim()) {
        generateEmbedding(embText).then(embedding => {
          if (embedding) {
            const s = getDriver().session({ database: process.env.NEO4J_DATABASE });
            s.run('MATCH (n:Node {id: $id}) SET n.embedding = $embedding, n.embedding_text = $text', { id: getNeo4j().int(cn.id), embedding, text: embText })
              .finally(() => s.close());
          }
        }).catch(e => console.warn('Batch node embedding failed:', e.message));
      }
    }

    res.json({ createdNodes, duplicateSkipped });
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* connection may already be dead */ }
    console.error('Batch create error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Update node content
app.put('/api/threads/:threadId/nodes/:nodeId', requireAuth, async (req, res) => {
  const nodeId = parseInt(req.params.nodeId);
  const { title, content } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
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
          const s = getDriver().session({ database: process.env.NEO4J_DATABASE });
          s.run('MATCH (n:Node {id: $id}) SET n.embedding = $embedding, n.embedding_text = $text', { id: getNeo4j().int(nodeId), embedding, text: embText })
            .finally(() => s.close());
        }
      }).catch(e => console.warn('Node re-embedding failed:', e.message));
    }

    res.json(node);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Delete node (with children warning)
app.delete('/api/threads/:threadId/nodes/:nodeId', requireAuth, async (req, res) => {
  const nodeId = parseInt(req.params.nodeId);
  const force = req.query.force === 'true';
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Edge endpoints
app.post('/api/edges', requireAuth, async (req, res) => {
  const { sourceId, targetId } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run(
      `MATCH (a:Node {id: $src}), (b:Node {id: $tgt})
       CREATE (a)-[:PARENT_OF]->(b)`,
      { src: getNeo4j().int(sourceId), tgt: getNeo4j().int(targetId) }
    );
    res.json({ source_id: sourceId, target_id: targetId, relationship_type: 'parent-child' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Thread layout endpoints
app.put('/api/threads/:threadId/layout', requireAuth, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { layout } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run(
      `MATCH (t:Thread {id: $threadId})
       SET t.layout = $layout`,
      { threadId: getNeo4j().int(threadId), layout: JSON.stringify(layout) }
    );
    res.json({ layout });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.get('/api/threads/:threadId/layout', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      'MATCH (t:Thread {id: $threadId}) RETURN t.layout AS layout',
      { threadId: getNeo4j().int(threadId) }
    );
    const layoutStr = result.records[0]?.get('layout');
    const layout = layoutStr ? JSON.parse(layoutStr) : null;
    res.json(layout);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.delete('/api/threads/:threadId/layout', requireAuth, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run(
      'MATCH (t:Thread {id: $threadId}) REMOVE t.layout',
      { threadId: getNeo4j().int(threadId) }
    );
    res.json({});
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Thread canvas endpoints
app.put('/api/threads/:threadId/canvas', requireAuth, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { canvas } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run(
      `MATCH (t:Thread {id: $threadId})
       SET t.canvas = $canvas`,
      { threadId: getNeo4j().int(threadId), canvas: JSON.stringify(canvas) }
    );
    res.json({ canvas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.get('/api/threads/:threadId/canvas', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      'MATCH (t:Thread {id: $threadId}) RETURN t.canvas AS canvas',
      { threadId: getNeo4j().int(threadId) }
    );
    const canvasStr = result.records[0]?.get('canvas');
    const canvas = canvasStr ? JSON.parse(canvasStr) : null;
    res.json(canvas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.delete('/api/threads/:threadId/canvas', requireAuth, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run(
      'MATCH (t:Thread {id: $threadId}) REMOVE t.canvas',
      { threadId: getNeo4j().int(threadId) }
    );
    res.json({});
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Update thread content
app.put('/api/threads/:threadId/content', requireAuth, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { content } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const now = new Date().toISOString();
    const result = await session.run(
      `MATCH (t:Thread {id: $threadId})
       SET t.content = $content, t.updated_at = $now
       RETURN t`,
      { threadId: getNeo4j().int(threadId), content: content || '', now }
    );
    const thread = formatThread(result.records[0].get('t').properties);
    res.json(thread);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Thread article sequence endpoints
app.put('/api/threads/:threadId/sequence', requireAuth, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { sequence } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run(
      `MATCH (t:Thread {id: $threadId})
       SET t.article_sequence = $sequence`,
      { threadId: getNeo4j().int(threadId), sequence: JSON.stringify(sequence) }
    );
    res.json({ sequence });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.get('/api/threads/:threadId/sequence', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      'MATCH (t:Thread {id: $threadId}) RETURN t.article_sequence AS sequence',
      { threadId: getNeo4j().int(threadId) }
    );
    const seqStr = result.records[0]?.get('sequence');
    const sequence = seqStr ? JSON.parse(seqStr) : null;
    res.json(sequence);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.delete('/api/threads/:threadId/sequence', requireAuth, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run(
      'MATCH (t:Thread {id: $threadId}) REMOVE t.article_sequence',
      { threadId: getNeo4j().int(threadId) }
    );
    res.json({});
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Search threads endpoint
app.get('/api/threads/search', async (req, res) => {
  const { query } = req.query;
  if (!query) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ── Admin: setup vector indexes ────────────────────────────────────────────────
app.post('/api/admin/setup-indexes', requireAuth, async (req, res) => {
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run(`
      CREATE VECTOR INDEX thread_embedding IF NOT EXISTS
      FOR (t:Thread) ON (t.embedding)
      OPTIONS {indexConfig: {
        \`vector.dimensions\`: 1536,
        \`vector.similarity_function\`: 'cosine'
      }}
    `);
    await session.run(`
      CREATE VECTOR INDEX node_embedding IF NOT EXISTS
      FOR (n:Node) ON (n.embedding)
      OPTIONS {indexConfig: {
        \`vector.dimensions\`: 1536,
        \`vector.similarity_function\`: 'cosine'
      }}
    `);
    res.json({ ok: true, message: 'Vector indexes created' });
  } catch (err) {
    console.error('Setup indexes error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ── Admin: migrate existing content to embeddings (batch of 20) ────────────────
app.post('/api/admin/migrate-embeddings', requireAuth, async (req, res) => {
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    // Find threads without embeddings
    const threadResult = await session.run(
      `MATCH (t:Thread) WHERE t.embedding IS NULL RETURN t LIMIT 20`
    );
    let threadCount = 0;
    for (const record of threadResult.records) {
      const props = record.get('t').properties;
      const text = getEmbeddingText({ title: props.title, description: props.description, content: props.content }, 'thread');
      if (!text.trim()) continue;
      try {
        const embedding = await generateEmbedding(text);
        if (embedding) {
          await session.run(
            `MATCH (t:Thread {id: $id}) SET t.embedding = $embedding, t.embedding_text = $text`,
            { id: props.id, embedding, text }
          );
          threadCount++;
        }
      } catch (e) { console.warn('Embedding failed for thread', toNum(props.id), e.message); }
    }

    // Find nodes without embeddings
    const nodeResult = await session.run(
      `MATCH (n:Node) WHERE n.embedding IS NULL RETURN n LIMIT 20`
    );
    let nodeCount = 0;
    for (const record of nodeResult.records) {
      const props = record.get('n').properties;
      const text = getEmbeddingText({ title: props.title, content: props.content, node_type: props.node_type }, 'node');
      if (!text.trim()) continue;
      try {
        const embedding = await generateEmbedding(text);
        if (embedding) {
          await session.run(
            `MATCH (n:Node {id: $id}) SET n.embedding = $embedding, n.embedding_text = $text`,
            { id: props.id, embedding, text }
          );
          nodeCount++;
        }
      } catch (e) { console.warn('Embedding failed for node', toNum(props.id), e.message); }
    }

    // Check remaining
    const remaining = await session.run(
      `MATCH (x) WHERE (x:Thread OR x:Node) AND x.embedding IS NULL RETURN count(x) AS remaining`
    );
    const remainingCount = toNum(remaining.records[0].get('remaining'));

    res.json({ ok: true, threadsProcessed: threadCount, nodesProcessed: nodeCount, remaining: remainingCount });
  } catch (err) {
    console.error('Migrate embeddings error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Create thread with GPT endpoint
app.post('/api/threads/generate', requireAuth, async (req, res) => {
  const { topic } = req.body;
  if (!topic) {
    return res.status(400).json({ error: 'Topic is required' });
  }

  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  const tx = session.beginTransaction();

  try {
    const threadResponse = await getOpenAI().chat.completions.create({
      model: "gpt-5.2",
      messages: [{
        role: "system",
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
}`
      }, {
        role: "user",
        content: `Create a knowledge thread about: ${topic}`
      }],
      temperature: 0.7,
      max_tokens: 1000
    });

    const gptContent = JSON.parse(threadResponse.choices[0].message.content);

    // Create thread
    const threadId = await getNextId('thread', tx);
    const now = new Date().toISOString();
    const threadMetaStr = JSON.stringify({
      title: topic,
      description: gptContent.summary.substring(0, 255)
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
        now
      }
    );

    // Create nodes
    const nodeEntries = [
      { title: 'Summary', content: gptContent.summary, type: 'SYNTHESIS' },
      { title: gptContent.evidence.source, content: JSON.stringify(gptContent.evidence), type: 'EVIDENCE' },
      { title: gptContent.example.title, content: JSON.stringify(gptContent.example), type: 'EXAMPLE' },
      { title: gptContent.counterpoint.argument, content: JSON.stringify(gptContent.counterpoint), type: 'COUNTERPOINT' },
      { title: 'Synthesis', content: gptContent.synthesis, type: 'SYNTHESIS' }
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
          threadId: getNeo4j().int(threadId)
        }
      );
    }

    await tx.commit();

    const thread = formatThread(threadResult.records[0].get('t').properties);
    res.json(thread);
  } catch (err) {
    await tx.rollback();
    console.error('Error generating thread:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Node suggestion endpoint
app.post('/api/nodes/suggest', requireAuth, async (req, res) => {
  const { nodeId, nodeType, content, title } = req.body;

  try {
    let nodeContent = content;
    if (typeof content === 'string' && (content.startsWith('{') || content.startsWith('['))) {
      try {
        nodeContent = JSON.parse(content);
      } catch (e) {
        console.log('Failed to parse content as JSON:', e);
      }
    }

    let contentForGPT = '';
    if (typeof nodeContent === 'object') {
      if (nodeContent.content) {
        contentForGPT = nodeContent.content;
      } else if (nodeContent.explanation) {
        contentForGPT = `${nodeContent.argument}\n${nodeContent.explanation}`;
      } else if (nodeContent.point) {
        contentForGPT = `${nodeContent.point}\nSource: ${nodeContent.source}`;
      } else if (nodeContent.description) {
        contentForGPT = `${nodeContent.title}\n${nodeContent.description}`;
      }
    } else {
      contentForGPT = nodeContent;
    }

    const response = await getOpenAI().chat.completions.create({
      model: "gpt-5.2",
      messages: [{
        role: "system",
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
]`
      }, {
        role: "user",
        content: `Generate relevant nodes for this content:\nTitle: ${title}\nContent: ${contentForGPT}`
      }],
      temperature: 0.7,
    });

    const suggestions = JSON.parse(response.choices[0].message.content);
    res.json({ suggestions });
  } catch (err) {
    console.error('Error generating suggestions:', err);
    res.status(500).json({ error: err.message });
  }
});

// Chat endpoint — SSE streaming only. Extraction is handled by /api/chat/extract.
app.post('/api/chat', requireAuth, async (req, res) => {
  const { message, history = [], apiKey, nodeContext } = req.body;
  const resolvedKey = apiKey || process.env.OPENAI_API_KEY;
  if (!resolvedKey) {
    return res.status(400).json({ error: 'OpenAI API key required' });
  }
  if (!message) return res.status(400).json({ error: 'Message required' });

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let _streamClosed = false;
  const send = (obj) => { if (!_streamClosed) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
  const closeStream = () => { if (!_streamClosed) { _streamClosed = true; res.end(); } };

  const OpenAI = require('openai');
  const userOpenAI = new OpenAI({ apiKey: resolvedKey, timeout: 55000 });

  try {
    let reply = '';
    let citations = [];

    // Serialize the current article node for context
    let nodeContextText = '';
    if (nodeContext) {
      let contentStr = nodeContext.content || '';
      if (typeof contentStr === 'string' && (contentStr.startsWith('{') || contentStr.startsWith('['))) {
        try {
          const parsed = JSON.parse(contentStr);
          if (parsed.description) contentStr = parsed.description;
          else if (parsed.point) contentStr = `${parsed.point}\nSource: ${parsed.source || ''}`;
          else if (parsed.explanation) contentStr = `${parsed.argument}\n${parsed.explanation}`;
          else contentStr = JSON.stringify(parsed);
        } catch (e) { /* keep raw */ }
      }
      nodeContextText = `\n\nThe user is currently viewing this article node:\nType: ${nodeContext.nodeType}\nTitle: ${nodeContext.title}\nContent: ${contentStr}\n\nWhen the user says "this", "it", or other deictic references, they mean the above node. If your response substantially expands on this node's content, you may propose an updated version.`;
    }

    const systemMsg = {
      role: 'system',
      content: `You are a research assistant helping build a knowledge graph. You have web search — USE IT proactively for every request. Be thorough and cite web sources for factual claims. Use markdown for structure with clickable [title](url) links for every source. Highlight key evidence, concrete examples, and opposing viewpoints. When asked for videos, search the web and return real URLs from search results — never guess or make up a URL. Never ask clarifying questions — just do the research immediately. Never open with conversational filler like "Certainly!", "Sure!", "Of course!", "I'd be happy to", or "Here is a...". Start immediately with the substantive content.${nodeContextText}`
    };
    const inputMsgs = [
      systemMsg,
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ];

    // Try Responses API streaming with web_search_preview
    let usedResponsesAPI = false;
    if (typeof userOpenAI.responses === 'object' && typeof userOpenAI.responses.create === 'function') {
      try {
        const stream = await userOpenAI.responses.create({
          model: 'gpt-5.2',
          tools: [{ type: 'web_search_preview' }],
          input: inputMsgs,
          stream: true,
        });

        for await (const event of stream) {
          if (event.type === 'response.output_text.delta') {
            const delta = event.delta || '';
            if (delta) {
              reply += delta;
              send({ type: 'token', content: delta });
            }
          } else if (event.type === 'response.completed') {
            for (const item of event.response?.output || []) {
              if (item.type === 'message') {
                for (const part of item.content || []) {
                  if (part.type === 'text' && Array.isArray(part.annotations)) {
                    for (const ann of part.annotations) {
                      if (ann.type === 'url_citation' && ann.url) {
                        citations.push({ url: ann.url, title: ann.title || ann.url });
                      }
                    }
                  }
                }
              }
            }
          }
        }
        usedResponsesAPI = true;
      } catch (e) {
        console.warn('Responses API streaming failed, falling back:', e.message);
        reply = '';
      }
    }

    // Fallback: chat.completions streaming
    if (!usedResponsesAPI || !reply) {
      reply = '';
      const stream = await userOpenAI.chat.completions.create({
        model: 'gpt-5.2',
        messages: inputMsgs,
        stream: true,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          reply += delta;
          send({ type: 'token', content: delta });
        }
      }
    }

    // Extract non-YouTube URLs from the reply text that aren't already in citations.
    // YouTube URLs from reply text are skipped — LLMs fabricate video IDs.
    // Only YouTube URLs from actual web search citations (url_citation) are trusted.
    const urlRegex = /https?:\/\/[^\s)<>\]"']+/g;
    const ytHostRegex = /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//;
    const citedUrls = new Set(citations.map(c => c.url));
    const replyUrls = reply.match(urlRegex) || [];
    for (const url of replyUrls) {
      const clean = url.replace(/[.,;:!?)]+$/, '');
      if (!citedUrls.has(clean) && !ytHostRegex.test(clean)) {
        citedUrls.add(clean);
        citations.push({ url: clean, title: clean });
      }
    }

    // Streaming complete — send reply + citations so client can call /api/chat/extract
    send({ type: 'done', reply, citations });
    closeStream();
  } catch (err) {
    console.error('Chat streaming error:', err);
    send({ type: 'error', error: err.message });
    closeStream();
  }
});

// Extraction endpoint — runs after streaming completes.
// Performs LLM structure extraction + Neo4j persistence in a separate request
// so neither phase risks the Vercel 60 s function timeout.
app.post('/api/chat/extract', requireAuth, async (req, res) => {
  const { message, reply, threadId, apiKey, nodeContext, citations: incomingCitations = [] } = req.body;
  const resolvedKey = apiKey || process.env.OPENAI_API_KEY;
  if (!resolvedKey) return res.status(400).json({ error: 'OpenAI API key required' });
  if (!message || !reply) return res.status(400).json({ error: 'message and reply are required' });

  const OpenAI = require('openai');
  const userOpenAI = new OpenAI({ apiKey: resolvedKey, timeout: 45000 });
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });

  try {
    // ── Step 1: Fetch thread title + existing node titles in one query ───
    let currentThreadTitle = '';
    let existingNodeTitles = [];
    if (threadId) {
      try {
        const combinedResult = await session.run(
          `MATCH (t:Thread {id: $tid})
           OPTIONAL MATCH (t)-[:HAS_NODE]->(n:Node)
           RETURN t.title AS threadTitle, collect(n.title) AS nodeTitles`,
          { tid: getNeo4j().int(parseInt(threadId)) }
        );
        const rec = combinedResult.records[0];
        if (rec) {
          currentThreadTitle = rec.get('threadTitle') || '';
          existingNodeTitles = (rec.get('nodeTitles') || []).filter(Boolean).slice(0, 50);
        }
      } catch (e) { /* ignore — proceed without */ }
    }

    // ── Step 2: Structure extraction ─────────────────────────────────────
    let structure = {
      topicShift: false,
      threadTitle: currentThreadTitle || message.substring(0, 60),
      nodes: []
    };

    try {
      const extractResp = await userOpenAI.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Extract structured knowledge nodes from a research exchange. Return JSON only:
{
  "topicShift": boolean,
  "threadTitle": "topic of current conversation",
  "nodes": [
    {
      "type": "ROOT",
      "title": "main idea title (max 60 chars)",
      "content": "comprehensive 3-5 sentence summary covering the key facts, context, and significance"
    },
    {
      "type": "EVIDENCE|EXAMPLE|CONTEXT|COUNTERPOINT|SYNTHESIS|REFERENCE",
      "title": "concise title (max 60 chars)",
      "content": "the specific fact or insight from the text",
      "sourceUrl": "full URL or null"
    }
  ],
  "proposedUpdate": {
    "title": "improved node title (keep original if fine)",
    "shouldUpdate": true
  } | null
}
Rules:
- ALWAYS output exactly ONE ROOT node first — it represents the main idea of this exchange.
- Create ONE EVIDENCE node for EVERY web citation provided — each citation must become its own EVIDENCE node with its URL as sourceUrl and the key fact it supports as content.
- If YouTube URLs appear in the assistant response, preserve them as sourceUrl in EVIDENCE nodes.
- Additionally create 0-2 higher-level nodes (CONTEXT, EXAMPLE, COUNTERPOINT, or SYNTHESIS) to capture broader insights.
- All non-ROOT nodes are children of the ROOT node.
- topicShift=true only when the user clearly switches to a completely different subject.
- Do not skip citations — every URL must appear as a sourceUrl in some EVIDENCE node.
- proposedUpdate: If a currentNode was provided, set shouldUpdate=true whenever the response adds useful information about the node's topic. Only omit if the response is completely unrelated to the node. Do NOT include a description field — just title and shouldUpdate.${existingNodeTitles.length > 0 ? `\n- EXISTING nodes (DO NOT duplicate): ${JSON.stringify(existingNodeTitles)}` : ''}`
          },
          {
            role: 'user',
            content: `${currentThreadTitle ? `Thread: "${currentThreadTitle}"\n` : ''}User: ${message}\nAssistant: ${reply.substring(0, 4000)}\nCitations (ALL must become EVIDENCE nodes): ${JSON.stringify(incomingCitations)}${nodeContext ? `\ncurrentNode: ${JSON.stringify({ title: nodeContext.title, type: nodeContext.nodeType, existingContent: (nodeContext.content || '').substring(0, 400) })}` : ''}`
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2
      });
      const parsed = JSON.parse(extractResp.choices[0].message.content);
      if (parsed && Array.isArray(parsed.nodes)) structure = parsed;
    } catch (e) {
      console.warn('Structure extraction failed:', e.message);
    }

    // Build proposedUpdate description locally from raw reply (instant, no LLM needed)
    if (structure.proposedUpdate?.shouldUpdate && nodeContext) {
      const htmlDesc = reply
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
        .replace(/\n\n/g, '</p><p>')
        .replace(/^(?!<[hulo])(.+)$/gm, '<p>$1</p>');
      structure.proposedUpdate.description = htmlDesc;
    } else if (structure.proposedUpdate && !nodeContext) {
      structure.proposedUpdate = null;
    }

    // ── Step 3: Create thread if needed, return nodes as proposals ───────
    let activeThreadId = threadId ? parseInt(threadId) : null;
    let newThread = null;

    if (!activeThreadId || structure.topicShift) {
      const threadTx = session.beginTransaction();
      try {
        const newId = await getNextId('thread', threadTx);
        const now = new Date().toISOString();
        const rawTitle = structure.threadTitle || '';
        const ttl = (rawTitle && rawTitle.toLowerCase() !== 'none' ? rawTitle : message).substring(0, 120);
        await threadTx.run(
          `CREATE (t:Thread { id:$id, title:$title, description:$desc, content:$content, metadata:$meta, created_at:$now, updated_at:$now })`,
          { id: getNeo4j().int(newId), title: ttl, desc: reply.substring(0, 500), content: reply.substring(0, 4000), meta: JSON.stringify({ title: ttl }), now }
        );
        await threadTx.commit();
        newThread = { id: newId, title: ttl };
        activeThreadId = newId;
      } catch (e) { await threadTx.rollback(); throw e; }
    }

    // Build proposed nodes — NOT saved yet. Frontend shows Accept/Discard.
    const rootNode = structure.nodes.find(n => n.type === 'ROOT');
    const secondaryNodes = structure.nodes.filter(n => n.type !== 'ROOT').slice(0, 11);
    const proposedNodes = [];

    if (rootNode) {
      proposedNodes.push({ title: rootNode.title, type: 'ROOT', content: JSON.stringify({ title: rootNode.title, description: rootNode.content }) });
    }
    for (const n of secondaryNodes) {
      let nodeContent = n.content || '';
      if (n.type === 'EVIDENCE' && n.sourceUrl) {
        nodeContent = JSON.stringify({ point: n.content, source: n.sourceUrl });
      } else if (n.type === 'EXAMPLE') {
        nodeContent = JSON.stringify({ title: n.title, description: n.content });
      } else if (n.type === 'COUNTERPOINT') {
        nodeContent = JSON.stringify({ argument: n.title, explanation: n.content });
      }
      proposedNodes.push({ title: n.title, type: n.type, content: nodeContent });
    }

    const proposedUpdate = (nodeContext && structure.proposedUpdate?.description && structure.proposedUpdate?.shouldUpdate)
      ? { nodeId: nodeContext.nodeId, nodeType: nodeContext.nodeType, title: structure.proposedUpdate.title || nodeContext.title, description: structure.proposedUpdate.description }
      : null;

    res.json({ citations: incomingCitations, proposedNodes, threadId: activeThreadId, newThread, proposedUpdate });
  } catch (err) {
    console.error('Chat extract error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ── Thread analysis (Claim Confidence Meter) ──────────────────────────────────
app.post('/api/threads/:threadId/analyze', requireAuth, aiTimeout, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
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

    const nodesSummary = nodes.map(n => {
      let c = String(n.content || '');
      try { const p = JSON.parse(c); c = p.description || p.point || p.explanation || p.argument || c; } catch (e) { /* raw */ }
      return `[${n.node_type}] ${n.title}: ${c.replace(/<[^>]+>/g, ' ').substring(0, 400)}`;
    }).join('\n\n');

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
    res.json(JSON.parse(completion.choices[0].message.content));
  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ── AI sequence suggestion (Smart Sequence Suggester) ─────────────────────────
app.post('/api/threads/:threadId/sequence/suggest', requireAuth, aiTimeout, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node) RETURN n ORDER BY n.created_at ASC`,
      { threadId: getNeo4j().int(threadId) }
    );
    const nodes = result.records.map(r => {
      const p = r.get('n').properties;
      return { id: toNum(p.id), title: p.title, node_type: p.node_type };
    });
    if (!nodes.length) return res.status(400).json({ error: 'No nodes found' });

    const nodeList = nodes.map(n => `ID:${n.id} [${n.node_type}] "${n.title}"`).join('\n');
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a knowledge architect. Suggest the optimal reading order for a knowledge thread so it reads as a compelling, logically-flowing article.
Ordering principles: ROOT first → CONTEXT early → EVIDENCE (strongest first) → EXAMPLE → COUNTERPOINT → SYNTHESIS last.
Return JSON: { "orderedIds": [<all node IDs in optimal order>], "reasoning": "<2-3 sentences>" }`,
        },
        { role: 'user', content: `Optimise reading order for:\n\n${nodeList}` },
      ],
    });
    const parsed = JSON.parse(completion.choices[0].message.content);
    const suggestedIds = (parsed.orderedIds || []).map(id => parseInt(id));
    const allIds = nodes.map(n => n.id);
    const missing = allIds.filter(id => !suggestedIds.includes(id));
    res.json({ orderedIds: [...suggestedIds, ...missing], reasoning: parsed.reasoning || '' });
  } catch (err) {
    console.error('Sequence suggest error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ── Source verification (Inline Source Verification) ──────────────────────────
app.post('/api/verify-source', requireAuth, aiTimeout, async (req, res) => {
  const { url, claim } = req.body;
  if (!url || !claim) return res.status(400).json({ error: 'url and claim required' });

  let pageContent = '';
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8000);
    const pageRes = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CanonThread/1.0)' },
    });
    clearTimeout(tid);
    if (pageRes.ok) {
      const html = await pageRes.text();
      pageContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 4000);
    }
  } catch (fetchErr) {
    return res.json({ status: 'unavailable', explanation: 'Source URL could not be reached.' });
  }
  if (!pageContent) return res.json({ status: 'unavailable', explanation: 'Source returned no readable content.' });

  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Verify whether a claim is supported by a web source excerpt.
Return JSON: { "status": "<verified|partial|unverified>", "explanation": "<1-2 sentences>" }
verified = source clearly and directly supports the claim.
partial = source is relevant but doesn't fully confirm the specific claim.
unverified = source contradicts the claim or doesn't mention it.`,
        },
        { role: 'user', content: `CLAIM: "${claim}"\n\nSOURCE EXCERPT:\n${pageContent}` },
      ],
    });
    res.json(JSON.parse(completion.choices[0].message.content));
  } catch (err) {
    console.error('Verify source error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Red Team: attack any node's claim ─────────────────────────────────────────
app.post('/api/threads/:threadId/redteam', requireAuth, aiTimeout, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { nodeId: targetNodeId } = req.body; // optional — defaults to ROOT
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
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
    } catch (e) { /* raw */ }
    targetContent = targetContent.replace(/<[^>]+>/g, ' ').substring(0, 600);

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', temperature: 0.85,
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
    const { counterpoints = [] } = JSON.parse(completion.choices[0].message.content);

    // Return proposals only — not saved yet. Frontend shows Accept/Discard.
    const proposals = counterpoints.map(cp => ({
      title: cp.argument,
      content: JSON.stringify({ argument: cp.argument, explanation: cp.explanation }),
      nodeType: 'COUNTERPOINT',
    }));
    res.json({ proposals, parentNodeId: targetNode.id });
  } catch (err) {
    console.error('Red team error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ── Steelman: rewrite a COUNTERPOINT in its strongest form ────────────────────
app.post('/api/threads/:threadId/nodes/:nodeId/steelman', requireAuth, aiTimeout, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const nodeId   = parseInt(req.params.nodeId);
  const session  = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const read = await session.run(
      `MATCH (n:Node {id:$nodeId}) OPTIONAL MATCH (parent)-[:PARENT_OF]->(n) RETURN n, parent`,
      { nodeId: getNeo4j().int(nodeId) }
    );
    if (!read.records.length) return res.status(404).json({ error: 'Node not found' });
    const nodeProps  = read.records[0].get('n').properties;
    const parentRaw  = read.records[0].get('parent');
    const parentId   = parentRaw ? toNum(parentRaw.properties.id) : null;

    let argument = nodeProps.title, explanation = '';
    try { const p = JSON.parse(nodeProps.content); argument = p.argument || nodeProps.title; explanation = p.explanation || ''; } catch (e) { explanation = String(nodeProps.content || ''); }

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a philosophical steelmanner. Rewrite the given argument in its STRONGEST possible form.
Add the best available evidence, sharpen the logic, remove strawman elements, and make it as compelling and hard to dismiss as possible.
Return JSON: { "argument": "<improved title, max 12 words>", "explanation": "<2-4 HTML paragraphs>" }`,
        },
        { role: 'user', content: `Steelman this:\n\nTitle: "${argument}"\nArgument: ${explanation.replace(/<[^>]+>/g, ' ')}` },
      ],
    });
    const parsed = JSON.parse(completion.choices[0].message.content);
    const steelTitle   = parsed.argument;
    const steelContent = JSON.stringify({ argument: parsed.argument, explanation: parsed.explanation });

    // Return proposal only — not saved yet. Frontend shows Accept/Discard.
    res.json({
      proposal: { title: steelTitle, content: steelContent, nodeType: 'COUNTERPOINT' },
      parentId,
    });
  } catch (err) {
    console.error('Steelman error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ── Fork Thread: clone thread with optional alternative ROOT claim ─────────────
app.post('/api/threads/:threadId/fork', requireAuth, aiTimeout, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { altClaim } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const tRes = await session.run(`MATCH (t:Thread {id:$tid}) RETURN t`, { tid: getNeo4j().int(threadId) });
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

    const tx = session.beginTransaction();
    try {
      const now = new Date().toISOString();
      const forkTitle = altClaim || `Fork: ${orig.title}`;
      const newThreadId = await getNextId('Thread', tx);

      await tx.run(
        `CREATE (t:Thread {id:$id, title:$title, description:$desc, content:$content, metadata:$meta, created_at:$now, updated_at:$now})`,
        { id: getNeo4j().int(newThreadId), title: forkTitle, desc: orig.description || '', content: orig.content || '', meta: orig.metadata || '{}', now }
      );

      const idMap = {};
      const cloned = [];
      for (const node of origNodes) {
        const newId = await getNextId('Node', tx);
        idMap[node.id] = newId;
        let title = node.title, content = node.content || '';
        if (node.node_type === 'ROOT' && altClaim) {
          title = altClaim;
          try { const p = JSON.parse(content); if (p.title) { p.title = altClaim; content = JSON.stringify(p); } } catch (e) { /* raw */ }
        }
        await tx.run(
          `CREATE (n:Node {id:$id, title:$title, content:$content, node_type:$type, created_at:$now, updated_at:$now, metadata:$meta})`,
          { id: getNeo4j().int(newId), title, content, type: node.node_type, now, meta: node.metadata || '{}' }
        );
        await tx.run(
          `MATCH (t:Thread {id:$tid}),(n:Node {id:$nid}) CREATE (t)-[:HAS_NODE]->(n)`,
          { tid: getNeo4j().int(newThreadId), nid: getNeo4j().int(newId) }
        );
        cloned.push({ id: newId, title, content, node_type: node.node_type, oldParentId: node.parentId, metadata: node.metadata });
      }

      for (const n of cloned) {
        if (n.oldParentId && idMap[n.oldParentId]) {
          await tx.run(
            `MATCH (p:Node {id:$pid}),(c:Node {id:$cid}) CREATE (p)-[:PARENT_OF]->(c)`,
            { pid: getNeo4j().int(idMap[n.oldParentId]), cid: getNeo4j().int(n.id) }
          );
        }
      }
      await tx.commit();

      const responseNodes = cloned.map(n => formatNode(
        { id: n.id, title: n.title, content: n.content, node_type: n.node_type, created_at: now, updated_at: now, metadata: n.metadata || '{}' },
        n.oldParentId ? idMap[n.oldParentId] : null
      ));
      res.json({
        thread: { id: newThreadId, title: forkTitle, description: orig.description || '', content: orig.content || '', metadata: { title: forkTitle, description: orig.description || '' }, nodes: responseNodes, edges: [], forkedFrom: threadId },
      });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (err) {
    console.error('Fork error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ── Socratic Dialogue: question-driven reasoning ──────────────────────────────
app.post('/api/socratic', requireAuth, aiTimeout, async (req, res) => {
  const { threadId, history = [], currentAnswer = '', nodeContext } = req.body;
  const openai = getOpenAI();

  let threadSummary = '';
  if (threadId) {
    const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
    try {
      const r = await session.run(
        `MATCH (t:Thread {id:$tid})-[:HAS_NODE]->(n:Node) RETURN n.node_type AS type, n.title AS title LIMIT 12`,
        { tid: getNeo4j().int(parseInt(threadId)) }
      );
      threadSummary = r.records.map(rec => `[${rec.get('type')}] ${rec.get('title')}`).join(' | ');
    } finally { await session.close(); }
  }

  const historyText = history.map((h, i) => `Q${i + 1}: ${h.question}\nA${i + 1}: ${h.answer}`).join('\n\n');
  const nodeCtxText = nodeContext ? `Node being viewed: [${nodeContext.nodeType}] "${nodeContext.title}"` : '';

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', temperature: 0.75,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a Socratic dialogue facilitator helping a researcher deepen their thinking.
Rules: (1) Ask exactly ONE open-ended probing question per turn. (2) Never answer the question yourself. (3) Push on assumptions, ask for evidence, explore implications. (4) If an answer was given, extract the key insight as a potential node.
${threadSummary ? `Thread nodes: ${threadSummary}` : ''}${nodeCtxText ? `\n${nodeCtxText}` : ''}
Return JSON: { "question": "<next Socratic question>", "nodeFromAnswer": null | { "type": "<EVIDENCE|CONTEXT|SYNTHESIS|EXAMPLE>", "title": "<concise title>", "content": "<HTML paragraph>" } }
nodeFromAnswer is null when there is no answer yet.`,
        },
        {
          role: 'user',
          content: history.length === 0
            ? 'Start the dialogue. Ask your first probing question based on the thread.'
            : `Previous exchanges:\n${historyText}\n\nMy latest answer: "${currentAnswer}"\n\nNext question + extract a node if there is a clear insight in my answer.`,
        },
      ],
    });
    const parsed = JSON.parse(completion.choices[0].message.content);
    res.json({ question: parsed.question, nodeFromAnswer: parsed.nodeFromAnswer || null });
  } catch (err) {
    console.error('Socratic error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Socratic history persistence ──────────────────────────────────────────────
app.get('/api/threads/:threadId/socratic-history', requireAuth, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const r = await session.run('MATCH (t:Thread {id:$id}) RETURN t.socratic_history AS h', { id: getNeo4j().int(threadId) });
    const raw = r.records[0]?.get('h');
    res.json({ history: raw ? JSON.parse(raw) : [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.put('/api/threads/:threadId/socratic-history', requireAuth, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { history } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run('MATCH (t:Thread {id:$id}) SET t.socratic_history = $h', { id: getNeo4j().int(threadId), h: JSON.stringify(history || []) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ── Chat session CRUD ─────────────────────────────────────────────────────────

app.get('/api/threads/:threadId/chats', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_CHAT]->(c:Chat)
       RETURN c ORDER BY c.created_at DESC`,
      { threadId: getNeo4j().int(threadId) }
    );
    const chats = result.records.map(r => {
      const p = r.get('c').properties;
      const msgs = p.messages ? JSON.parse(p.messages) : [];
      return {
        id: toNum(p.id),
        title: p.title,
        threadId: toNum(p.thread_id),
        messageCount: msgs.filter(m => m.role === 'user').length,
        created_at: p.created_at,
        updated_at: p.updated_at,
      };
    });
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.get('/api/chats/:chatId', async (req, res) => {
  const chatId = parseInt(req.params.chatId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      'MATCH (c:Chat {id: $chatId}) RETURN c',
      { chatId: getNeo4j().int(chatId) }
    );
    if (!result.records.length) return res.status(404).json({ error: 'Chat not found' });
    const p = result.records[0].get('c').properties;
    res.json({
      id: toNum(p.id),
      title: p.title,
      threadId: toNum(p.thread_id),
      messages: p.messages ? JSON.parse(p.messages) : [],
      created_at: p.created_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.post('/api/chats', requireAuth, async (req, res) => {
  const { threadId, title, messages } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const id = await getNextId('chat', session);
    const now = new Date().toISOString();
    const result = await session.run(
      `CREATE (c:Chat {
         id: $id, title: $title, thread_id: $threadId,
         messages: $messages, created_at: $now, updated_at: $now
       })
       WITH c
       MATCH (t:Thread {id: $threadId})
       CREATE (t)-[:HAS_CHAT]->(c)
       RETURN c`,
      {
        id: getNeo4j().int(id),
        title: (title || 'Chat').substring(0, 120),
        threadId: getNeo4j().int(parseInt(threadId)),
        messages: JSON.stringify(messages || []),
        now,
      }
    );
    const p = result.records[0].get('c').properties;
    res.json({ id: toNum(p.id), title: p.title, created_at: p.created_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.put('/api/chats/:chatId', requireAuth, async (req, res) => {
  const chatId = parseInt(req.params.chatId);
  const { title, messages } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const now = new Date().toISOString();
    const result = await session.run(
      `MATCH (c:Chat {id: $chatId})
       SET c.messages = $messages, c.updated_at = $now,
           c.title = COALESCE($title, c.title)
       RETURN c`,
      {
        chatId: getNeo4j().int(chatId),
        messages: JSON.stringify(messages || []),
        now,
        title: title || null,
      }
    );
    if (!result.records.length) return res.status(404).json({ error: 'Chat not found' });
    const p = result.records[0].get('c').properties;
    res.json({ id: toNum(p.id), title: p.title, updated_at: p.updated_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2: Semantic Search
// ═══════════════════════════════════════════════════════════════════════════════

// Semantic search across threads and nodes
app.get('/api/search/semantic', async (req, res) => {
  const { q, limit = 20 } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const k = Math.min(parseInt(limit), 50);
    let threads = [];
    let nodes = [];

    // Try vector search first
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
      threads = textThreads.records.map(r => ({
        ...formatThread(r.get('t').properties),
        relevance: 0.5,
      }));
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
  } catch (err) {
    console.error('Semantic search error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Q&A synthesis — find relevant nodes and synthesize an answer
app.post('/api/search/answer', requireAuth, aiTimeout, async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Question required' });
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const queryEmbedding = await generateEmbedding(question);
    if (!queryEmbedding) return res.json({ answer: 'No embeddings available yet.', sources: [] });

    const vectorResults = await vectorQuery(session, 'node_embedding', 10, queryEmbedding);
    if (!vectorResults.records.length) return res.json({ answer: 'No relevant knowledge found in your threads.', sources: [] });

    // Filter by score > 0.3 and join with thread
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
        { role: 'user', content: `Question: ${question}\n\nKnowledge base:\n${context}` }
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
  } catch (err) {
    console.error('Q&A synthesis error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Related threads by embedding similarity
app.get('/api/threads/:threadId/related', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
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
  } catch (err) {
    console.error('Related threads error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Random thread for "Surprise me"
app.get('/api/threads/random', async (req, res) => {
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      'MATCH (t:Thread) WITH t, rand() AS r ORDER BY r LIMIT 1 RETURN t'
    );
    if (!result.records.length) return res.status(404).json({ error: 'No threads found' });
    res.json(formatThread(result.records[0].get('t').properties));
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Find contradictions across threads
app.post('/api/search/contradictions', requireAuth, aiTimeout, async (req, res) => {
  const { threadId } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    // Get thread's nodes with embeddings
    const nodesResult = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node)
       WHERE n.embedding IS NOT NULL
       RETURN n LIMIT 10`,
      { threadId: getNeo4j().int(parseInt(threadId)) }
    );

    const contradictions = [];
    for (const record of nodesResult.records) {
      const nodeProps = record.get('n').properties;
      const embedding = nodeProps.embedding;
      if (!embedding) continue;

      // Find similar nodes in OTHER threads
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
  } catch (err) {
    console.error('Contradictions error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3: Cross-Thread Knowledge Web
// ═══════════════════════════════════════════════════════════════════════════════

// Create cross-thread link
app.post('/api/links', requireAuth, async (req, res) => {
  const { sourceNodeId, targetNodeId, type, description, confidence, status } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const id = await getNextId('link', session);
    const now = new Date().toISOString();
    await session.run(
      `MATCH (a:Node {id: $src}), (b:Node {id: $tgt})
       CREATE (a)-[:RELATED_TO {id: $id, type: $type, description: $desc, confidence: $conf, status: $status, created_at: $now, created_by: $user}]->(b)`,
      {
        src: getNeo4j().int(sourceNodeId), tgt: getNeo4j().int(targetNodeId),
        id: getNeo4j().int(id), type: type || 'related', desc: description || '',
        conf: confidence || 0.5, status: status || 'accepted', now, user: 'user'
      }
    );
    res.json({ id, sourceNodeId, targetNodeId, type, description, confidence, status: status || 'accepted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Get cross-thread links for a node
app.get('/api/nodes/:nodeId/links', async (req, res) => {
  const nodeId = parseInt(req.params.nodeId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      `MATCH (n:Node {id: $nodeId})-[r:RELATED_TO]-(other:Node)
       MATCH (t:Thread)-[:HAS_NODE]->(other)
       RETURN r, other, t.id AS threadId, t.title AS threadTitle,
              CASE WHEN startNode(r) = n THEN 'outgoing' ELSE 'incoming' END AS direction`,
      { nodeId: getNeo4j().int(nodeId) }
    );
    const links = result.records.map(r => ({
      id: toNum(r.get('r').properties.id),
      type: r.get('r').properties.type,
      description: r.get('r').properties.description,
      confidence: r.get('r').properties.confidence,
      status: r.get('r').properties.status,
      direction: r.get('direction'),
      otherNode: { id: toNum(r.get('other').properties.id), title: r.get('other').properties.title, node_type: r.get('other').properties.node_type },
      threadId: toNum(r.get('threadId')),
      threadTitle: r.get('threadTitle'),
    }));
    res.json(links);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Delete a cross-thread link
app.delete('/api/links/:linkId', requireAuth, async (req, res) => {
  const linkId = parseInt(req.params.linkId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run('MATCH ()-[r:RELATED_TO {id: $id}]-() DELETE r', { id: getNeo4j().int(linkId) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Update link status (accept/reject AI suggestion)
app.put('/api/links/:linkId', requireAuth, async (req, res) => {
  const linkId = parseInt(req.params.linkId);
  const { status } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run('MATCH ()-[r:RELATED_TO {id: $id}]-() SET r.status = $status', { id: getNeo4j().int(linkId), status });
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// AI suggest cross-thread links
app.post('/api/links/suggest', requireAuth, aiTimeout, async (req, res) => {
  await ensureVectorIndexes();
  const { threadId } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    // Backfill embeddings for this thread's nodes that are missing them
    const missingResult = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node) WHERE n.embedding IS NULL RETURN n`,
      { threadId: getNeo4j().int(parseInt(threadId)) }
    );
    for (const record of missingResult.records) {
      const props = record.get('n').properties;
      const text = getEmbeddingText({ title: props.title, content: props.content, node_type: props.node_type }, 'node');
      if (!text.trim()) continue;
      try {
        const embedding = await generateEmbedding(text);
        if (embedding) {
          await session.run(
            `MATCH (n:Node {id: $id}) SET n.embedding = $embedding, n.embedding_text = $text`,
            { id: props.id, embedding, text }
          );
        }
      } catch (e) { /* skip individual failures */ }
    }

    const nodesResult = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node) WHERE n.embedding IS NOT NULL RETURN n LIMIT 10`,
      { threadId: getNeo4j().int(parseInt(threadId)) }
    );

    const suggestions = [];
    for (const record of nodesResult.records) {
      const nodeProps = record.get('n').properties;
      const embedding = nodeProps.embedding;
      if (!embedding) continue;

      const vectorRes2 = await vectorQuery(session, 'node_embedding', 5, embedding);
      const goodCandidates = vectorRes2.records
        .filter(r => r.get('score') > 0.6 && String(r.get('node').properties.id) !== String(nodeProps.id))
        .slice(0, 3);
      const candidateIds2 = goodCandidates.map(r => r.get('node').properties.id);
      const scoreMap2 = {};
      goodCandidates.forEach(r => { scoreMap2[String(r.get('node').properties.id)] = r.get('score'); });

      let linkCandidateRecords = [];
      if (candidateIds2.length > 0) {
        const similar = await session.run(
          `MATCH (t:Thread)-[:HAS_NODE]->(node:Node)
           WHERE node.id IN $ids AND t.id <> $threadId
           OPTIONAL MATCH (n2:Node {id: $nodeId})-[existing:RELATED_TO]-(node)
           WITH node, t, existing WHERE existing IS NULL
           RETURN node, t.id AS threadId, t.title AS threadTitle`,
          { ids: candidateIds2, nodeId: nodeProps.id, threadId: getNeo4j().int(parseInt(threadId)) }
        );
        linkCandidateRecords = similar.records;
      }

      for (const r of linkCandidateRecords) {
        suggestions.push({
          sourceNodeId: toNum(nodeProps.id),
          sourceNodeTitle: nodeProps.title,
          targetNodeId: toNum(r.get('node').properties.id),
          targetNodeTitle: r.get('node').properties.title,
          targetNodeType: r.get('node').properties.node_type,
          threadId: toNum(r.get('threadId')),
          threadTitle: r.get('threadTitle'),
          similarity: scoreMap2[String(r.get('node').properties.id)] || 0,
        });
      }
    }
    res.json({ suggestions: suggestions.slice(0, 15) });
  } catch (err) {
    console.error('Link suggest error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Global graph summary
app.get('/api/graph/global/summary', async (req, res) => {
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      `MATCH (t:Thread)
       OPTIONAL MATCH (t)-[:HAS_NODE]->(n:Node)
       OPTIONAL MATCH (n)-[r:RELATED_TO]->(other:Node)<-[:HAS_NODE]-(t2:Thread)
       WHERE t2 <> t
       WITH t, count(DISTINCT n) AS nodeCount, count(DISTINCT r) AS crossLinkCount,
            collect(DISTINCT t2.id) AS linkedThreadIds
       RETURN t, nodeCount, crossLinkCount, linkedThreadIds ORDER BY t.created_at DESC`
    );
    const threads = result.records.map(r => ({
      ...formatThread(r.get('t').properties),
      nodeCount: toNum(r.get('nodeCount')),
      crossLinkCount: toNum(r.get('crossLinkCount')),
      linkedThreadIds: r.get('linkedThreadIds').map(id => toNum(id)),
    }));
    res.json(threads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Concept CRUD
app.get('/api/concepts', async (req, res) => {
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      `MATCH (c:Concept) OPTIONAL MATCH (n:Node)-[:HAS_CONCEPT]->(c) RETURN c, count(n) AS usageCount ORDER BY usageCount DESC`
    );
    const concepts = result.records.map(r => ({
      id: toNum(r.get('c').properties.id),
      name: r.get('c').properties.name,
      aliases: r.get('c').properties.aliases ? JSON.parse(r.get('c').properties.aliases) : [],
      usageCount: toNum(r.get('usageCount')),
    }));
    res.json(concepts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.get('/api/concepts/:id/nodes', async (req, res) => {
  const conceptId = parseInt(req.params.id);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      `MATCH (n:Node)-[:HAS_CONCEPT]->(c:Concept {id: $id})
       MATCH (t:Thread)-[:HAS_NODE]->(n)
       RETURN n, t.id AS threadId, t.title AS threadTitle`,
      { id: getNeo4j().int(conceptId) }
    );
    const nodes = result.records.map(r => ({
      ...formatNode(r.get('n').properties, null),
      threadId: toNum(r.get('threadId')),
      threadTitle: r.get('threadTitle'),
    }));
    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Extract concepts from a node
app.post('/api/concepts/extract', requireAuth, aiTimeout, async (req, res) => {
  const { nodeId } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const nodeResult = await session.run('MATCH (n:Node {id: $id}) RETURN n', { id: getNeo4j().int(parseInt(nodeId)) });
    if (!nodeResult.records.length) return res.status(404).json({ error: 'Node not found' });
    const nodeProps = nodeResult.records[0].get('n').properties;

    let contentText = String(nodeProps.content || '');
    try { const p = JSON.parse(contentText); contentText = p.description || p.point || p.explanation || contentText; } catch (e) {}
    contentText = contentText.replace(/<[^>]+>/g, ' ').substring(0, 2000);

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Extract 2-5 key concept tags from the given content. Return JSON: { "concepts": ["concept1", "concept2", ...] }. Concepts should be general academic/domain terms (e.g., "machine learning", "cognitive bias"), not specific claims.' },
        { role: 'user', content: `Title: "${nodeProps.title}"\nContent: ${contentText}` }
      ],
    });
    const { concepts = [] } = JSON.parse(completion.choices[0].message.content);

    const created = [];
    for (const name of concepts.slice(0, 5)) {
      const normalized = name.toLowerCase().trim();
      if (!normalized) continue;
      // MERGE concept and create relationship
      await session.run(
        `MERGE (c:Concept {name: $name})
         ON CREATE SET c.id = randomUUID(), c.aliases = '[]', c.created_at = $now
         WITH c
         MATCH (n:Node {id: $nodeId})
         MERGE (n)-[:HAS_CONCEPT]->(c)`,
        { name: normalized, now: new Date().toISOString(), nodeId: getNeo4j().int(parseInt(nodeId)) }
      );
      created.push(normalized);
    }
    res.json({ concepts: created });
  } catch (err) {
    console.error('Concept extraction error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 4: Spaced Repetition & Active Recall
// ═══════════════════════════════════════════════════════════════════════════════

function sm2(quality, repetitions, easiness, interval) {
  let newEF = easiness + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (newEF < 1.3) newEF = 1.3;
  if (quality < 3) return { easiness: newEF, interval: 1, repetitions: 0 };
  const newReps = repetitions + 1;
  const newInterval = newReps === 1 ? 1 : newReps === 2 ? 6 : Math.round(interval * newEF);
  return { easiness: newEF, interval: newInterval, repetitions: newReps };
}

// Initialize review for thread's nodes
app.post('/api/review/init', requireAuth, async (req, res) => {
  const { threadId } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const now = new Date().toISOString().split('T')[0];
    await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node)
       WHERE n.review_due_date IS NULL
       SET n.review_easiness = 2.5, n.review_interval = 0, n.review_repetitions = 0,
           n.review_due_date = $now, n.review_last_date = null, n.review_quality = null`,
      { threadId: getNeo4j().int(parseInt(threadId)), now }
    );
    const count = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node) WHERE n.review_due_date IS NOT NULL RETURN count(n) AS c`,
      { threadId: getNeo4j().int(parseInt(threadId)) }
    );
    res.json({ ok: true, reviewableNodes: toNum(count.records[0].get('c')) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Get nodes due for review
app.get('/api/review/due', async (req, res) => {
  const { threadId } = req.query;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const today = new Date().toISOString().split('T')[0];
    let query, params;
    if (threadId) {
      query = `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node)
               WHERE n.review_due_date IS NOT NULL AND n.review_due_date <= $today
               RETURN n ORDER BY n.review_due_date ASC`;
      params = { threadId: getNeo4j().int(parseInt(threadId)), today };
    } else {
      query = `MATCH (n:Node) WHERE n.review_due_date IS NOT NULL AND n.review_due_date <= $today
               RETURN n ORDER BY n.review_due_date ASC LIMIT 50`;
      params = { today };
    }
    const result = await session.run(query, params);
    const nodes = result.records.map(r => formatNode(r.get('n').properties, null));
    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Submit review quality rating
app.post('/api/review/submit', requireAuth, async (req, res) => {
  const { nodeId, quality } = req.body; // quality: 0-5
  if (quality < 0 || quality > 5) return res.status(400).json({ error: 'Quality must be 0-5' });
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const nodeResult = await session.run('MATCH (n:Node {id: $id}) RETURN n', { id: getNeo4j().int(parseInt(nodeId)) });
    if (!nodeResult.records.length) return res.status(404).json({ error: 'Node not found' });
    const props = nodeResult.records[0].get('n').properties;

    const currentEasiness = props.review_easiness || 2.5;
    const currentInterval = props.review_interval ? toNum(props.review_interval) : 0;
    const currentReps = props.review_repetitions ? toNum(props.review_repetitions) : 0;

    const result = sm2(quality, currentReps, currentEasiness, currentInterval);
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Review stats
app.get('/api/review/stats', async (req, res) => {
  const { threadId } = req.query;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const today = new Date().toISOString().split('T')[0];
    let query, params;
    if (threadId) {
      query = `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node)
               WITH count(n) AS total,
                    count(CASE WHEN n.review_due_date IS NOT NULL THEN 1 END) AS reviewable,
                    count(CASE WHEN n.review_due_date <= $today AND n.review_due_date IS NOT NULL THEN 1 END) AS due,
                    count(CASE WHEN n.review_repetitions >= 5 THEN 1 END) AS mastered,
                    count(CASE WHEN n.review_last_date IS NOT NULL THEN 1 END) AS reviewed
               RETURN total, reviewable, due, mastered, reviewed`;
      params = { threadId: getNeo4j().int(parseInt(threadId)), today };
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Knowledge decay percentages for graph visualization
app.get('/api/review/decay', async (req, res) => {
  const { threadId } = req.query;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node)
       WHERE n.review_due_date IS NOT NULL
       RETURN n.id AS id, n.review_due_date AS due, n.review_interval AS interval, n.review_easiness AS easiness`,
      { threadId: getNeo4j().int(parseInt(threadId)) }
    );
    const today = new Date();
    const decay = result.records.map(r => {
      const due = new Date(r.get('due'));
      const interval = toNum(r.get('interval')) || 1;
      const daysSinceDue = Math.max(0, (today - due) / (1000 * 60 * 60 * 24));
      const decayPercent = Math.min(100, Math.round((daysSinceDue / Math.max(interval, 1)) * 100));
      return { nodeId: toNum(r.get('id')), decayPercent, daysSinceDue: Math.round(daysSinceDue) };
    });
    res.json(decay);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// AI quiz generation
app.post('/api/review/quiz', requireAuth, aiTimeout, async (req, res) => {
  const { nodeId, quizType } = req.body; // quizType: 'recall' | 'steelman'
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const nodeResult = await session.run('MATCH (n:Node {id: $id}) RETURN n', { id: getNeo4j().int(parseInt(nodeId)) });
    if (!nodeResult.records.length) return res.status(404).json({ error: 'Node not found' });
    const props = nodeResult.records[0].get('n').properties;

    let contentText = String(props.content || '');
    try { const p = JSON.parse(contentText); contentText = p.description || p.point || p.explanation || p.argument || contentText; } catch (e) {}
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
        { role: 'user', content: `[${props.node_type}] "${props.title}": ${contentText}` }
      ],
    });
    res.json(JSON.parse(completion.choices[0].message.content));
  } catch (err) {
    console.error('Quiz generation error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 5: PDF/Article Ingestion Pipeline
// ═══════════════════════════════════════════════════════════════════════════════

// URL ingestion
app.post('/api/ingest/url', requireAuth, aiTimeout, async (req, res) => {
  const { url, threadId } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    // Fetch and extract text from URL
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10000);
    const pageRes = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CanonThread/1.0)' },
    });
    clearTimeout(tid);
    if (!pageRes.ok) return res.status(400).json({ error: `Failed to fetch URL: ${pageRes.status}` });

    const html = await pageRes.text();
    const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 12000);

    if (!text || text.length < 100) return res.status(400).json({ error: 'Could not extract meaningful text from URL' });

    // Extract title from HTML
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : url;

    // Use GPT to extract structured nodes
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Extract structured knowledge nodes from a web article. Return JSON:
{
  "title": "article title",
  "summary": "2-3 sentence summary",
  "nodes": [
    { "type": "ROOT", "title": "main claim/topic", "content": "comprehensive summary" },
    { "type": "EVIDENCE|EXAMPLE|CONTEXT|COUNTERPOINT|SYNTHESIS|REFERENCE", "title": "concise title", "content": "the insight or fact", "sourceUrl": "${url}" }
  ]
}
Create 3-8 nodes. ROOT first, then supporting nodes.`
        },
        { role: 'user', content: `Extract knowledge from:\nURL: ${url}\nTitle: ${pageTitle}\n\nContent:\n${text}` }
      ],
    });
    const extracted = JSON.parse(completion.choices[0].message.content);

    // Build proposed nodes
    const proposedNodes = (extracted.nodes || []).map(n => {
      let nodeContent = n.content || '';
      if (n.type === 'EVIDENCE' && n.sourceUrl) nodeContent = JSON.stringify({ point: n.content, source: n.sourceUrl });
      else if (n.type === 'EXAMPLE') nodeContent = JSON.stringify({ title: n.title, description: n.content });
      else if (n.type === 'COUNTERPOINT') nodeContent = JSON.stringify({ argument: n.title, explanation: n.content });
      else if (n.type === 'ROOT') nodeContent = JSON.stringify({ title: n.title, description: n.content });
      return { title: n.title, type: n.type, content: nodeContent };
    });

    res.json({
      title: extracted.title || pageTitle,
      summary: extracted.summary || '',
      sourceUrl: url,
      proposedNodes,
      threadId: threadId || null,
    });
  } catch (err) {
    console.error('URL ingestion error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PDF ingestion
app.post('/api/ingest/pdf', requireAuth, aiTimeout, async (req, res) => {
  try {
    // Handle base64-encoded PDF from frontend
    const { pdfBase64, filename, threadId } = req.body;
    if (!pdfBase64) return res.status(400).json({ error: 'PDF data required' });

    let PDFParse;
    try {
      const pdfParse = require('pdf-parse');
      PDFParse = pdfParse.PDFParse || pdfParse.default?.PDFParse || pdfParse;
    } catch (e) {
      return res.status(500).json({ error: 'pdf-parse not installed. Run: npm install pdf-parse' });
    }

    const buffer = Buffer.from(pdfBase64, 'base64');
    const parser = new PDFParse({ data: buffer });
    let data;
    try {
      data = await parser.getText();
    } finally {
      await parser.destroy().catch(() => {});
    }
    const text = (data?.text || data || '').toString().substring(0, 12000);
    const pageCount = data?.total || 0;

    if (!text || text.length < 50) return res.status(400).json({ error: 'Could not extract text from PDF' });

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Extract structured knowledge nodes from a PDF document. Return JSON:
{
  "title": "document title",
  "summary": "2-3 sentence summary",
  "nodes": [
    { "type": "ROOT", "title": "main claim/topic", "content": "comprehensive summary" },
    { "type": "EVIDENCE|EXAMPLE|CONTEXT|COUNTERPOINT|SYNTHESIS|REFERENCE", "title": "concise title", "content": "the insight or fact" }
  ]
}
Create 3-8 nodes. ROOT first, then supporting nodes.`
        },
        { role: 'user', content: `Extract knowledge from PDF "${filename || 'document'}":\n\n${text}` }
      ],
    });
    const extracted = JSON.parse(completion.choices[0].message.content);

    const proposedNodes = (extracted.nodes || []).map(n => {
      let nodeContent = n.content || '';
      if (n.type === 'ROOT') nodeContent = JSON.stringify({ title: n.title, description: n.content });
      else if (n.type === 'EXAMPLE') nodeContent = JSON.stringify({ title: n.title, description: n.content });
      else if (n.type === 'COUNTERPOINT') nodeContent = JSON.stringify({ argument: n.title, explanation: n.content });
      return { title: n.title, type: n.type, content: nodeContent };
    });

    res.json({
      title: extracted.title || filename || 'PDF Document',
      summary: extracted.summary || '',
      proposedNodes,
      threadId: threadId || null,
      pageCount,
      truncated: (data.text || '').length > 12000,
    });
  } catch (err) {
    console.error('PDF ingestion error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Bookmarks CRUD
app.get('/api/bookmarks', requireAuth, async (req, res) => {
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      `MATCH (b:Bookmark) RETURN b ORDER BY b.created_at DESC`
    );
    const bookmarks = result.records.map(r => {
      const p = r.get('b').properties;
      return { id: toNum(p.id), url: p.url, title: p.title, notes: p.notes, status: p.status, source_type: p.source_type, created_at: p.created_at };
    });
    res.json(bookmarks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.post('/api/bookmarks', requireAuth, async (req, res) => {
  const { url, title, notes, source_type } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const id = await getNextId('bookmark', session);
    const now = new Date().toISOString();
    await session.run(
      `CREATE (b:Bookmark {id: $id, url: $url, title: $title, notes: $notes, status: 'unread', source_type: $type, created_at: $now})`,
      { id: getNeo4j().int(id), url: url || '', title: title || url || '', notes: notes || '', type: source_type || 'url', now }
    );
    res.json({ id, url, title: title || url, notes, status: 'unread', source_type: source_type || 'url', created_at: now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.put('/api/bookmarks/:id', requireAuth, async (req, res) => {
  const bookmarkId = parseInt(req.params.id);
  const { status, notes, title } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const sets = [];
    const params = { id: getNeo4j().int(bookmarkId) };
    if (status !== undefined) { sets.push('b.status = $status'); params.status = status; }
    if (notes !== undefined) { sets.push('b.notes = $notes'); params.notes = notes; }
    if (title !== undefined) { sets.push('b.title = $title'); params.title = title; }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    await session.run(`MATCH (b:Bookmark {id: $id}) SET ${sets.join(', ')}`, params);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

app.delete('/api/bookmarks/:id', requireAuth, async (req, res) => {
  const bookmarkId = parseInt(req.params.id);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run('MATCH (b:Bookmark {id: $id}) DELETE b', { id: getNeo4j().int(bookmarkId) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Bibliography generation
app.post('/api/threads/:threadId/bibliography', requireAuth, aiTimeout, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { format } = req.body; // 'apa' | 'chicago' | 'mla'
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node)
       WHERE n.node_type = 'EVIDENCE' OR n.node_type = 'REFERENCE'
       RETURN n`,
      { threadId: getNeo4j().int(threadId) }
    );

    const sources = result.records.map(r => {
      const p = r.get('n').properties;
      let source = '';
      try { const parsed = JSON.parse(p.content); source = parsed.source || parsed.url || ''; } catch (e) {}
      return { title: p.title, source, content: p.content };
    }).filter(s => s.source);

    if (!sources.length) return res.json({ bibliography: 'No sources found.' });

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', temperature: 0.1,
      messages: [
        { role: 'system', content: `Format the following sources as a bibliography in ${format || 'APA'} style. Return the formatted bibliography as plain text.` },
        { role: 'user', content: sources.map(s => `Title: ${s.title}\nURL: ${s.source}`).join('\n\n') }
      ],
    });
    res.json({ bibliography: completion.choices[0].message.content, sourceCount: sources.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 6: Confidence History & Timeline
// ═══════════════════════════════════════════════════════════════════════════════

// Create snapshot
app.post('/api/threads/:threadId/snapshots', requireAuth, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { trigger, triggerDetail } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    // Get current thread state
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

    // Get latest confidence score
    const confResult = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_CONFIDENCE]->(c:ConfidenceEntry) RETURN c ORDER BY c.created_at DESC LIMIT 1`,
      { threadId: getNeo4j().int(threadId) }
    );
    const confScore = confResult.records.length ? confResult.records[0].get('c').properties.score : null;

    // Get version count
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
  } catch (err) {
    console.error('Snapshot error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// List snapshots
app.get('/api/threads/:threadId/snapshots', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Diff two snapshots
app.get('/api/threads/:threadId/snapshots/diff', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { v1, v2 } = req.query;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
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
    const map2 = Object.fromEntries(snap2.map(n => [n.id, n]));

    const added = snap2.filter(n => !ids1.has(n.id));
    const removed = snap1.filter(n => !ids2.has(n.id));
    const modified = snap2.filter(n => ids1.has(n.id) && (map1[n.id].title !== n.title || map1[n.id].content !== n.content));

    res.json({ added, removed, modified, v1NodeCount: snap1.length, v2NodeCount: snap2.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Record confidence score
app.post('/api/threads/:threadId/confidence', requireAuth, async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { score, breakdown, verdict } = req.body;
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// List confidence history
app.get('/api/threads/:threadId/confidence', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Unified timeline
app.get('/api/threads/:threadId/timeline', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const events = [];

    // Thread creation
    const threadResult = await session.run(
      'MATCH (t:Thread {id: $id}) RETURN t.created_at AS created_at, t.title AS title',
      { id: getNeo4j().int(threadId) }
    );
    if (threadResult.records.length) {
      events.push({ type: 'thread_created', title: threadResult.records[0].get('title'), timestamp: threadResult.records[0].get('created_at') });
    }

    // Node additions
    const nodesResult = await session.run(
      `MATCH (t:Thread {id: $id})-[:HAS_NODE]->(n:Node) RETURN n.id AS id, n.title AS title, n.node_type AS nodeType, n.created_at AS created_at`,
      { id: getNeo4j().int(threadId) }
    );
    for (const r of nodesResult.records) {
      events.push({ type: 'node_added', nodeId: toNum(r.get('id')), title: r.get('title'), nodeType: r.get('nodeType'), timestamp: r.get('created_at') });
    }

    // Snapshots
    const snapResult = await session.run(
      `MATCH (t:Thread {id: $id})-[:HAS_SNAPSHOT]->(s:Snapshot) RETURN s.version AS version, s.trigger AS trigger, s.created_at AS created_at`,
      { id: getNeo4j().int(threadId) }
    );
    for (const r of snapResult.records) {
      events.push({ type: 'snapshot', version: toNum(r.get('version')), trigger: r.get('trigger'), timestamp: r.get('created_at') });
    }

    // Confidence entries
    const confResult = await session.run(
      `MATCH (t:Thread {id: $id})-[:HAS_CONFIDENCE]->(c:ConfidenceEntry) RETURN c.score AS score, c.verdict AS verdict, c.created_at AS created_at`,
      { id: getNeo4j().int(threadId) }
    );
    for (const r of confResult.records) {
      events.push({ type: 'confidence', score: r.get('score'), verdict: r.get('verdict'), timestamp: r.get('created_at') });
    }

    // Sort by timestamp
    events.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Node version history
app.get('/api/threads/:threadId/nodes/:nodeId/history', async (req, res) => {
  const nodeId = parseInt(req.params.nodeId);
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run('MATCH (n:Node {id: $id}) RETURN n.history AS history', { id: getNeo4j().int(nodeId) });
    const raw = result.records[0]?.get('history');
    res.json({ history: raw ? JSON.parse(raw) : [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Export thread
app.post('/api/threads/:threadId/export', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { format } = req.body; // 'markdown' | 'json'
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Catch-all route to handle SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// Export for Vercel serverless; also listen locally when not on Vercel
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    // Auto-setup vector indexes and backfill missing embeddings
    ensureVectorIndexes()
      .then(() => backfillEmbeddings())
      .catch(e => console.warn('Startup embedding setup:', e.message));
  });
}

module.exports = app;
