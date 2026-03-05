import { Router } from 'express';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import config from '../config.js';
import { getNeo4j, toNum, getSession } from '../db/driver.js';
import { getNextId, formatThread, formatNode, NODE_TYPES } from '../db/queries.js';
import { requireAuth } from '../middleware/auth.js';
import { withSession } from '../middleware/session.js';
import { aiTimeout } from '../middleware/aiTimeout.js';
import { getOpenAI } from '../services/openai.js';
import { extractContentText } from '../services/contentParser.js';
import type { ExtractionResult, ProposedNode, ChatMessage } from '../types/domain.js';

const router = Router();

/* ──────────────────────────────────────────────────────────────────────────────
   POST /chat — SSE streaming chat with OpenAI (Responses API with web_search
   fallback to chat.completions)
   ────────────────────────────────────────────────────────────────────────────── */
router.post('/chat', requireAuth, async (req, res) => {
  const { message, history = [], threadId, apiKey, nodeContext } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  // ── SSE setup ──────────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let _streamClosed = false;
  const send = (obj: Record<string, unknown>) => {
    if (!_streamClosed) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };
  const closeStream = () => {
    if (!_streamClosed) {
      _streamClosed = true;
      res.end();
    }
  };

  try {
    // Fresh OpenAI client — user-supplied key or env fallback
    const client = new OpenAI({
      apiKey: apiKey || config.openai.apiKey,
      timeout: config.openai.timeout,
    });

    const model = config.openai.chatModel;

    // Build messages array for the LLM
    // Detect context type: node-specific vs thread-level
    const isNodeSpecific = nodeContext && typeof nodeContext === 'object' && 'nodeId' in nodeContext;
    const isThreadLevel = nodeContext && typeof nodeContext === 'object' && 'threadTitle' in nodeContext;

    let systemPrompt =
      'You are a research assistant. Provide thorough, well-sourced answers. ' +
      'When citing web sources, include the URL. Use markdown formatting.';

    // Enhance system prompt with thread/node awareness
    if (isThreadLevel) {
      const ctx = nodeContext as Record<string, unknown>;
      systemPrompt += `\n\nYou are currently helping the user explore the thread "${ctx.threadTitle}".`;
      if (ctx.threadDescription) systemPrompt += ` Thread description: ${ctx.threadDescription}.`;
      if (ctx.threadType && ctx.threadType !== 'standard') systemPrompt += ` This is a ${ctx.threadType} thread.`;
      if (ctx.nodesSummary) systemPrompt += `\nExisting knowledge nodes: ${ctx.nodesSummary}`;
      systemPrompt += '\n\nWhen the user says "this" or "it", they are referring to this thread topic. Provide relevant, in-depth information about the thread subject.';
    } else if (isNodeSpecific) {
      const ctx = nodeContext as Record<string, unknown>;
      systemPrompt += `\n\nThe user is currently viewing the node "${ctx.title}" (type: ${ctx.nodeType}). When they say "this" or "it", they are referring to this specific topic. Provide detailed information about this subject.`;
    }

    const llmMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history,
    ];

    // If we have node-specific context, inject the content
    if (isNodeSpecific) {
      const contextText = JSON.stringify(nodeContext);
      llmMessages.push({
        role: 'system',
        content: `Current article/node context:\n${contextText}`,
      });
    }

    llmMessages.push({ role: 'user', content: message });

    let fullReply = '';
    let citations: { url: string; title: string }[] = [];

    // ── Try Responses API with web_search_preview first ────────────────────
    let usedResponsesApi = false;
    try {
      // @ts-expect-error — Responses API not yet in openai types
      const response = await client.responses.create({
        model,
        tools: [{ type: 'web_search_preview' }],
        input: llmMessages,
        stream: true,
      });

      usedResponsesApi = true;

      for await (const event of response as AsyncIterable<Record<string, unknown>>) {
        if (_streamClosed) break;

        if (event.type === 'response.output_text.delta') {
          const token = event.delta as string | undefined;
          if (token) {
            fullReply += token;
            send({ type: 'token', content: token });
          }
        }

        // Collect citations from completed response
        if (event.type === 'response.completed' && event.response) {
          const resp = event.response as Record<string, unknown>;
          const output = (resp.output || []) as Record<string, unknown>[];
          for (const item of output) {
            if (item.type === 'web_search_call') continue;
            if (item.type === 'message') {
              for (const part of (item.content || []) as Record<string, unknown>[]) {
                if (part.annotations) {
                  for (const ann of part.annotations as Record<string, unknown>[]) {
                    if (ann.type === 'url_citation') {
                      citations.push({ url: ann.url as string, title: (ann.title || ann.url) as string });
                    }
                  }
                }
              }
            }
          }
        }
      }
    } catch (responsesErr: unknown) {
      // Responses API not available — fall back to chat.completions
      if (usedResponsesApi) {
        // Partial stream already sent, surface the error
        send({ type: 'error', error: (responsesErr as Error).message });
        closeStream();
        return;
      }

      // ── Fallback: chat.completions streaming ───────────────────────────
      const stream = await client.chat.completions.create({
        model,
        messages: llmMessages,
        stream: true,
      });

      for await (const chunk of stream) {
        if (_streamClosed) break;
        const token = chunk.choices?.[0]?.delta?.content;
        if (token) {
          fullReply += token;
          send({ type: 'token', content: token });
        }
      }
    }

    // Deduplicate citations by URL
    const seen = new Set<string>();
    citations = citations.filter((c) => {
      if (seen.has(c.url)) return false;
      seen.add(c.url);
      return true;
    });

    // Done event — send the final reply + citations to the client
    send({ type: 'done', reply: fullReply, citations });
    closeStream();
  } catch (err: unknown) {
    console.error('POST /chat error:', err);
    send({ type: 'error', error: (err as Error).message || 'Internal error' });
    closeStream();
  }
});

