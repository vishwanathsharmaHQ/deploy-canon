const API_BASE_URL = 'http://localhost:3001/api';

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

  async searchThreads(query) {
    const response = await fetch(`${API_BASE_URL}/threads/search?query=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error('Failed to search threads');
    return response.json();
  },

  async generateThread(topic) {
    const response = await fetch(`${API_BASE_URL}/threads/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
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
      headers: {
        'Content-Type': 'application/json',
      },
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
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sourceId, targetId, relationshipType, metadata }),
    });
    if (!response.ok) throw new Error('Failed to create edge');
    return response.json();
  },

  // Thread layout functions
  async saveThreadLayout(threadId, layout) {
    const response = await fetch(`${API_BASE_URL}/threads/${threadId}/layout`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
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
    });
    
    if (!response.ok) {
      throw new Error('Failed to delete thread layout');
    }
    
    return response.json();
  },

  async generateNodeSuggestions({ nodeId, nodeType, content, title }) {
    const response = await fetch(`${API_BASE_URL}/nodes/suggest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nodeId, nodeType, content, title }),
    });
    if (!response.ok) throw new Error('Failed to generate suggestions');
    return response.json();
  },
}; 