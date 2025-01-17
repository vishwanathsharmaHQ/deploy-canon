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
  apiKey: process.env.OPENAI_API_KEY
});

// Database connection
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// CORS configuration
const corsOptions = {
  origin: 'https://www.canonthread.com',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

// Serve static files from the frontend build directory
app.use(express.static(path.join(__dirname, '../frontend/dist')));

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
    
    // Format each thread with proper metadata structure
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
    
    // Format the response to match the expected structure
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

    // Format nodes to match the expected structure
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
  
  console.log('Received node creation request:', {
    threadId,
    title,
    content,
    nodeType,
    parentId,
    metadata
  });
  
  try {
    await pool.query('BEGIN');
    
    // Ensure nodeType is a string
    const normalizedNodeType = typeof nodeType === 'number' ? 
      ['EVIDENCE', 'REFERENCE', 'CONTEXT', 'EXAMPLE', 'COUNTERPOINT', 'SYNTHESIS'][nodeType] : 
      nodeType;

    console.log('Creating node with normalized type:', normalizedNodeType);
    console.log('Content to be stored:', content);
    console.log('Content type:', typeof content);

    // Create the node with proper metadata
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
    
    console.log('Node created in database:', nodeResult.rows[0]);
    console.log('Stored content:', nodeResult.rows[0].content);
    
    // Format the node to match expected structure
    const node = {
      ...nodeResult.rows[0],
      metadata: {
        title: nodeResult.rows[0].title,
        description: nodeResult.rows[0].content?.substring(0, 100),
        ...nodeResult.rows[0].metadata
      },
      type: ['EVIDENCE', 'REFERENCE', 'CONTEXT', 'EXAMPLE', 'COUNTERPOINT', 'SYNTHESIS'].indexOf(nodeResult.rows[0].node_type)
    };
    
    console.log('Formatted node response:', node);
    console.log('Final content in response:', node.content);
    
    // If there's a parent node, create an edge
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
  
  console.log('Saving layout for thread:', threadId);
  console.log('Layout data:', layout);
  
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
    
    console.log('Layout saved in database:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error saving thread layout:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/threads/:threadId/layout', async (req, res) => {
  const { threadId } = req.params;
  
  console.log('Loading layout for thread:', threadId);
  
  try {
    const result = await pool.query(
      'SELECT metadata->>\'layout\' as layout FROM threads WHERE id = $1',
      [threadId]
    );
    
    const layout = result.rows[0]?.layout ? JSON.parse(result.rows[0].layout) : null;
    console.log('Loaded layout from database:', layout);
    
    res.json(layout);
  } catch (err) {
    console.error('Error fetching thread layout:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/threads/:threadId/layout', async (req, res) => {
  const { threadId } = req.params;
  
  console.log('Deleting layout for thread:', threadId);
  
  try {
    const result = await pool.query(
      `UPDATE threads 
       SET metadata = metadata - 'layout'
       WHERE id = $1
       RETURNING metadata`,
      [threadId]
    );
    
    console.log('Layout deleted from database:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error deleting thread layout:', err);
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
    console.error('Error searching threads:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create thread with GPT endpoint
app.post('/api/threads/generate', async (req, res) => {
  const { topic } = req.body;
  if (!topic) {
    return res.status(400).json({ error: 'Topic is required' });
  }

  try {
    console.log('Generating content for topic:', topic);
    // Generate thread content using GPT
    const threadResponse = await openai.chat.completions.create({
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
    });

    console.log('Received GPT response');
    const gptContent = JSON.parse(threadResponse.choices[0].message.content);
    console.log('Parsed GPT content:', JSON.stringify(gptContent, null, 2));

    // Create the main thread
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
    console.log('Created thread:', thread);

    // Create the main summary node
    const summaryNode = await pool.query(
      `INSERT INTO nodes (thread_id, title, content, node_type, metadata) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id`,
      [thread.id, 'Summary', gptContent.summary, 'SYNTHESIS', { title: 'Summary' }]
    );
    console.log('Created summary node:', summaryNode.rows[0]);

    // Create evidence nodes
    console.log('Creating evidence nodes:', gptContent.evidence);
    for (const evidence of gptContent.evidence) {
      const evidenceNode = await pool.query(
        `INSERT INTO nodes (thread_id, title, content, node_type, metadata) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id, content`,
        [thread.id, evidence.source, JSON.stringify(evidence), 'EVIDENCE', { title: evidence.source }]
      );
      console.log('Created evidence node:', evidenceNode.rows[0]);
    }

    // Create context node
    console.log('Creating context node with content:', gptContent.context);
    const contextNode = await pool.query(
      `INSERT INTO nodes (thread_id, title, content, node_type, metadata) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, content`,
      [thread.id, 'Context', gptContent.context, 'CONTEXT', { title: 'Context' }]
    );
    console.log('Created context node:', contextNode.rows[0]);

    // Create example nodes
    console.log('Creating example nodes:', gptContent.examples);
    for (const example of gptContent.examples) {
      const exampleNode = await pool.query(
        `INSERT INTO nodes (thread_id, title, content, node_type, metadata) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id, content`,
        [thread.id, example.title, JSON.stringify(example), 'EXAMPLE', { title: example.title }]
      );
      console.log('Created example node:', exampleNode.rows[0]);
    }

    // Create counterpoint nodes
    console.log('Creating counterpoint nodes:', gptContent.counterpoints);
    for (const counterpoint of gptContent.counterpoints) {
      const counterpointNode = await pool.query(
        `INSERT INTO nodes (thread_id, title, content, node_type, metadata) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id, content`,
        [thread.id, counterpoint.argument, JSON.stringify(counterpoint), 'COUNTERPOINT', { title: counterpoint.argument }]
      );
      console.log('Created counterpoint node:', counterpointNode.rows[0]);
    }

    // Create synthesis node
    console.log('Creating synthesis node with content:', gptContent.synthesis);
    const synthesisNode = await pool.query(
      `INSERT INTO nodes (thread_id, title, content, node_type, metadata) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, content`,
      [thread.id, 'Synthesis', gptContent.synthesis, 'SYNTHESIS', { title: 'Synthesis' }]
    );
    console.log('Created synthesis node:', synthesisNode.rows[0]);

    res.json({
      ...thread,
      metadata: {
        title: thread.title,
        description: thread.description,
        ...thread.metadata
      }
    });
  } catch (err) {
    console.error('Error generating thread:', err);
    res.status(500).json({ error: err.message });
  }
});

// Node suggestion endpoint
app.post('/api/nodes/suggest', async (req, res) => {
  const { nodeId, nodeType, content, title } = req.body;
  
  try {
    console.log('Generating suggestions for:', { nodeId, nodeType, content, title });

    // Parse content if it's a JSON string
    let nodeContent = content;
    if (typeof content === 'string' && (content.startsWith('{') || content.startsWith('['))) {
      try {
        nodeContent = JSON.parse(content);
      } catch (e) {
        console.log('Failed to parse content as JSON:', e);
      }
    }

    // Extract the actual content based on node type
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

    // Generate suggestions using GPT
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
    
    // Format each suggestion based on its type
    const formattedSuggestions = suggestions.map(suggestion => {
      if (['EVIDENCE', 'EXAMPLE', 'COUNTERPOINT'].includes(suggestion.type)) {
        // These types need structured content
        return {
          ...suggestion,
          content: typeof suggestion.content === 'string' ? 
            suggestion.content : 
            JSON.stringify(suggestion.content)
        };
      }
      return suggestion;
    });

    console.log('Generated suggestions:', formattedSuggestions);
    res.json({ suggestions: formattedSuggestions });
  } catch (err) {
    console.error('Error generating suggestions:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend for any other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 