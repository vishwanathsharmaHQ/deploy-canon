require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

// Database connection
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Serve static files from the frontend build directory
app.use(express.static(path.join(__dirname, '../frontend/dist')));

app.use(cors());
app.use(express.json());

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
  
  try {
    await pool.query('BEGIN');
    
    // Ensure nodeType is a string
    const normalizedNodeType = typeof nodeType === 'number' ? 
      ['EVIDENCE', 'REFERENCE', 'CONTEXT', 'EXAMPLE', 'COUNTERPOINT', 'SYNTHESIS'][nodeType] : 
      nodeType;

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

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 