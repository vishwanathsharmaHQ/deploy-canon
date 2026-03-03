require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { getDriver } = require('./db/driver');
const { errorHandler } = require('./middleware/errorHandler');
const { ensureVectorIndexes, backfillEmbeddings } = require('./services/embeddings');

const app = express();

// ── Core middleware ──────────────────────────────────────────────────────────
app.use(cors(config.server.corsOrigins ? { origin: config.server.corsOrigins } : undefined));
app.use(express.json({ limit: config.server.jsonLimit }));

// Serve static files from the ./dist directory
const staticDir = path.join(__dirname, '..', 'dist');
app.use(express.static(staticDir));

// Catch init errors on first API call so we see the real message
app.use('/api', (req, res, next) => {
  try { getDriver(); } catch (e) {
    return res.status(500).json({ initError: e.message });
  }
  next();
});

// ── API routes ──────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/threads', require('./routes/threads'));
app.use('/api', require('./routes/nodes'));          // /api/threads/:threadId/nodes + /api/nodes/suggest
app.use('/api/edges', require('./routes/edges'));
app.use('/api/threads', require('./routes/layout')); // /api/threads/:threadId/layout, canvas, sequence, content
app.use('/api', require('./routes/chat'));            // /api/chat, /api/socratic, /api/threads/:id/chats, etc.
app.use('/api/search', require('./routes/search'));
app.use('/api/review', require('./routes/review'));
app.use('/api/ingest', require('./routes/ingest'));
app.use('/api/links', require('./routes/links'));
app.use('/api/graph', require('./routes/graph'));
app.use('/api/threads', require('./routes/snapshots')); // /api/threads/:threadId/snapshots, confidence, timeline, export

// ── Global error handler ────────────────────────────────────────────────────
app.use(errorHandler);

// ── SPA catch-all ───────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// ── Start server ────────────────────────────────────────────────────────────
if (!process.env.VERCEL) {
  const port = config.server.port;
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    ensureVectorIndexes()
      .then(() => backfillEmbeddings())
      .catch(e => console.warn('Startup embedding setup:', e.message));
  });
}

module.exports = app;
