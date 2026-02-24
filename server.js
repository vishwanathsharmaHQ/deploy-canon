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
app.use(express.json());

// Apply timeout middleware to AI routes
app.use(['/api/nodes/suggest', '/api/threads/generate'], aiTimeout);

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

// Catch-all route to handle SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