/* ──────────────────────────────────────────────────────────────────────────────
   POST /chat/extract — Extract structured nodes from a chat exchange.
   Uses gpt-4o-mini for fast extraction. Creates a new thread on topic shift.
   Returns proposed nodes for the frontend to accept/discard.
   ────────────────────────────────────────────────────────────────────────────── */
router.post(
  '/chat/extract',
  requireAuth,
  withSession(async (req, res) => {
    const { message, reply, threadId, apiKey, nodeContext, citations = [] } = req.body;
    if (!message || !reply) {
      return res.status(400).json({ error: 'message and reply are required' });
    }

    const session = req.neo4jSession!;

    const client = new OpenAI({
      apiKey: apiKey || config.openai.apiKey,
      timeout: config.openai.timeout,
    });

    // ── Gather existing thread context for topic-shift detection ───────────
    let threadTitle = '';
    let threadDescription = '';
    if (threadId) {
      try {
        const tResult = await session.run(
          'MATCH (t:Thread {id: $id}) RETURN t',
          { id: getNeo4j().int(threadId) }
        );
        if (tResult.records.length) {
          const props = tResult.records[0].get('t').properties;
          threadTitle = props.title || '';
          threadDescription = props.description || '';
        }
      } catch (e) {
        console.error('Failed to fetch thread for extraction:', e);
      }
    }

    // ── Ask GPT to extract nodes and detect topic shift ────────────────────
    // Read thread_type from metadata for type-specific extraction
    let threadType = 'standard';
    if (threadId) {
      try {
        const metaResult = await session.run(
          'MATCH (t:Thread {id: $id}) RETURN t.metadata AS meta',
          { id: getNeo4j().int(threadId) }
        );
        if (metaResult.records.length) {
          const raw = metaResult.records[0].get('meta');
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              threadType = parsed.thread_type || 'standard';
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    }

    // For historical threads, fetch existing ROOT nodes with chronological_order
    let existingRootsContext = '';
    if (threadType === 'historical' && threadId) {
      try {
        const rootsResult = await session.run(
          `MATCH (t:Thread {id: $id})-[:HAS_NODE]->(n:Node {node_type: 'ROOT'})
           RETURN n.title AS title, n.metadata AS metadata
           ORDER BY n.created_at`,
          { id: getNeo4j().int(threadId) }
        );
        if (rootsResult.records.length > 0) {
          const rootsList = rootsResult.records.map((r, idx) => {
            const title = r.get('title') || 'Untitled';
            let order = idx + 1;
            try {
              const meta = JSON.parse(r.get('metadata') || '{}');
              if (meta.chronological_order != null) order = meta.chronological_order;
            } catch { /* ignore */ }
            return `  - "${title}" (chronological_order: ${order})`;
          });
          existingRootsContext = `\n\nExisting ROOT nodes in chronological order:\n${rootsList.join('\n')}`;
        }
      } catch { /* ignore */ }
    }

    // Detect if the question is about a specific existing node vs broad thread topic
    const isNodeSpecific = nodeContext && typeof nodeContext === 'object' && 'nodeId' in nodeContext;

    // Thread-type-specific extraction guidance
    let threadTypeInstructions = '';
    if (threadType === 'historical') {
      if (isNodeSpecific) {
        const ctx = nodeContext as Record<string, unknown>;
        threadTypeInstructions = `\nThis is a HISTORICAL/TIMELINE thread. The user is asking about a specific existing node: "${ctx.title}" (type: ${ctx.nodeType}).
Generate CHILD nodes (EVIDENCE, CONTEXT, EXAMPLE, REFERENCE) that provide supporting details, evidence, or context about this specific topic.
Do NOT generate new ROOT timeline events — the user wants to explore this existing event in depth.
Only generate ROOT if the reply explicitly introduces an entirely new historical period/event not already in the timeline.`;
      } else {
        threadTypeInstructions = `\nThis is a HISTORICAL/TIMELINE thread. The user is asking broadly about the thread topic — generate ROOT nodes for each distinct event, era, or time period mentioned in the reply. Chronological order matters. Supporting details about each event should be EVIDENCE or CONTEXT.
For each ROOT node, include a "chronological_order" field (number) indicating where it belongs in the timeline.
Use decimals to insert between existing positions (e.g. 2.5 to place between positions 2 and 3).${existingRootsContext}`;
      }
    } else if (threadType === 'debate') {
      threadTypeInstructions = `\nThis is a DEBATE thread. Extract the central claim as ROOT. Supporting evidence stays EVIDENCE. Critiques and opposing views should be COUNTERPOINT. Final assessments should be SYNTHESIS.`;
    } else if (threadType === 'comparison') {
      threadTypeInstructions = `\nThis is a COMPARISON thread. Extract each comparison subject as its own ROOT node. Details about each subject should be child nodes (EVIDENCE, EXAMPLE, CONTEXT).`;
    }

    // For any thread type: if asking about a specific node, prefer child nodes
    if (isNodeSpecific && threadType !== 'historical') {
      const ctx = nodeContext as Record<string, unknown>;
      threadTypeInstructions += `\nThe user is asking about a specific existing node: "${ctx.title}" (type: ${ctx.nodeType}). Generate supporting child nodes (EVIDENCE, CONTEXT, EXAMPLE, COUNTERPOINT) that elaborate on this topic. Only use ROOT if the reply introduces an entirely new top-level subject.`;
    }

    const extractionPrompt = `You are a knowledge-graph extraction engine.

Given a user question, an assistant reply, and optional thread context, do two things:
1. Decide if the conversation represents a TOPIC SHIFT from the current thread.
   A topic shift means the user is asking about an ENTIRELY UNRELATED domain — not just a sub-topic, aspect, event, or detail within the thread's subject.
   Be VERY conservative: sub-topics, related events, specific aspects, causes, effects, people, and places within the thread's domain are NOT topic shifts.
   Examples of NOT a topic shift: "Pearl Harbor" within a "World War 2" thread, "React hooks" within a "React" thread.
   Examples of a topic shift: "Italian cooking" within a "World War 2" thread, "Quantum physics" within a "React" thread.
   If there is no existing thread (threadTitle is empty), this is always a new topic.
2. Extract structured knowledge nodes from the reply.

Current thread title: "${threadTitle}"
Current thread description: "${threadDescription}"
${nodeContext ? `Article/node context: ${typeof nodeContext === 'string' ? nodeContext : JSON.stringify(nodeContext)}` : ''}

Return ONLY valid JSON (no markdown fencing) in this exact format:
{
  "topicShift": true/false,
  "newThreadTitle": "short title if topic shift, else empty string",
  "newThreadDescription": "1-2 sentence description if topic shift, else empty string",
  "proposedUpdate": null or { "nodeId": <number>, "title": "...", "description": "...", "content": "..." },
  "nodes": [
    {
      "type": "ROOT|EVIDENCE|REFERENCE|CONTEXT|EXAMPLE|COUNTERPOINT|SYNTHESIS",
      "title": "short title",
      "content": "detailed content from the reply",
      "chronological_order": null
    }
  ]
}

Note: "chronological_order" is only needed for ROOT nodes in HISTORICAL threads. Use null otherwise.

Node types fall into two categories:

EXPANDABLE types (can have children):
- ROOT: Broad topics, claims, or theses that deserve sub-exploration. Use ROOT for any subject that has potential sub-points, facets, or dimensions to explore. NOT just "the main point" — any broad topic warrants ROOT.
- CONTEXT: Background information, historical context, or framing that could have supporting details.
- SYNTHESIS: Summary or conclusions that tie together multiple points.

LEAF types (cannot have children — terminal knowledge):
- EVIDENCE: ONLY for specific, verifiable factual claims with identifiable sources. Must cite or reference concrete data, studies, or statistics.
- REFERENCE: Cited sources, URLs, papers, or links.
- EXAMPLE: Specific illustrative examples or case studies.
- COUNTERPOINT: Opposing views, critiques, or rebuttals.

KEY DISTINCTION: If content describes a TOPIC with potential sub-points, use ROOT. EVIDENCE is ONLY for specific facts with identifiable sources. A broad sub-topic like "Economic Impact" or "Environmental Effects" should be ROOT, not EVIDENCE.
${threadTypeInstructions}

Additional rules:
- Each node's content should be self-contained and meaningful.
- Only include nodes that add real knowledge value — skip trivial/filler.
- If the reply is a simple acknowledgment or clarification, return an empty nodes array.
- If the question is about an existing node (nodeContext provided), and the reply suggests updating that node, set proposedUpdate with the updated fields.
- If the conversation mentions YouTube videos or video URLs, include them as REFERENCE nodes. Put the full YouTube URL in the content field as a markdown link so it can be embedded.`;

    const extractionMessages = [
      { role: 'system' as const, content: extractionPrompt },
      { role: 'user' as const, content: `User question: ${message}\n\nAssistant reply: ${reply}` },
    ];

    let extracted: ExtractionResult;
    try {
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: extractionMessages,
        temperature: 0.1,
      });

      const raw = completion.choices?.[0]?.message?.content || '{}';
      // Strip markdown code fences if present
      const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
      extracted = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Extraction parse error:', parseErr);
      extracted = { topicShift: false, newThreadTitle: '', newThreadDescription: '', proposedUpdate: null, nodes: [] };
    }

    // ── Handle topic shift ──────────────────────────────────────────────────
    // If no threadId at all, we must create a thread so the chat can be saved.
    // If topicShift is detected but a thread already exists, DON'T auto-create —
    // just flag it so the frontend can create the thread when the user accepts nodes.
    let resolvedThreadId = threadId;
    let newThread: { id: number; title: string; description: string } | null = null;
    let pendingNewThread: { title: string; description: string } | null = null;

    const needsThread = !threadId; // no thread at all — must create one
    const isTopicShift = extracted.topicShift && !!threadId; // has thread but different topic

    if (needsThread) {
      // Create thread immediately since we need one for chat persistence
      try {
        const newTitle = extracted.newThreadTitle || message.substring(0, 80);
        const newDesc = extracted.newThreadDescription || reply.substring(0, 200);
        const id = await getNextId('thread', session);
        const now = new Date().toISOString();

        await session.run(
          `CREATE (t:Thread {
            id: $id, title: $title, description: $desc, content: '',
            metadata: '{}', created_at: $now, updated_at: $now
          })`,
          {
            id: getNeo4j().int(id),
            title: newTitle,
            desc: newDesc,
            now,
          }
        );

        await session.run(
          `MATCH (u:User {id: $uid}), (t:Thread {id: $tid})
           CREATE (u)-[:OWNS]->(t)`,
          { uid: getNeo4j().int(req.user!.id), tid: getNeo4j().int(id) }
        );

        resolvedThreadId = id;
        newThread = { id, title: newTitle, description: newDesc };
      } catch (threadErr) {
        console.error('Failed to create thread from chat:', threadErr);
      }
    } else if (isTopicShift) {
      // Flag topic shift but DON'T auto-create — nodes stay in current thread
      // The frontend can show a suggestion to create a new thread
      pendingNewThread = {
        title: extracted.newThreadTitle || message.substring(0, 80),
        description: extracted.newThreadDescription || reply.substring(0, 200),
      };
    }

    // ── Build proposed nodes (not yet saved — frontend decides) ────────────
    const proposedNodes: ProposedNode[] = (extracted.nodes || [])
      .filter((n: ProposedNode) => NODE_TYPES.includes(n.type as typeof NODE_TYPES[number]) && n.title && n.content)
      .map((n: ProposedNode) => ({
        type: n.type,
        title: n.title,
        content: n.content,
        ...(n.chronological_order != null ? { chronological_order: n.chronological_order } : {}),
      }));

    // ── Add citations as REFERENCE nodes if not already covered ────────────
    if (citations.length > 0) {
      const existingRefTitles = new Set(
        proposedNodes.filter(n => n.type === 'REFERENCE').map(n => n.title.toLowerCase())
      );
      for (const cit of citations) {
        const title = (cit.title || cit.url).substring(0, 120);
        if (!existingRefTitles.has(title.toLowerCase())) {
          const isYouTube = /(?:youtube\.com\/watch\?v=|youtu\.be\/)/.test(cit.url);
          if (isYouTube) {
            proposedNodes.push({
              type: 'REFERENCE',
              title,
              content: `[${cit.title || 'Watch Video'}](${cit.url})\n\n${cit.url}`,
            });
          } else {
            proposedNodes.push({
              type: 'REFERENCE',
              title,
              content: JSON.stringify({ url: cit.url, title: cit.title || cit.url }),
            });
          }
        }
      }
    }

    res.json({
      threadId: resolvedThreadId,
      newThread,
      proposedNodes,
      proposedUpdate: extracted.proposedUpdate || null,
      citations,
    });
  })
);

