const router = require('express').Router();
const { getNeo4j, toNum } = require('../db/driver');
const { getNextId } = require('../db/queries');
const { requireAuth } = require('../middleware/auth');
const { withSession } = require('../middleware/session');
const { aiTimeout } = require('../middleware/aiTimeout');
const { getOpenAI } = require('../services/openai');

// URL ingestion
router.post('/url', requireAuth, aiTimeout, async (req, res, next) => {
  const { url, threadId } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
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

    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : url;

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
        { role: 'user', content: `Extract knowledge from:\nURL: ${url}\nTitle: ${pageTitle}\n\nContent:\n${text}` },
      ],
    });
    const extracted = JSON.parse(completion.choices[0].message.content);

    const proposedNodes = (extracted.nodes || []).map(n => {
      let nodeContent = n.content || '';
      if (n.type === 'EVIDENCE' && n.sourceUrl) nodeContent = JSON.stringify({ point: n.content, source: n.sourceUrl });
      else if (n.type === 'EXAMPLE') nodeContent = JSON.stringify({ title: n.title, description: n.content });
      else if (n.type === 'COUNTERPOINT') nodeContent = JSON.stringify({ argument: n.title, explanation: n.content });
      else if (n.type === 'ROOT') nodeContent = JSON.stringify({ title: n.title, description: n.content });
      return { title: n.title, type: n.type, content: nodeContent };
    });

    res.json({ title: extracted.title || pageTitle, summary: extracted.summary || '', sourceUrl: url, proposedNodes, threadId: threadId || null });
  } catch (err) {
    next(err);
  }
});

// PDF ingestion
router.post('/pdf', requireAuth, aiTimeout, async (req, res, next) => {
  try {
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
        { role: 'user', content: `Extract knowledge from PDF "${filename || 'document'}":\n\n${text}` },
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
    next(err);
  }
});

// Bookmarks CRUD
router.get('/bookmarks', requireAuth, withSession(async (req, res) => {
  const result = await req.neo4jSession.run(`MATCH (b:Bookmark) RETURN b ORDER BY b.created_at DESC`);
  const bookmarks = result.records.map(r => {
    const p = r.get('b').properties;
    return { id: toNum(p.id), url: p.url, title: p.title, notes: p.notes, status: p.status, source_type: p.source_type, created_at: p.created_at };
  });
  res.json(bookmarks);
}));

router.post('/bookmarks', requireAuth, withSession(async (req, res) => {
  const { url, title, notes, source_type } = req.body;
  const session = req.neo4jSession;
  const id = await getNextId('bookmark', session);
  const now = new Date().toISOString();
  await session.run(
    `CREATE (b:Bookmark {id: $id, url: $url, title: $title, notes: $notes, status: 'unread', source_type: $type, created_at: $now})`,
    { id: getNeo4j().int(id), url: url || '', title: title || url || '', notes: notes || '', type: source_type || 'url', now }
  );
  res.json({ id, url, title: title || url, notes, status: 'unread', source_type: source_type || 'url', created_at: now });
}));

router.put('/bookmarks/:id', requireAuth, withSession(async (req, res) => {
  const bookmarkId = parseInt(req.params.id);
  const { status, notes, title } = req.body;
  const sets = [];
  const params = { id: getNeo4j().int(bookmarkId) };
  if (status !== undefined) { sets.push('b.status = $status'); params.status = status; }
  if (notes !== undefined) { sets.push('b.notes = $notes'); params.notes = notes; }
  if (title !== undefined) { sets.push('b.title = $title'); params.title = title; }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  await req.neo4jSession.run(`MATCH (b:Bookmark {id: $id}) SET ${sets.join(', ')}`, params);
  res.json({ ok: true });
}));

router.delete('/bookmarks/:id', requireAuth, withSession(async (req, res) => {
  const bookmarkId = parseInt(req.params.id);
  await req.neo4jSession.run('MATCH (b:Bookmark {id: $id}) DELETE b', { id: getNeo4j().int(bookmarkId) });
  res.json({ ok: true });
}));

module.exports = router;
