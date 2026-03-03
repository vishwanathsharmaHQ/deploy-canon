// Use relative path since frontend is served by backend
const API_BASE_URL = '/api';

let _authToken = localStorage.getItem('authToken');

export function setAuthToken(token) {
  _authToken = token;
  token ? localStorage.setItem('authToken', token) : localStorage.removeItem('authToken');
}

function authHeaders() {
  const base = { 'Content-Type': 'application/json' };
  return _authToken ? { ...base, Authorization: `Bearer ${_authToken}` } : base;
}

export const api = {
  // Thread operations
  async getThreads() {
    const response = await fetch(`${API_BASE_URL}/threads`);
    if (!response.ok) throw new Error('Failed to fetch threads');
    return response.json();
  },

  async createThread({ title, description, content, metadata }) {
    const response = await fetch(`${API_BASE_URL}/threads`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title, description, content, metadata }),
    });
    if (!response.ok) throw new Error('Failed to create thread');
    return response.json();
  },

  async searchThreads(query) {
    const response = await fetch(`${API_BASE_URL}/threads/search?query=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error('Failed to search threads');
    return response.json();
  },

  async generateThread(topic) {
    const response = await fetch(`${API_BASE_URL}/threads/generate`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ topic }),
    });
    if (!response.ok) throw new Error('Failed to generate thread');
    return response.json();
  },

  // Node operations
  async getThreadNodes(threadId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/nodes`);
    if (!response.ok) throw new Error('Failed to fetch nodes');
    return response.json();
  },

  async createNode({ threadId, title, content, nodeType, parentId, metadata }) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/nodes`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title, content, nodeType, parentId, metadata }),
    });
    if (!response.ok) throw new Error('Failed to create node');
    return response.json();
  },

  // Edge operations
  async createEdge({ sourceId, targetId, relationshipType, metadata }) {
    const response = await fetch(`${API_BASE_URL}/edges`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ sourceId, targetId, relationshipType, metadata }),
    });
    if (!response.ok) throw new Error('Failed to create edge');
    return response.json();
  },

  // Thread layout functions
  async saveThreadLayout(threadId, layout) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/layout`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ layout }),
    });
    if (!response.ok) {
      throw new Error('Failed to save thread layout');
    }
    return response.json();
  },

  async loadThreadLayout(threadId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/layout`);
    if (!response.ok) {
      throw new Error('Failed to load thread layout');
    }
    return response.json();
  },

  async deleteThreadLayout(threadId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/layout`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!response.ok) {
      throw new Error('Failed to delete thread layout');
    }
    return response.json();
  },

  // Thread canvas functions
  async saveThreadCanvas(threadId, canvas) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/canvas`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ canvas }),
    });
    if (!response.ok) throw new Error(`Failed to save thread canvas: ${response.status}`);
    return response.json();
  },

  async loadThreadCanvas(threadId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/canvas`);
    if (!response.ok) return null;
    return response.json();
  },

  async deleteThreadCanvas(threadId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/canvas`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete thread canvas');
    return response.json();
  },

  // Update thread content
  async updateThreadContent(threadId, content) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/content`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ content }),
    });
    if (!response.ok) throw new Error('Failed to update thread content');
    return response.json();
  },

  // Article sequence functions
  async saveArticleSequence(threadId, sequence) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/sequence`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ sequence }),
    });
    if (!response.ok) throw new Error('Failed to save article sequence');
    return response.json();
  },

  async loadArticleSequence(threadId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/sequence`);
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;
    return response.json();
  },

  async deleteArticleSequence(threadId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/sequence`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete article sequence');
    return response.json();
  },

  async deleteNode(threadId, nodeId, force = false) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/nodes/${nodeId}?force=${force}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete node');
    return response.json();
  },

  async updateNode(threadId, nodeId, { title, content }) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/nodes/${nodeId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ title, content }),
    });
    if (!response.ok) throw new Error('Failed to update node');
    return response.json();
  },

  async chatExtract({ message, reply, threadId, apiKey, nodeContext, citations }) {
    const response = await fetch(`${API_BASE_URL}/chat/extract`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ message, reply, threadId, apiKey, nodeContext, citations }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Extract request failed');
    }
    return response.json();
  },

  async chatStream({ message, history, threadId, apiKey, nodeContext, onToken, onProcessing, onDone, onError }) {
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ message, history, threadId, apiKey, nodeContext }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Chat request failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'token') onToken?.(event.content);
          else if (event.type === 'processing') onProcessing?.();
          else if (event.type === 'done') setTimeout(() => onDone?.(event), 0);
          else if (event.type === 'error') onError?.(new Error(event.error));
        } catch {
          // malformed line — skip
        }
      }
    }
  },

  async getThreadChats(threadId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/chats`);
    if (!response.ok) throw new Error('Failed to fetch chats');
    return response.json();
  },

  async getChat(chatId) {
    const response = await fetch(`${API_BASE_URL}/chats/${chatId}`);
    if (!response.ok) throw new Error('Failed to fetch chat');
    return response.json();
  },

  async createChat({ threadId, title, messages }) {
    const response = await fetch(`${API_BASE_URL}/chats`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ threadId, title, messages }),
    });
    if (!response.ok) throw new Error('Failed to create chat');
    return response.json();
  },

  async updateChat(chatId, { title, messages }) {
    const response = await fetch(`${API_BASE_URL}/chats/${chatId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ title, messages }),
    });
    if (!response.ok) throw new Error('Failed to update chat');
    return response.json();
  },

  async redTeamThread(threadId, nodeId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/redteam`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ nodeId }),
    });
    if (!response.ok) throw new Error('Red team failed');
    return response.json();
  },

  async steelmanNode(threadId, nodeId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/nodes/${nodeId}/steelman`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error('Steelman failed');
    return response.json();
  },

  async forkThread(threadId, { altClaim } = {}) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/fork`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ altClaim }),
    });
    if (!response.ok) throw new Error('Fork failed');
    return response.json();
  },

  async socraticQuestion({ threadId, history, currentAnswer, nodeContext }) {
    const response = await fetch(`${API_BASE_URL}/socratic`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ threadId, history, currentAnswer, nodeContext }),
    });
    if (!response.ok) throw new Error('Socratic request failed');
    return response.json();
  },

  async getSocraticHistory(threadId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/socratic-history`, { headers: authHeaders() });
    if (!response.ok) throw new Error('Failed to load socratic history');
    return response.json();
  },

  async saveSocraticHistory(threadId, history) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/socratic-history`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ history }),
    });
    if (!response.ok) throw new Error('Failed to save socratic history');
    return response.json();
  },

  async createNodesBatch(threadId, nodes) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/nodes/batch`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ nodes }),
    });
    if (!response.ok) throw new Error('Batch node create failed');
    return response.json();
  },

  async analyzeThread(threadId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/analyze`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error('Analysis failed');
    return response.json();
  },

  async suggestSequence(threadId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/sequence/suggest`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error('Sequence suggestion failed');
    return response.json();
  },

  async verifySource({ url, claim }) {
    const response = await fetch(`${API_BASE_URL}/verify-source`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ url, claim }),
    });
    if (!response.ok) throw new Error('Verification failed');
    return response.json();
  },

  async generateNodeSuggestions({ nodeId, nodeType, content, title }) {
    const response = await fetch(`${API_BASE_URL}/nodes/suggest`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ nodeId, nodeType, content, title }),
    });
    if (!response.ok) throw new Error('Failed to generate suggestions');
    return response.json();
  },

  // Auth methods
  async register({ name, email, password }) {
    const response = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Registration failed');
    setAuthToken(data.token);
    return data.user;
  },

  async login({ email, password }) {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Login failed');
    setAuthToken(data.token);
    return data.user;
  },

  async getMe() {
    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error('Not authenticated');
    return response.json();
  },

  logout() {
    setAuthToken(null);
  },

  // ── Phase 1: Admin / Embedding ──────────────────────────────────────────────
  async setupIndexes() {
    const response = await fetch(`${API_BASE_URL}/admin/setup-indexes`, { method: 'POST', headers: authHeaders() });
    if (!response.ok) throw new Error('Failed to setup indexes');
    return response.json();
  },
  async migrateEmbeddings() {
    const response = await fetch(`${API_BASE_URL}/admin/migrate-embeddings`, { method: 'POST', headers: authHeaders() });
    if (!response.ok) throw new Error('Failed to migrate embeddings');
    return response.json();
  },

  // ── Phase 2: Semantic Search ────────────────────────────────────────────────
  async semanticSearch(query, limit = 20) {
    const response = await fetch(`${API_BASE_URL}/search/semantic?q=${encodeURIComponent(query)}&limit=${limit}`);
    if (!response.ok) throw new Error('Semantic search failed');
    return response.json();
  },
  async searchAnswer(question) {
    const response = await fetch(`${API_BASE_URL}/search/answer`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ question }) });
    if (!response.ok) throw new Error('Q&A synthesis failed');
    return response.json();
  },
  async getRelatedThreads(threadId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/related`);
    if (!response.ok) return [];
    return response.json();
  },
  async getRandomThread() {
    const response = await fetch(`${API_BASE_URL}/threads/random`);
    if (!response.ok) throw new Error('No threads found');
    return response.json();
  },
  async findContradictions(threadId) {
    const response = await fetch(`${API_BASE_URL}/search/contradictions`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ threadId }) });
    if (!response.ok) throw new Error('Contradiction search failed');
    return response.json();
  },

  // ── Phase 3: Cross-Thread Links ─────────────────────────────────────────────
  async createLink({ sourceNodeId, targetNodeId, type, description, confidence, status }) {
    const response = await fetch(`${API_BASE_URL}/links`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ sourceNodeId, targetNodeId, type, description, confidence, status }) });
    if (!response.ok) throw new Error('Failed to create link');
    return response.json();
  },
  async getNodeLinks(nodeId) {
    const response = await fetch(`${API_BASE_URL}/links/node/${nodeId}`);
    if (!response.ok) return [];
    return response.json();
  },
  async deleteLink(linkId) {
    const response = await fetch(`${API_BASE_URL}/links/${linkId}`, { method: 'DELETE', headers: authHeaders() });
    if (!response.ok) throw new Error('Failed to delete link');
    return response.json();
  },
  async updateLinkStatus(linkId, status) {
    const response = await fetch(`${API_BASE_URL}/links/${linkId}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status }) });
    if (!response.ok) throw new Error('Failed to update link');
    return response.json();
  },
  async suggestLinks(threadId) {
    const response = await fetch(`${API_BASE_URL}/links/suggest`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ threadId }) });
    if (!response.ok) throw new Error('Link suggestion failed');
    return response.json();
  },
  async getGlobalGraphSummary() {
    const response = await fetch(`${API_BASE_URL}/graph/global/summary`);
    if (!response.ok) throw new Error('Failed to fetch global graph');
    return response.json();
  },
  async getConcepts() {
    const response = await fetch(`${API_BASE_URL}/graph/concepts`);
    if (!response.ok) throw new Error('Failed to fetch concepts');
    return response.json();
  },
  async getConceptNodes(conceptId) {
    const response = await fetch(`${API_BASE_URL}/graph/concepts/${conceptId}/nodes`);
    if (!response.ok) throw new Error('Failed to fetch concept nodes');
    return response.json();
  },
  async extractConcepts(nodeId) {
    const response = await fetch(`${API_BASE_URL}/graph/concepts/extract`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ nodeId }) });
    if (!response.ok) throw new Error('Concept extraction failed');
    return response.json();
  },

  // ── Phase 4: Spaced Repetition ──────────────────────────────────────────────
  async initReview(threadId) {
    const response = await fetch(`${API_BASE_URL}/review/init`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ threadId }) });
    if (!response.ok) throw new Error('Review init failed');
    return response.json();
  },
  async getDueReviews(threadId) {
    const url = threadId ? `${API_BASE_URL}/review/due?threadId=${threadId}` : `${API_BASE_URL}/review/due`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch due reviews');
    return response.json();
  },
  async submitReview(nodeId, quality) {
    const response = await fetch(`${API_BASE_URL}/review/submit`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ nodeId, quality }) });
    if (!response.ok) throw new Error('Review submit failed');
    return response.json();
  },
  async getReviewStats(threadId) {
    const url = threadId ? `${API_BASE_URL}/review/stats?threadId=${threadId}` : `${API_BASE_URL}/review/stats`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch review stats');
    return response.json();
  },
  async getDecayData(threadId) {
    const response = await fetch(`${API_BASE_URL}/review/decay?threadId=${threadId}`);
    if (!response.ok) return [];
    return response.json();
  },
  async generateQuiz(nodeId, quizType) {
    const response = await fetch(`${API_BASE_URL}/review/quiz`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ nodeId, quizType }) });
    if (!response.ok) throw new Error('Quiz generation failed');
    return response.json();
  },

  // ── Phase 5: Ingestion ──────────────────────────────────────────────────────
  async ingestUrl(url, threadId) {
    const response = await fetch(`${API_BASE_URL}/ingest/url`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ url, threadId }) });
    if (!response.ok) throw new Error('URL ingestion failed');
    return response.json();
  },
  async ingestPdf(pdfBase64, filename, threadId) {
    const response = await fetch(`${API_BASE_URL}/ingest/pdf`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ pdfBase64, filename, threadId }) });
    if (!response.ok) throw new Error('PDF ingestion failed');
    return response.json();
  },
  async getBookmarks() {
    const response = await fetch(`${API_BASE_URL}/ingest/bookmarks`, { headers: authHeaders() });
    if (!response.ok) throw new Error('Failed to fetch bookmarks');
    return response.json();
  },
  async createBookmark({ url, title, notes, source_type }) {
    const response = await fetch(`${API_BASE_URL}/ingest/bookmarks`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ url, title, notes, source_type }) });
    if (!response.ok) throw new Error('Failed to create bookmark');
    return response.json();
  },
  async updateBookmark(id, updates) {
    const response = await fetch(`${API_BASE_URL}/bookmarks/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(updates) });
    if (!response.ok) throw new Error('Failed to update bookmark');
    return response.json();
  },
  async deleteBookmark(id) {
    const response = await fetch(`${API_BASE_URL}/bookmarks/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (!response.ok) throw new Error('Failed to delete bookmark');
    return response.json();
  },
  async generateBibliography(threadId, format) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/bibliography`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ format }) });
    if (!response.ok) throw new Error('Bibliography generation failed');
    return response.json();
  },

  // ── Phase 6: Confidence History & Timeline ──────────────────────────────────
  async createSnapshot(threadId, trigger, triggerDetail) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/snapshots`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ trigger, triggerDetail }) });
    if (!response.ok) throw new Error('Snapshot creation failed');
    return response.json();
  },
  async getSnapshots(threadId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/snapshots`);
    if (!response.ok) throw new Error('Failed to fetch snapshots');
    return response.json();
  },
  async getSnapshotDiff(threadId, v1, v2) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/snapshots/diff?v1=${v1}&v2=${v2}`);
    if (!response.ok) throw new Error('Failed to compute diff');
    return response.json();
  },
  async recordConfidence(threadId, { score, breakdown, verdict }) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/confidence`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ score, breakdown, verdict }) });
    if (!response.ok) throw new Error('Failed to record confidence');
    return response.json();
  },
  async getConfidenceHistory(threadId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/confidence`);
    if (!response.ok) throw new Error('Failed to fetch confidence history');
    return response.json();
  },
  async getTimeline(threadId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/timeline`);
    if (!response.ok) throw new Error('Failed to fetch timeline');
    return response.json();
  },
  async getNodeHistory(threadId, nodeId) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/nodes/${nodeId}/history`);
    if (!response.ok) throw new Error('Failed to fetch node history');
    return response.json();
  },
  async exportThread(threadId, format) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format }) });
    if (!response.ok) throw new Error('Export failed');
    return response.json();
  },
};