/* ──────────────────────────────────────────────────────────────────────────────
   POST /socratic — Socratic dialogue: ask probing questions about a thread
   ────────────────────────────────────────────────────────────────────────────── */
router.post(
  '/socratic',
  requireAuth,
  aiTimeout,
  withSession(async (req, res) => {
    const { threadId, history = [], currentAnswer, nodeContext } = req.body;
    if (!threadId) return res.status(400).json({ error: 'threadId is required' });

    const session = req.neo4jSession!;
    const openai = getOpenAI();

    // Fetch thread summary from Neo4j
    let threadSummary = '';
    try {
      const tResult = await session.run(
        'MATCH (t:Thread {id: $id}) RETURN t',
        { id: getNeo4j().int(threadId) }
      );
      if (tResult.records.length) {
        const props = tResult.records[0].get('t').properties;
        threadSummary = `Thread: "${props.title}"`;
        if (props.description) threadSummary += `\nDescription: ${props.description}`;
      }

      // Also grab a few node summaries for richer context
      const nResult = await session.run(
        `MATCH (t:Thread {id: $id})-[:HAS_NODE]->(n:Node)
         RETURN n ORDER BY n.id LIMIT 10`,
        { id: getNeo4j().int(threadId) }
      );
      if (nResult.records.length) {
        const nodeSummaries = nResult.records.map((r) => {
          const p = r.get('n').properties;
          const txt = extractContentText(p.content);
          return `- [${p.node_type}] ${p.title}: ${txt.substring(0, 150)}`;
        });
        threadSummary += `\n\nKey nodes:\n${nodeSummaries.join('\n')}`;
      }
    } catch (e) {
      console.error('Socratic thread fetch error:', e);
    }

    // Build Socratic prompt
    const systemPrompt = `You are a Socratic tutor helping the user deeply understand a research topic.
Your role is to ask probing, thought-provoking questions that:
- Challenge assumptions
- Reveal gaps in understanding
- Encourage deeper analysis
- Draw connections between ideas

${threadSummary}
${nodeContext ? `\nCurrent article/node context: ${typeof nodeContext === 'string' ? nodeContext : JSON.stringify(nodeContext)}` : ''}

Based on the conversation history and the user's latest answer, generate the next Socratic question.

Also, if the user's answer contains a meaningful insight, extract it as a potential knowledge node.

Return ONLY valid JSON (no markdown fencing):
{
  "question": "your next Socratic question",
  "nodeFromAnswer": null or { "type": "EVIDENCE|CONTEXT|SYNTHESIS|EXAMPLE|COUNTERPOINT", "title": "short title", "content": "the insight" }
}`;

    const llmMessages: ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }];

    // Replay history
    for (const h of history) {
      llmMessages.push({ role: 'assistant', content: h.question });
      llmMessages.push({ role: 'user', content: h.answer });
    }

    if (currentAnswer) {
      llmMessages.push({ role: 'user', content: currentAnswer });
    } else {
      llmMessages.push({ role: 'user', content: '(Starting a new Socratic dialogue. Please ask the first question.)' });
    }

    try {
      const completion = await openai.chat.completions.create({
        model: config.openai.chatModel,
        messages: llmMessages,
        temperature: 0.7,
      });

      const raw = completion.choices?.[0]?.message?.content || '{}';
      const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
      const result = JSON.parse(cleaned);

      res.json({
        question: result.question || 'Can you elaborate on that?',
        nodeFromAnswer: result.nodeFromAnswer || null,
      });
    } catch (err) {
      console.error('Socratic GPT error:', err);
      res.status(500).json({ error: 'Failed to generate Socratic question' });
    }
  })
);

