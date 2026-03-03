import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import { getDriver } from './db/driver.js';
import { errorHandler } from './middleware/errorHandler.js';
import { ensureVectorIndexes, backfillEmbeddings } from './services/embeddings.js';

import authRoutes from './routes/auth.js';
import threadRoutes from './routes/threads.js';
import nodeRoutes from './routes/nodes.js';
import edgeRoutes from './routes/edges.js';
import layoutRoutes from './routes/layout.js';
import chatRoutes from './routes/chat.js';
import searchRoutes from './routes/search.js';
import reviewRoutes from './routes/review.js';
import ingestRoutes from './routes/ingest.js';
import linkRoutes from './routes/links.js';
import graphRoutes from './routes/graph.js';
import snapshotRoutes from './routes/snapshots.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// ── Core middleware ──────────────────────────────────────────────────────────
app.use(cors(config.server.corsOrigins ? { origin: config.server.corsOrigins } : undefined));
app.use(express.json({ limit: config.server.jsonLimit }));

// Serve static files from the ./dist directory
const staticDir = path.join(__dirname, '..', 'dist');
app.use(express.static(staticDir));

// Catch init errors on first API call so we see the real message
app.use('/api', (req, res, next) => {
  try { getDriver(); } catch (e: unknown) {
    return res.status(500).json({ initError: (e as Error).message });
  }
  next();
});

// ── API routes ──────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/threads', threadRoutes);
app.use('/api', nodeRoutes);          // /api/threads/:threadId/nodes + /api/nodes/suggest
app.use('/api/edges', edgeRoutes);
app.use('/api/threads', layoutRoutes); // /api/threads/:threadId/layout, canvas, sequence, content
app.use('/api', chatRoutes);            // /api/chat, /api/socratic, /api/threads/:id/chats, etc.
app.use('/api/search', searchRoutes);
app.use('/api/review', reviewRoutes);
app.use('/api/ingest', ingestRoutes);
app.use('/api/links', linkRoutes);
app.use('/api/graph', graphRoutes);
app.use('/api/threads', snapshotRoutes); // /api/threads/:threadId/snapshots, confidence, timeline, export

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

export default app;
