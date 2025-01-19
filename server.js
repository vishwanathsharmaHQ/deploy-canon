require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const OpenAI = require('openai');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

// OpenAI configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 50000, // 50 second timeout
});

// Timeout middleware for AI operations
const aiTimeout = (req, res, next) => {
  res.setTimeout(50000, () => {
    res.status(504).send('Request timeout');
  });
  next();
};

// Database connection
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

app.use(cors());
app.use(express.json());

// Apply timeout middleware to AI routes
app.use(['/api/nodes/suggest', '/api/threads/generate'], aiTimeout);

// Serve static files from the ./dist directory
const staticDir = path.join(__dirname, 'dist');
app.use(express.static(staticDir));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Thread endpoints
app.get('/api/threads', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, title, description, content, metadata, created_at, updated_at FROM threads ORDER BY created_at DESC'
    );

    const threads = result.rows.map(thread => ({
      ...thread,
      metadata: {
        title: thread.title,
        description: thread.description,
        ...thread.metadata
      },
      nodes: []
    }));

    res.json(threads);
  } catch (err) {
    console.error('Error fetching threads:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/threads', async (req, res) => {
  const { title, description, content, metadata } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO threads (title, description, content, metadata) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, title, description, content, metadata, created_at, updated_at`,
      [title, description, content, {
        title,
        description,
        content,
        ...metadata
      }]
    );

    const thread = {
      ...result.rows[0],
      metadata: {
        title: result.rows[0].title,
        description: result.rows[0].description,
        ...result.rows[0].metadata
      },
      nodes: []
    };

    res.json(thread);
  } catch (err) {
    console.error('Error creating thread:', err);
    res.status(500).json({ error: err.message });
  }
});

// Node endpoints
app.get('/api/threads/:threadId/nodes', async (req, res) => {
  const { threadId } = req.params;
  try {
    const nodesResult = await pool.query(
      `SELECT id, title, content, node_type, parent_id, metadata, created_at, updated_at 
       FROM nodes 
       WHERE thread_id = $1 
       ORDER BY created_at`,
      [threadId]
    );

    const edgesResult = await pool.query(
      `SELECT e.* FROM edges e
       INNER JOIN nodes n1 ON e.source_id = n1.id
       WHERE n1.thread_id = $1`,
      [threadId]
    );

    const nodes = nodesResult.rows.map(node => ({
      ...node,
      metadata: {
        title: node.title,
        description: node.content?.substring(0, 100),
        ...node.metadata
      },
      type: ['EVIDENCE', 'REFERENCE', 'CONTEXT', 'EXAMPLE', 'COUNTERPOINT', 'SYNTHESIS'].indexOf(node.node_type)
    }));

    res.json({
      nodes,
      edges: edgesResult.rows
    });
  } catch (err) {
    console.error('Error fetching nodes:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/threads/:threadId/nodes', async (req, res) => {
  const { threadId } = req.params;
  const { title, content, nodeType, parentId, metadata } = req.body;

  try {
    await pool.query('BEGIN');

    const normalizedNodeType = typeof nodeType === 'number' ? 
      ['EVIDENCE', 'REFERENCE', 'CONTEXT', 'EXAMPLE', 'COUNTERPOINT', 'SYNTHESIS'][nodeType] : 
      nodeType;

    const nodeResult = await pool.query(
      `INSERT INTO nodes (thread_id, title, content, node_type, parent_id, metadata) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, title, content, node_type, parent_id, metadata, created_at, updated_at`,
      [threadId, title, content, normalizedNodeType, parentId, {
        title,
        description: content?.substring(0, 100),
        ...metadata
      }]
    );

    const node = {
      ...nodeResult.rows[0],
      metadata: {
        title: nodeResult.rows[0].title,
        description: nodeResult.rows[0].content?.substring(0, 100),
        ...nodeResult.rows[0].metadata
      },
      type: ['EVIDENCE', 'REFERENCE', 'CONTEXT', 'EXAMPLE', 'COUNTERPOINT', 'SYNTHESIS'].indexOf(nodeResult.rows[0].node_type)
    };

    if (parentId) {
      await pool.query(
        'INSERT INTO edges (source_id, target_id, relationship_type) VALUES ($1, $2, $3)',
        [parentId, node.id, 'parent-child']
      );
    }

    await pool.query('COMMIT');
    res.json(node);
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error creating node:', err);
    res.status(500).json({ error: err.message });
  }
});

// Edge endpoints
app.post('/api/edges', async (req, res) => {
  const { sourceId, targetId, relationshipType, metadata } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO edges (source_id, target_id, relationship_type, metadata) VALUES ($1, $2, $3, $4) RETURNING *',
      [sourceId, targetId, relationshipType, metadata]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Thread layout endpoints
app.put('/api/threads/:threadId/layout', async (req, res) => {
  const { threadId } = req.params;
  const { layout } = req.body;
  try {
    const result = await pool.query(
      `UPDATE threads 
       SET metadata = jsonb_set(
         COALESCE(metadata, '{}'::jsonb),
         '{layout}',
         $1::jsonb
       )
       WHERE id = $2
       RETURNING metadata`,
      [JSON.stringify(layout), threadId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/threads/:threadId/layout', async (req, res) => {
  const { threadId } = req.params;
  try {
    const result = await pool.query(
      'SELECT metadata->\'layout\' as layout FROM threads WHERE id = $1',
      [threadId]
    );

    const layout = result.rows[0]?.layout ? JSON.parse(result.rows[0].layout) : null;
    res.json(layout);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/threads/:threadId/layout', async (req, res) => {
  const { threadId } = req.params;
  try {
    const result = await pool.query(
      `UPDATE threads 
       SET metadata = metadata - 'layout'
       WHERE id = $1
       RETURNING metadata`,
      [threadId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search threads endpoint
app.get('/api/threads/search', async (req, res) => {
  const { query } = req.query;
  if (!query) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  try {
    const result = await pool.query(
      `SELECT id, title, description, content, metadata, created_at, updated_at 
       FROM threads 
       WHERE is_on_chain = false AND 
       (title ILIKE $1 OR description ILIKE $1 OR content ILIKE $1)
       ORDER BY created_at DESC`,
      [`%${query}%`]
    );

    const threads = result.rows.map(thread => ({
      ...thread,
      metadata: {
        title: thread.title,
        description: thread.description,
        ...thread.metadata
      },
      nodes: []
    }));

    res.json(threads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create thread with GPT endpoint
app.post('/api/threads/generate', async (req, res) => {
  const { topic } = req.body;
  if (!topic) {
    return res.status(400).json({ error: 'Topic is required' });
  }

  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Request timeout')), 50000)
  );

  try {
    const threadResponse = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-4",
        messages: [{
          role: "system",
          content: `You are a knowledgeable assistant that creates comprehensive knowledge threads. For the given topic, generate:
1. A detailed summary (2-3 paragraphs)
2. Multiple pieces of evidence (at least 3, each with source)
3. Context information that helps understand the topic better
4. Concrete examples that illustrate the topic
5. Important counterpoints or alternative viewpoints
6. A synthesis that ties everything together

Format your response as a JSON object with these fields:
{
  "summary": "detailed summary here",
  "evidence": [
    {"point": "evidence point", "source": "academic source"},
    ...
  ],
  "context": "detailed contextual information",
  "examples": [
    {"title": "example title", "description": "detailed example description"},
    ...
  ],
  "counterpoints": [
    {"argument": "counterpoint", "explanation": "detailed explanation"},
    ...
  ],
  "synthesis": "comprehensive synthesis"
}`
        }, {
          role: "user",
          content: `Create a comprehensive knowledge thread about: ${topic}`
        }],
        temperature: 0.7,
      }),
      timeoutPromise
    ]);

    const gptContent = JSON.parse(threadResponse.choices[0].message.content);

    const threadResult = await pool.query(
      `INSERT INTO threads (title, description, content, metadata, is_on_chain) 
       VALUES ($1, $2, $3, $4, false) 
       RETURNING id, title, description, content, metadata, created_at, updated_at`,
      [topic, gptContent.summary.substring(0, 255), gptContent.summary, {
        title: topic,
        description: gptContent.summary.substring(0, 255)
      }]
    );

    const thread = threadResult.rows[0];

    const summaryNode = await pool.query(
      `INSERT INTO nodes (thread_id, title, content, node_type, metadata) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id`,
      [thread.id, 'Summary', gptContent.summary, 'SYNTHESIS', { title: 'Summary' }]
    );

    for (const evidence of gptContent.evidence) {
      await pool.query(
        `INSERT INTO nodes (thread_id, title, content, node_type, metadata) 
         VALUES ($1, $2, $3, $4, $5)`,
        [thread.id, evidence.source, JSON.stringify(evidence), 'EVIDENCE', { title: evidence.source }]
      );
    }

    const contextNode = await pool.query(
      `INSERT INTO nodes (thread_id, title, content, node_type, metadata) 
       VALUES ($1, $2, $3, $4, $5)`,
      [thread.id, 'Context', gptContent.context, 'CONTEXT', { title: 'Context' }]
    );

    for (const example of gptContent.examples) {
      await pool.query(
        `INSERT INTO nodes (thread_id, title, content, node_type, metadata) 
         VALUES ($1, $2, $3, $4, $5)`,
        [thread.id, example.title, JSON.stringify(example), 'EXAMPLE', { title: example.title }]
      );
    }

    for (const counterpoint of gptContent.counterpoints) {
      await pool.query(
        `INSERT INTO nodes (thread_id, title, content, node_type, metadata) 
         VALUES ($1, $2, $3, $4, $5)`,
        [thread.id, counterpoint.argument, JSON.stringify(counterpoint), 'COUNTERPOINT', { title: counterpoint.argument }]
      );
    }

    const synthesisNode = await pool.query(
      `INSERT INTO nodes (thread_id, title, content, node_type, metadata) 
       VALUES ($1, $2, $3, $4, $5)`,
      [thread.id, 'Synthesis', gptContent.synthesis, 'SYNTHESIS', { title: 'Synthesis' }]
    );

    res.json({
      ...thread,
      metadata: {
        title: thread.title,
        description: thread.description,
        ...thread.metadata
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Node suggestion endpoint
app.post('/api/nodes/suggest', async (req, res) => {
  const { nodeId, nodeType, content, title } = req.body;

  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Request timeout')), 50000)
  );

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

    const response = await Promise.race([
      openai.chat.completions.create({
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
      }),
      timeoutPromise
    ]);

    const suggestions = JSON.parse(response.choices[0].message.content);

    res.json({ suggestions });
  } catch (err) {
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