/* ──────────────────────────────────────────────────────────────────────────────
   GET /threads/:threadId/socratic-history — Retrieve persisted Socratic history
   ────────────────────────────────────────────────────────────────────────────── */
router.get(
  '/threads/:threadId/socratic-history',
  requireAuth,
  withSession(async (req, res) => {
    const { threadId } = req.params;
    const session = req.neo4jSession!;

    try {
      const result = await session.run(
        `MATCH (t:Thread {id: $id})
         RETURN t.socratic_history AS history`,
        { id: getNeo4j().int(Number(threadId)) }
      );

      let history: ChatMessage[] = [];
      if (result.records.length) {
        const raw = result.records[0].get('history');
        if (raw) {
          try {
            history = JSON.parse(raw);
          } catch {
            history = [];
          }
        }
      }

      res.json({ history });
    } catch (err) {
      console.error('GET socratic-history error:', err);
      res.status(500).json({ error: 'Failed to load socratic history' });
    }
  })
);

/* ──────────────────────────────────────────────────────────────────────────────
   PUT /threads/:threadId/socratic-history — Save Socratic history
   ────────────────────────────────────────────────────────────────────────────── */
router.put(
  '/threads/:threadId/socratic-history',
  requireAuth,
  withSession(async (req, res) => {
    const { threadId } = req.params;
    const { history = [] } = req.body;
    const session = req.neo4jSession!;

    try {
      await session.run(
        `MATCH (t:Thread {id: $id})
         SET t.socratic_history = $history`,
        {
          id: getNeo4j().int(Number(threadId)),
          history: JSON.stringify(history),
        }
      );

      res.json({ ok: true });
    } catch (err) {
      console.error('PUT socratic-history error:', err);
      res.status(500).json({ error: 'Failed to save socratic history' });
    }
  })
);

