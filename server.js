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
    res.json(node);
  } catch (err) {
    await tx.rollback();
    console.error('Error creating node:', err);
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
    const node = formatNode(result.records[0].get('n').properties, null);
    res.json(node);
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
      content: `You are a research assistant helping build a knowledge graph. Be thorough and cite web sources for factual claims. Use markdown for structure. Highlight key evidence, concrete examples, and opposing viewpoints. Never open with conversational filler like "Certainly!", "Sure!", "Of course!", "I'd be happy to", or "Here is a...". Start immediately with the substantive content.${nodeContextText}`
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
  const userOpenAI = new OpenAI({ apiKey: resolvedKey, timeout: 55000 });
  const session = getDriver().session({ database: process.env.NEO4J_DATABASE });

  try {
    // ── Step 1: Fetch current thread title ───────────────────────────────
    let currentThreadTitle = '';
    if (threadId) {
      const tr = await session.run(
        'MATCH (t:Thread {id: $id}) RETURN t.title AS title',
        { id: getNeo4j().int(parseInt(threadId)) }
      );
      currentThreadTitle = tr.records[0]?.get('title') || '';
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
    "description": "Convert the COMPLETE Assistant response to HTML — preserve every heading, bullet point, bold term, and paragraph. Use <h3> for headings, <ul><li> for lists, <strong> for bold, <p> for paragraphs. Include ALL detail, do NOT shorten or omit anything."
  } | null
}
Rules:
- ALWAYS output exactly ONE ROOT node first — it represents the main idea of this exchange.
- Create ONE EVIDENCE node for EVERY web citation provided — each citation must become its own EVIDENCE node with its URL as sourceUrl and the key fact it supports as content.
- Additionally create 0-2 higher-level nodes (CONTEXT, EXAMPLE, COUNTERPOINT, or SYNTHESIS) to capture broader insights.
- All non-ROOT nodes are children of the ROOT node.
- topicShift=true only when the user clearly switches to a completely different subject.
- Do not skip citations — every URL must appear as a sourceUrl in some EVIDENCE node.
- proposedUpdate: If a currentNode was provided, generate a proposedUpdate whenever the response adds useful information about the node's topic — for follow-up questions, integrate the new details with the existingContent into a richer unified article. Only omit if the response is completely unrelated to the node. Description MUST be HTML, not markdown.`
          },
          {
            role: 'user',
            content: `${currentThreadTitle ? `Thread: "${currentThreadTitle}"\n` : ''}User: ${message}\nAssistant: ${reply.substring(0, 8000)}\nCitations (ALL must become EVIDENCE nodes): ${JSON.stringify(incomingCitations)}${nodeContext ? `\ncurrentNode: ${JSON.stringify({ title: nodeContext.title, type: nodeContext.nodeType, existingContent: (nodeContext.content || '').substring(0, 600) })}` : ''}`
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

    // ── Step 3: Persist to Neo4j ─────────────────────────────────────────
    let activeThreadId = threadId ? parseInt(threadId) : null;
    let newThread = null;

    const tx = session.beginTransaction();
    try {
      if (!activeThreadId || structure.topicShift) {
        const newId = await getNextId('thread', tx);
        const now = new Date().toISOString();
        const rawTitle = structure.threadTitle || '';
        const ttl = (rawTitle && rawTitle.toLowerCase() !== 'none' ? rawTitle : message).substring(0, 120);
        await tx.run(
          `CREATE (t:Thread {
             id: $id, title: $title, description: $desc,
             content: $content, metadata: $meta,
             created_at: $now, updated_at: $now
           })`,
          {
            id: getNeo4j().int(newId),
            title: ttl,
            desc: reply.substring(0, 500),
            content: reply.substring(0, 4000),
            meta: JSON.stringify({ title: ttl }),
            now
          }
        );
        newThread = { id: newId, title: ttl };
        activeThreadId = newId;
      }

      const createdNodes = [];
      const rootNode = structure.nodes.find(n => n.type === 'ROOT');
      const secondaryNodes = structure.nodes.filter(n => n.type !== 'ROOT').slice(0, 11);

      let rootNodeId = null;
      if (rootNode) {
        const nid = await getNextId('node', tx);
        const now = new Date().toISOString();
        const nodeContent = JSON.stringify({ title: rootNode.title, description: rootNode.content });
        await tx.run(
          `CREATE (nd:Node {
             id: $id, title: $title, content: $content,
             node_type: $type, metadata: $meta,
             created_at: $now, updated_at: $now
           })
           WITH nd
           MATCH (t:Thread {id: $tid})
           CREATE (t)-[:HAS_NODE]->(nd)`,
          {
            id: getNeo4j().int(nid),
            title: rootNode.title,
            content: nodeContent,
            type: 'ROOT',
            meta: JSON.stringify({ title: rootNode.title }),
            now,
            tid: getNeo4j().int(activeThreadId)
          }
        );
        rootNodeId = nid;
        createdNodes.push({ id: nid, title: rootNode.title, type: 'ROOT' });
      }

      for (const n of secondaryNodes) {
        const nid = await getNextId('node', tx);
        const now = new Date().toISOString();
        let nodeContent = n.content || '';
        if (n.type === 'EVIDENCE' && n.sourceUrl) {
          nodeContent = JSON.stringify({ point: n.content, source: n.sourceUrl });
        } else if (n.type === 'EXAMPLE') {
          nodeContent = JSON.stringify({ title: n.title, description: n.content });
        } else if (n.type === 'COUNTERPOINT') {
          nodeContent = JSON.stringify({ argument: n.title, explanation: n.content });
        }
        await tx.run(
          `CREATE (nd:Node {
             id: $id, title: $title, content: $content,
             node_type: $type, metadata: $meta,
             created_at: $now, updated_at: $now
           })
           WITH nd
           MATCH (t:Thread {id: $tid})
           CREATE (t)-[:HAS_NODE]->(nd)`,
          {
            id: getNeo4j().int(nid),
            title: n.title,
            content: nodeContent,
            type: n.type,
            meta: JSON.stringify({ title: n.title }),
            now,
            tid: getNeo4j().int(activeThreadId)
          }
        );
        if (rootNodeId) {
          await tx.run(
            `MATCH (p:Node {id: $parentId}), (nd:Node {id: $nodeId})
             CREATE (p)-[:PARENT_OF]->(nd)`,
            { parentId: getNeo4j().int(rootNodeId), nodeId: getNeo4j().int(nid) }
          );
        }
        createdNodes.push({ id: nid, title: n.title, type: n.type });
      }

      await tx.commit();

      const proposedUpdate = (nodeContext && structure.proposedUpdate?.description)
        ? { nodeId: nodeContext.nodeId, nodeType: nodeContext.nodeType, title: structure.proposedUpdate.title || nodeContext.title, description: structure.proposedUpdate.description }
        : null;

      res.json({ citations: incomingCitations, createdNodes, threadId: activeThreadId, newThread, proposedUpdate });
    } catch (dbErr) {
      await tx.rollback();
      throw dbErr;
    }
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

    const tx = session.beginTransaction();
    const createdNodes = [];
    const now = new Date().toISOString();
    try {
      for (const cp of counterpoints) {
        const nodeId = await getNextId('Node', tx);
        const content = JSON.stringify({ argument: cp.argument, explanation: cp.explanation });
        await tx.run(
          `CREATE (n:Node {id:$id, title:$title, content:$content, node_type:'COUNTERPOINT', created_at:$now, updated_at:$now, metadata:'{}'})`,
          { id: getNeo4j().int(nodeId), title: cp.argument, content, now }
        );
        await tx.run(
          `MATCH (t:Thread {id:$tid}),(n:Node {id:$nid}) CREATE (t)-[:HAS_NODE]->(n)`,
          { tid: getNeo4j().int(threadId), nid: getNeo4j().int(nodeId) }
        );
        await tx.run(
          `MATCH (r:Node {id:$rid}),(n:Node {id:$nid}) CREATE (r)-[:PARENT_OF]->(n)`,
          { rid: getNeo4j().int(targetNode.id), nid: getNeo4j().int(nodeId) }
        );
        createdNodes.push(formatNode({ id: nodeId, title: cp.argument, content, node_type: 'COUNTERPOINT', created_at: now, updated_at: now, metadata: '{}' }, targetNode.id));
      }
      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }

    res.json({ createdNodes });
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
    const now = new Date().toISOString();

    const tx = session.beginTransaction();
    try {
      const newId = await getNextId('Node', tx);
      await tx.run(
        `CREATE (n:Node {id:$id, title:$title, content:$content, node_type:'COUNTERPOINT', created_at:$now, updated_at:$now, metadata:'{}'})`,
        { id: getNeo4j().int(newId), title: steelTitle, content: steelContent, now }
      );
      await tx.run(
        `MATCH (t:Thread {id:$tid}),(n:Node {id:$nid}) CREATE (t)-[:HAS_NODE]->(n)`,
        { tid: getNeo4j().int(threadId), nid: getNeo4j().int(newId) }
      );
      if (parentId) {
        await tx.run(
          `MATCH (p:Node {id:$pid}),(n:Node {id:$nid}) CREATE (p)-[:PARENT_OF]->(n)`,
          { pid: getNeo4j().int(parentId), nid: getNeo4j().int(newId) }
        );
      }
      await tx.commit();
      res.json({ node: formatNode({ id: newId, title: steelTitle, content: steelContent, node_type: 'COUNTERPOINT', created_at: now, updated_at: now, metadata: '{}' }, parentId) });
    } catch (e) { await tx.rollback(); throw e; }
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

// Catch-all route to handle SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// Export for Vercel serverless; also listen locally when not on Vercel
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = app;
