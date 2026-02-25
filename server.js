require('dotenv').config();
const express = require('express');
const neo4j = require('neo4j-driver');
const cors = require('cors');
const OpenAI = require('openai');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

// OpenAI configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 50000,
});

// Timeout middleware for AI operations
const aiTimeout = (req, res, next) => {
  res.setTimeout(50000, () => {
    res.status(504).send('Request timeout');
  });
  next();
};

// Neo4j connection
const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Apply timeout middleware to AI routes
app.use(['/api/nodes/suggest', '/api/threads/generate', '/api/chat'], aiTimeout);

// Serve static files from the ./dist directory
const staticDir = path.join(__dirname, 'dist');
app.use(express.static(staticDir));

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
  if (neo4j.isInt(val)) return val.toNumber();
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Thread endpoints
app.get('/api/threads', async (req, res) => {
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
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

app.post('/api/threads', async (req, res) => {
  const { title, description, content, metadata } = req.body;
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
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
      { id: neo4j.int(id), title, description: description || '', content: content || '', metadata: metaStr, now }
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
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
  try {
    const nodesResult = await session.run(
      `MATCH (t:Thread {id: $threadId})-[:HAS_NODE]->(n:Node)
       OPTIONAL MATCH (parent:Node)-[:PARENT_OF]->(n)
       RETURN n, parent.id AS parent_id
       ORDER BY n.created_at`,
      { threadId: neo4j.int(threadId) }
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
      { threadId: neo4j.int(threadId) }
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

app.post('/api/threads/:threadId/nodes', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { title, content, nodeType, parentId, metadata } = req.body;
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
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
      { id: neo4j.int(id), title, content: content || '', nodeType: normalizedNodeType, metadata: metaStr, now }
    );

    // Link to thread
    await tx.run(
      `MATCH (t:Thread {id: $threadId}), (n:Node {id: $nodeId})
       CREATE (t)-[:HAS_NODE]->(n)`,
      { threadId: neo4j.int(threadId), nodeId: neo4j.int(id) }
    );

    // Link to parent if provided
    let resolvedParentId = null;
    if (parentId) {
      await tx.run(
        `MATCH (p:Node {id: $parentId}), (n:Node {id: $nodeId})
         CREATE (p)-[:PARENT_OF]->(n)`,
        { parentId: neo4j.int(parentId), nodeId: neo4j.int(id) }
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
app.put('/api/threads/:threadId/nodes/:nodeId', async (req, res) => {
  const nodeId = parseInt(req.params.nodeId);
  const { title, content } = req.body;
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
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
      { nodeId: neo4j.int(nodeId), title, content: content || '', metadata: metaStr, now }
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
app.post('/api/edges', async (req, res) => {
  const { sourceId, targetId } = req.body;
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run(
      `MATCH (a:Node {id: $src}), (b:Node {id: $tgt})
       CREATE (a)-[:PARENT_OF]->(b)`,
      { src: neo4j.int(sourceId), tgt: neo4j.int(targetId) }
    );
    res.json({ source_id: sourceId, target_id: targetId, relationship_type: 'parent-child' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Thread layout endpoints
app.put('/api/threads/:threadId/layout', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { layout } = req.body;
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run(
      `MATCH (t:Thread {id: $threadId})
       SET t.layout = $layout`,
      { threadId: neo4j.int(threadId), layout: JSON.stringify(layout) }
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
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      'MATCH (t:Thread {id: $threadId}) RETURN t.layout AS layout',
      { threadId: neo4j.int(threadId) }
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

app.delete('/api/threads/:threadId/layout', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run(
      'MATCH (t:Thread {id: $threadId}) REMOVE t.layout',
      { threadId: neo4j.int(threadId) }
    );
    res.json({});
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Thread canvas endpoints
app.put('/api/threads/:threadId/canvas', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { canvas } = req.body;
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run(
      `MATCH (t:Thread {id: $threadId})
       SET t.canvas = $canvas`,
      { threadId: neo4j.int(threadId), canvas: JSON.stringify(canvas) }
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
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      'MATCH (t:Thread {id: $threadId}) RETURN t.canvas AS canvas',
      { threadId: neo4j.int(threadId) }
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

app.delete('/api/threads/:threadId/canvas', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run(
      'MATCH (t:Thread {id: $threadId}) REMOVE t.canvas',
      { threadId: neo4j.int(threadId) }
    );
    res.json({});
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Update thread content
app.put('/api/threads/:threadId/content', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { content } = req.body;
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
  try {
    const now = new Date().toISOString();
    const result = await session.run(
      `MATCH (t:Thread {id: $threadId})
       SET t.content = $content, t.updated_at = $now
       RETURN t`,
      { threadId: neo4j.int(threadId), content: content || '', now }
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
app.put('/api/threads/:threadId/sequence', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const { sequence } = req.body;
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run(
      `MATCH (t:Thread {id: $threadId})
       SET t.article_sequence = $sequence`,
      { threadId: neo4j.int(threadId), sequence: JSON.stringify(sequence) }
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
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
  try {
    const result = await session.run(
      'MATCH (t:Thread {id: $threadId}) RETURN t.article_sequence AS sequence',
      { threadId: neo4j.int(threadId) }
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

app.delete('/api/threads/:threadId/sequence', async (req, res) => {
  const threadId = parseInt(req.params.threadId);
  const session = driver.session({ database: process.env.NEO4J_DATABASE });
  try {
    await session.run(
      'MATCH (t:Thread {id: $threadId}) REMOVE t.article_sequence',
      { threadId: neo4j.int(threadId) }
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

  const session = driver.session({ database: process.env.NEO4J_DATABASE });
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
app.post('/api/threads/generate', async (req, res) => {
  const { topic } = req.body;
  if (!topic) {
    return res.status(400).json({ error: 'Topic is required' });
  }

  const session = driver.session({ database: process.env.NEO4J_DATABASE });
  const tx = session.beginTransaction();

  try {
    const threadResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{
        role: "system",
        content: `Create a brief knowledge thread about the given topic with:
1. A short summary (2-3 sentences)
2. One key piece of evidence with source
3. One example
4. One counterpoint
5. A brief synthesis (1-2 sentences)

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
        id: neo4j.int(threadId),
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
          id: neo4j.int(nodeId),
          title: entry.title,
          content: entry.content,
          nodeType: entry.type,
          metadata: nodeMeta,
          now,
          threadId: neo4j.int(threadId)
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
app.post('/api/nodes/suggest', async (req, res) => {
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

    const response = await openai.chat.completions.create({
      model: "gpt-4",
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

// Chat endpoint — uses the caller's OpenAI API key
app.post('/api/chat', async (req, res) => {
  const { message, history = [], threadId, apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'OpenAI API key required' });
  if (!message) return res.status(400).json({ error: 'Message required' });

  const userOpenAI = new OpenAI({ apiKey, timeout: 50000 });
  const session = driver.session({ database: process.env.NEO4J_DATABASE });

  try {
    // ── Step 1: Generate reply (web search if available, else regular chat) ──
    let reply = '';
    let citations = [];

    const systemMsg = {
      role: 'system',
      content: 'You are a research assistant helping build a knowledge graph. Be thorough and cite web sources for factual claims. Highlight key evidence, concrete examples, and opposing viewpoints.'
    };
    const inputMsgs = [
      systemMsg,
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ];

    // Try Responses API with web_search_preview
    let usedResponsesAPI = false;
    if (typeof userOpenAI.responses === 'object' && typeof userOpenAI.responses.create === 'function') {
      try {
        const searchResp = await userOpenAI.responses.create({
          model: 'gpt-4o',
          tools: [{ type: 'web_search_preview' }],
          input: inputMsgs
        });
        reply = searchResp.output_text || '';
        usedResponsesAPI = true;

        // Extract URL citations from output annotations
        for (const item of searchResp.output || []) {
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
      } catch (e) {
        console.warn('Responses API failed, falling back to chat.completions:', e.message);
      }
    }

    if (!reply) {
      const fallback = await userOpenAI.chat.completions.create({
        model: 'gpt-4o',
        messages: inputMsgs
      });
      reply = fallback.choices[0].message.content || '';
    }

    // ── Step 2: Structure extraction — what nodes to create ───────────────
    let currentThreadTitle = '';
    if (threadId) {
      const tr = await session.run(
        'MATCH (t:Thread {id: $id}) RETURN t.title AS title',
        { id: neo4j.int(parseInt(threadId)) }
      );
      currentThreadTitle = tr.records[0]?.get('title') || '';
    }

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
            content: `Extract structured knowledge nodes from a research exchange. Return JSON only with this shape:
{
  "topicShift": boolean,
  "threadTitle": "topic of current conversation",
  "nodes": [
    {
      "type": "EVIDENCE|EXAMPLE|CONTEXT|COUNTERPOINT|SYNTHESIS|REFERENCE",
      "title": "concise title (max 60 chars)",
      "content": "substantive content",
      "sourceUrl": "URL or null"
    }
  ]
}
Rules: create 1-3 nodes per exchange. topicShift=true only when the user clearly switches to a different subject. EVIDENCE=cited facts, EXAMPLE=case studies, CONTEXT=background, COUNTERPOINT=opposing views, SYNTHESIS=summaries, REFERENCE=links/resources.`
          },
          {
            role: 'user',
            content: `Current thread: "${currentThreadTitle || 'none'}"\nUser: ${message}\nAssistant: ${reply.substring(0, 1500)}\nCitations: ${JSON.stringify(citations.slice(0, 4))}`
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

    // ── Step 3: Persist to Neo4j ──────────────────────────────────────────
    let activeThreadId = threadId ? parseInt(threadId) : null;
    let newThread = null;

    const tx = session.beginTransaction();
    try {
      if (!activeThreadId || structure.topicShift) {
        const newId = await getNextId('thread', tx);
        const now = new Date().toISOString();
        const ttl = (structure.threadTitle || message).substring(0, 120);
        await tx.run(
          `CREATE (t:Thread {
             id: $id, title: $title, description: $desc,
             content: $content, metadata: $meta,
             created_at: $now, updated_at: $now
           })`,
          {
            id: neo4j.int(newId),
            title: ttl,
            desc: reply.substring(0, 255),
            content: reply.substring(0, 500),
            meta: JSON.stringify({ title: ttl }),
            now
          }
        );
        newThread = { id: newId, title: ttl };
        activeThreadId = newId;
      }

      const createdNodes = [];
      for (const n of structure.nodes.slice(0, 4)) {
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
            id: neo4j.int(nid),
            title: n.title,
            content: nodeContent,
            type: n.type,
            meta: JSON.stringify({ title: n.title }),
            now,
            tid: neo4j.int(activeThreadId)
          }
        );
        createdNodes.push({ id: nid, title: n.title, type: n.type });
      }

      await tx.commit();
      res.json({ reply, citations, createdNodes, threadId: activeThreadId, newThread });
    } catch (dbErr) {
      await tx.rollback();
      throw dbErr;
    }
  } catch (err) {
    console.error('Chat endpoint error:', err);
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