/* ──────────────────────────────────────────────────────────────────────────────
   GET /threads/:threadId/chats — List all chats for a thread
   ────────────────────────────────────────────────────────────────────────────── */
router.get(
  '/threads/:threadId/chats',
  withSession(async (req, res) => {
    const { threadId } = req.params;
    const session = req.neo4jSession!;

    try {
      const result = await session.run(
        `MATCH (t:Thread {id: $id})-[:HAS_CHAT]->(c:Chat)
         RETURN c ORDER BY c.created_at DESC`,
        { id: getNeo4j().int(Number(threadId)) }
      );

      const chats = result.records.map((r) => {
        const props = r.get('c').properties;
        let messageCount = 0;
        if (props.messages) {
          try {
            const msgs = JSON.parse(props.messages);
            // Count user messages as "exchanges"
            messageCount = msgs.filter((m: { role: string }) => m.role === 'user').length;
          } catch {
            messageCount = 0;
          }
        }
        return {
          id: toNum(props.id),
          title: props.title || 'Untitled',
          messageCount,
          created_at: props.created_at,
          updated_at: props.updated_at,
        };
      });

      res.json(chats);
    } catch (err) {
      console.error('GET thread chats error:', err);
      res.status(500).json({ error: 'Failed to load chats' });
    }
  })
);

