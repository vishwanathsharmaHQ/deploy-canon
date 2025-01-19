// Use relative path since frontend is served by backend
const API_BASE_URL = '/api';

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
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, description, content, metadata }),
    });
    if (!response.ok) throw new Error('Failed to create thread');
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
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, content, nodeType, parentId, metadata }),
    });
    if (!response.ok) throw new Error('Failed to create node');
    return response.json();
  },

  // Edge operations
  async createEdge({ sourceId, targetId, relationshipType, metadata }) {
    const response = await fetch(`${API_BASE_URL}/edges`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sourceId, targetId, relationshipType, metadata }),
    });
    if (!response.ok) throw new Error('Failed to create edge');
    return response.json();
  },
}; 