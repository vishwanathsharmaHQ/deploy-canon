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
    console.log('API createNode request:', { threadId, title, content, nodeType, parentId, metadata });
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/nodes`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title, content, nodeType, parentId, metadata }),
    });
    if (!response.ok) throw new Error('Failed to create node');
    const data = await response.json();
    console.log('API createNode response:', data);
    return data;
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
};