/* ──────────────────────────────────────────────────────────────────────────────
   GET /chats/:chatId — Get a single chat with full messages
   ────────────────────────────────────────────────────────────────────────────── */
router.get(
  '/chats/:chatId',
  withSession(async (req, res) => {
    const { chatId } = req.params;
    const session = req.neo4jSession!;

    try {
      const result = await session.run(
        `MATCH (c:Chat {id: $id})
         OPTIONAL MATCH (t:Thread)-[:HAS_CHAT]->(c)
         RETURN c, t.id AS threadId`,
        { id: getNeo4j().int(Number(chatId)) }
      );

      if (!result.records.length) {
        return res.status(404).json({ error: 'Chat not found' });
      }

      const props = result.records[0].get('c').properties;
      const tId = result.records[0].get('threadId');
      let messages: ChatMessage[] = [];
      if (props.messages) {
        try {
          messages = JSON.parse(props.messages);
        } catch {
          messages = [];
        }
      }

      res.json({
        id: toNum(props.id),
        title: props.title || 'Untitled',
        messages,
        threadId: toNum(tId),
        created_at: props.created_at,
        updated_at: props.updated_at,
      });
    } catch (err) {
      console.error('GET chat error:', err);
      res.status(500).json({ error: 'Failed to load chat' });
    }
  })
);

/* ──────────────────────────────────────────────────────────────────────────────
   POST /chats — Create a new chat linked to a thread
   ────────────────────────────────────────────────────────────────────────────── */
router.post(
  '/chats',
  requireAuth,
  withSession(async (req, res) => {
    const { threadId, title, messages = [] } = req.body;
    if (!threadId) return res.status(400).json({ error: 'threadId is required' });

    const session = req.neo4jSession!;

    try {
      const id = await getNextId('chat', session);
      const now = new Date().toISOString();

      await session.run(
        `MATCH (t:Thread {id: $tid})
         CREATE (c:Chat {
           id: $id, title: $title, messages: $messages,
           created_at: $now, updated_at: $now
         })
         CREATE (t)-[:HAS_CHAT]->(c)`,
        {
          tid: getNeo4j().int(Number(threadId)),
          id: getNeo4j().int(id),
          title: title || 'Untitled',
          messages: JSON.stringify(messages),
          now,
        }
      );

      res.json({ id, title: title || 'Untitled', created_at: now });
    } catch (err) {
      console.error('POST chat error:', err);
      res.status(500).json({ error: 'Failed to create chat' });
    }
  })
);

/* ──────────────────────────────────────────────────────────────────────────────
   PUT /chats/:chatId — Update an existing chat (title, messages)
   ────────────────────────────────────────────────────────────────────────────── */
router.put(
  '/chats/:chatId',
  requireAuth,
  withSession(async (req, res) => {
    const { chatId } = req.params;
    const { title, messages } = req.body;
    const session = req.neo4jSession!;

    try {
      const sets = ['c.updated_at = $now'];
      const params: Record<string, unknown> = {
        id: getNeo4j().int(Number(chatId)),
        now: new Date().toISOString(),
      };

      if (title !== undefined) {
        sets.push('c.title = $title');
        params.title = title;
      }
      if (messages !== undefined) {
        sets.push('c.messages = $messages');
        params.messages = JSON.stringify(messages);
      }

      const result = await session.run(
        `MATCH (c:Chat {id: $id})
         SET ${sets.join(', ')}
         RETURN c`,
        params
      );

      if (!result.records.length) {
        return res.status(404).json({ error: 'Chat not found' });
      }

      const props = result.records[0].get('c').properties;
      res.json({
        id: toNum(props.id),
        title: props.title,
        updated_at: props.updated_at,
      });
    } catch (err) {
      console.error('PUT chat error:', err);
      res.status(500).json({ error: 'Failed to update chat' });
    }
  })
);

/* ──────────────────────────────────────────────────────────────────────────────
   POST /chat/debate — SSE streaming debate mode ("Debate a Clone")
   User can defend or attack a thread's position while AI plays the opposite role.
   ────────────────────────────────────────────────────────────────────────────── */
router.post(
  '/chat/debate',
  requireAuth,
  withSession(async (req, res) => {
    const { message, threadId, mode, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });
    if (!threadId) return res.status(400).json({ error: 'threadId is required' });
    if (!mode || !['defend', 'attack'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be "defend" or "attack"' });
    }

    const session = req.neo4jSession!;

    // ── SSE setup ──────────────────────────────────────────────────────────────
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let _streamClosed = false;
    const send = (obj: Record<string, unknown>) => {
      if (!_streamClosed) res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };
    const closeStream = () => {
      if (!_streamClosed) {
        _streamClosed = true;
        res.end();
      }
    };

    try {
      // ── Fetch thread context ─────────────────────────────────────────────────
      let rootClaim = '';
      let threadTitle = '';
      let nodeContents: string[] = [];

      try {
        const tResult = await session.run(
          'MATCH (t:Thread {id: $id}) RETURN t',
          { id: getNeo4j().int(threadId) }
        );
        if (tResult.records.length) {
          const props = tResult.records[0].get('t').properties;
          threadTitle = props.title || '';
          rootClaim = props.title || '';
        }

        const nResult = await session.run(
          `MATCH (t:Thread {id: $id})-[:HAS_NODE]->(n:Node)
           RETURN n ORDER BY n.id`,
          { id: getNeo4j().int(threadId) }
        );
        if (nResult.records.length) {
          for (const r of nResult.records) {
            const p = r.get('n').properties;
            const nodeType = p.node_type || 'UNKNOWN';
            const txt = extractContentText(p.content);
            if (nodeType === 'ROOT' && !rootClaim) {
              rootClaim = p.title || txt.substring(0, 200);
            }
            nodeContents.push(`[${nodeType}] ${p.title}: ${txt.substring(0, 300)}`);
          }
        }
      } catch (e) {
        console.error('Debate thread fetch error:', e);
      }

      if (!rootClaim) rootClaim = threadTitle || 'the topic under discussion';

      // ── Build system prompt based on mode ────────────────────────────────────
      let systemPrompt: string;
      if (mode === 'defend') {
        systemPrompt = `You are defending the position: "${rootClaim}". Use ONLY the following evidence from the user's research:\n\n${nodeContents.join('\n')}\n\nIf the user raises a point you can't counter with existing evidence, acknowledge the gap. Stay in character as a passionate but honest defender of this position. Use markdown formatting.`;
      } else {
        systemPrompt = `You are a rigorous critic attacking the position: "${rootClaim}". Find weaknesses, ask probing questions, challenge assumptions. When the user makes a good defense, acknowledge it but press harder. Here is the evidence the position relies on:\n\n${nodeContents.join('\n')}\n\nYour goal is to stress-test this position by finding every possible weakness. Use markdown formatting.`;
      }

      // Fresh OpenAI client
      const client = new OpenAI({
        apiKey: config.openai.apiKey,
        timeout: config.openai.timeout,
      });

      const model = config.openai.chatModel;

      const llmMessages: ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message },
      ];

      let fullReply = '';

      // ── Try Responses API first, fallback to chat.completions ────────────────
      let usedResponsesApi = false;
      try {
        // @ts-expect-error — Responses API not yet in openai types
        const response = await client.responses.create({
          model,
          input: llmMessages,
          stream: true,
        });

        usedResponsesApi = true;

        for await (const event of response as AsyncIterable<Record<string, unknown>>) {
          if (_streamClosed) break;

          if (event.type === 'response.output_text.delta') {
            const token = event.delta as string | undefined;
            if (token) {
              fullReply += token;
              send({ type: 'token', content: token });
            }
          }
        }
      } catch (responsesErr: unknown) {
        if (usedResponsesApi) {
          send({ type: 'error', error: (responsesErr as Error).message });
          closeStream();
          return;
        }

        // ── Fallback: chat.completions streaming ───────────────────────────
        const stream = await client.chat.completions.create({
          model,
          messages: llmMessages,
          stream: true,
        });

        for await (const chunk of stream) {
          if (_streamClosed) break;
          const token = chunk.choices?.[0]?.delta?.content;
          if (token) {
            fullReply += token;
            send({ type: 'token', content: token });
          }
        }
      }

      // ── Extract weaknesses from the conversation ─────────────────────────────
      let weaknesses_found: { description: string; severity: 'high' | 'medium' | 'low' }[] = [];

      try {
        const extractionMessages: ChatCompletionMessageParam[] = [
          {
            role: 'system',
            content: `You are analyzing a debate about the position: "${rootClaim}".
Given the conversation history and the latest exchange, extract any weaknesses or gaps in the position that were revealed.
Return ONLY valid JSON (no markdown fencing):
{
  "weaknesses": [
    { "description": "brief description of the weakness", "severity": "high|medium|low" }
  ]
}
If no new weaknesses were revealed in this exchange, return {"weaknesses": []}.`,
          },
          {
            role: 'user',
            content: `Conversation:\n${history.map((h: { role: string; content: string }) => `${h.role}: ${h.content}`).join('\n')}\nuser: ${message}\nassistant: ${fullReply}`,
          },
        ];

        const extraction = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: extractionMessages,
          temperature: 0.1,
        });

        const raw = extraction.choices?.[0]?.message?.content || '{}';
        const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
        const parsed = JSON.parse(cleaned);
        weaknesses_found = parsed.weaknesses || [];
      } catch (e) {
        console.error('Debate weakness extraction error:', e);
      }

      // Done event
      send({ type: 'done', reply: fullReply, weaknesses_found });
      closeStream();
    } catch (err: unknown) {
      console.error('POST /chat/debate error:', err);
      send({ type: 'error', error: (err as Error).message || 'Internal error' });
      closeStream();
    }
  })
);

export default router;
