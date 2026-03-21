import { toast } from 'sonner';
import type {
  Thread,
  ThreadNode,
  Edge,
  CrossThreadLink,
  Chat,
  ChatRecord,
  ChatHistoryItem,
  ChatStreamDoneEvent,
  ChatExtractResult,
  RedTeamResult,
  SteelmanResult,
  ForkResult,
  AnalysisResult,
  SocraticResult,
  SocraticHistoryEntry,
  SemanticSearchResult,
  SearchAnswerResult,
  ContradictionMatch,
  LinkSuggestion,
  GlobalGraphThread,
  Concept,
  ConceptNode,
  ReviewCard,
  ReviewStats,
  DecayDataPoint,
  QuizResult,
  VocabWord,
  VocabStats,
  VocabLookupResult,
  IngestResult,
  Bookmark,
  Snapshot,
  SnapshotDiff,
  ConfidenceRecord,
  TimelineEvent,
  NodeHistoryEntry,
  ExportResult,
  VerifySourceResult,
  NodeSuggestion,
  LayoutData,
  User,
  ChatCitation,
  ThreadSummary,
  DashboardStats,
  DevilsAdvocateResult,
  ThreadComparison,
  CitationNetwork,
  WebEvidenceResult,
  Source,
  Relationship,
  RelationType,
  RelationshipProps,
  EntityType,
  Annotation,
} from '../types';
import { ENTITY_TYPES } from '../constants';

const API_BASE_URL = '/api';

let _authToken: string | null = localStorage.getItem('authToken');

export function setAuthToken(token: string | null) {
  _authToken = token;
  token ? localStorage.setItem('authToken', token) : localStorage.removeItem('authToken');
}

function authHeaders(): Record<string, string> {
  const base: Record<string, string> = { 'Content-Type': 'application/json' };
  return _authToken ? { ...base, Authorization: `Bearer ${_authToken}` } : base;
}

async function fetchWithAuth<T>(
  url: string,
  options?: RequestInit,
  errorMessage = 'Request failed',
): Promise<T> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: options?.headers ?? authHeaders(),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const msg = (body as Record<string, string>).error || `${errorMessage} (${response.status})`;
      throw new Error(msg);
    }
    return response.json() as Promise<T>;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : errorMessage;
    toast.error(message);
    throw err;
  }
}

async function fetchWithAuthNullable<T>(
  url: string,
  options?: RequestInit,
): Promise<T | null> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: options?.headers ?? authHeaders(),
    });
    if (!response.ok) return null;
    return response.json() as Promise<T>;
  } catch {
    return null;
  }
}

async function fetchWithAuthFallback<T>(
  url: string,
  fallback: T,
  options?: RequestInit,
): Promise<T> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: options?.headers ?? authHeaders(),
    });
    if (!response.ok) return fallback;
    return response.json() as Promise<T>;
  } catch {
    return fallback;
  }
}

/**
 * Add backward-compat fields to raw nodes from the API.
 */
/** Map legacy uppercase node types to new lowercase entity types */
const LEGACY_TYPE_MAP: Record<string, string> = {
  ROOT: 'claim', EVIDENCE: 'evidence', EXAMPLE: 'example',
  COUNTERPOINT: 'counterpoint', REFERENCE: 'source', CONTEXT: 'context',
  SYNTHESIS: 'synthesis', QUESTION: 'question', NOTE: 'note',
};
function normalizeEntityType(type?: string): string {
  if (!type) return 'note';
  return LEGACY_TYPE_MAP[type] ?? LEGACY_TYPE_MAP[type.toUpperCase()] ?? type.toLowerCase();
}

function addNodeCompatFields(rawNodes: Array<Record<string, unknown>>): ThreadNode[] {
  return rawNodes.map((n, i) => ({
    ...n,
    node_type: String(n.entity_type ?? 'claim').toUpperCase(),
    type: ENTITY_TYPES.indexOf(((n.entity_type as string) ?? 'claim') as EntityType),
    parent_id: (n.parent_id as number | null) ?? null,
    position: (n.position as number) ?? i,
    role: (n.role as string) ?? 'supporting',
    confidence_score: (n.confidence as number | null) ?? null,
  })) as unknown as ThreadNode[];
}

export const api = {
  async getThreads(): Promise<Thread[]> {
    return fetchWithAuth<Thread[]>(`${API_BASE_URL}/threads`, { headers: authHeaders() }, 'Failed to fetch threads');
  },

  async createThread({ title, description, thread_type, content, metadata }: {
    title: string; description?: string; thread_type?: string; content?: string; metadata?: Record<string, unknown>;
  }): Promise<Thread> {
    return fetchWithAuth<Thread>(`${API_BASE_URL}/threads`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title, description, thread_type, content, metadata }),
    }, 'Failed to create thread');
  },

  async searchThreads(query: string): Promise<Thread[]> {
    return fetchWithAuth<Thread[]>(
      `${API_BASE_URL}/threads/search?query=${encodeURIComponent(query)}`,
      { headers: authHeaders() },
      'Failed to search threads',
    );
  },

  async generateThread(topic: string): Promise<Thread> {
    return fetchWithAuth<Thread>(`${API_BASE_URL}/threads/generate`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ topic }),
    }, 'Failed to generate thread');
  },

  async getThreadNodes(threadId: number): Promise<{ nodes: ThreadNode[]; relationships: Relationship[]; sources: Source[]; edges: Edge[] }> {
    const raw = await fetchWithAuth<{ nodes: Array<Record<string, unknown>>; relationships?: Relationship[]; sources?: Source[]; edges?: Edge[] }>(
      `${API_BASE_URL}/threads/${threadId}/nodes`,
      { headers: authHeaders() },
      'Failed to fetch nodes',
    );
    const nodes = addNodeCompatFields(raw.nodes ?? []);
    // Build legacy edges from relationships for backward compat
    const relationships = raw.relationships ?? [];
    const sources = raw.sources ?? [];
    const edges: Edge[] = raw.edges ?? relationships.map(r => ({
      source_id: r.source_id,
      target_id: r.target_id,
      relationship_type: r.relation_type,
    }));
    return { nodes, relationships, sources, edges };
  },

  async createNode({ threadId, title, content, entityType, nodeType, parentId, position, role, connectTo, metadata }: {
    threadId: number;
    title: string;
    content: string;
    entityType?: string;
    nodeType?: string;
    parentId?: number | null;
    position?: number;
    role?: string;
    connectTo?: { targetId: number; relationType: RelationType; properties?: RelationshipProps };
    metadata?: Record<string, unknown>;
  }): Promise<ThreadNode> {
    // Normalize legacy uppercase types to new lowercase entity types
    const type = normalizeEntityType(entityType ?? nodeType);
    return fetchWithAuth<ThreadNode>(`${API_BASE_URL}/threads/${threadId}/nodes`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title, content, entityType: type, parentId, position, role, connectTo, metadata }),
    }, 'Failed to create node');
  },

  async createEdge({ sourceId, targetId, relationshipType, relationType, metadata }: {
    sourceId: number; targetId: number; relationshipType?: string; relationType?: string; metadata?: Record<string, unknown>;
  }): Promise<Relationship | Edge> {
    const type = relationType ?? relationshipType ?? 'SUPPORTS';
    // Try new relationships endpoint first, fall back to legacy edges
    return fetchWithAuth<Relationship | Edge>(`${API_BASE_URL}/relationships`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ sourceId, targetId, relationType: type, properties: metadata ?? {} }),
    }, 'Failed to create edge');
  },

  // ── Source CRUD ──────────────────────────────────────────────────────────

  async getSources(): Promise<Source[]> {
    return fetchWithAuth<Source[]>(`${API_BASE_URL}/sources`, { headers: authHeaders() }, 'Failed to fetch sources');
  },

  async createSource(data: { title: string; url?: string; source_type: string; authors?: string[]; published_date?: string; content?: string }): Promise<Source> {
    return fetchWithAuth<Source>(`${API_BASE_URL}/sources`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(data),
    }, 'Failed to create source');
  },

  async getSource(sourceId: number): Promise<Source & { nodes: Array<{ id: number; title: string; threadId: number }> }> {
    return fetchWithAuth<Source & { nodes: Array<{ id: number; title: string; threadId: number }> }>(
      `${API_BASE_URL}/sources/${sourceId}`,
      { headers: authHeaders() },
      'Failed to fetch source',
    );
  },

  async updateSource(sourceId: number, data: Partial<Source>): Promise<Source> {
    return fetchWithAuth<Source>(`${API_BASE_URL}/sources/${sourceId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(data),
    }, 'Failed to update source');
  },

  async deleteSource(sourceId: number): Promise<{ success: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/sources/${sourceId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    }, 'Failed to delete source');
  },

  async getSourceImpact(sourceId: number): Promise<{ vulnerableClaims: Array<{ id: number; title: string; threadId: number }> }> {
    return fetchWithAuth(`${API_BASE_URL}/sources/${sourceId}/impact`, {
      headers: authHeaders(),
    }, 'Failed to fetch source impact');
  },

  // ── Relationship CRUD ───────────────────────────────────────────────────

  async createRelationship(data: { sourceId: number; targetId: number; relationType: RelationType; properties?: RelationshipProps }): Promise<Relationship> {
    return fetchWithAuth<Relationship>(`${API_BASE_URL}/relationships`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(data),
    }, 'Failed to create relationship');
  },

  async getNodeRelationships(nodeId: number): Promise<Relationship[]> {
    return fetchWithAuth<Relationship[]>(
      `${API_BASE_URL}/relationships/node/${nodeId}`,
      { headers: authHeaders() },
      'Failed to fetch relationships',
    );
  },

  async updateRelationship(relationshipId: number, properties: RelationshipProps): Promise<Relationship> {
    return fetchWithAuth<Relationship>(`${API_BASE_URL}/relationships/${relationshipId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ properties }),
    }, 'Failed to update relationship');
  },

  async deleteRelationship(relationshipId: number): Promise<{ success: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/relationships/${relationshipId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    }, 'Failed to delete relationship');
  },

  // ── Layout & Canvas ─────────────────────────────────────────────────────

  async saveThreadLayout(threadId: number, layout: LayoutData): Promise<{ success: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/threads/${threadId}/layout`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ layout }),
    }, 'Failed to save thread layout');
  },

  async loadThreadLayout(threadId: number): Promise<LayoutData> {
    return fetchWithAuth<LayoutData>(
      `${API_BASE_URL}/threads/${threadId}/layout`,
      { headers: authHeaders() },
      'Failed to load thread layout',
    );
  },

  async deleteThreadLayout(threadId: number): Promise<{ success: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/threads/${threadId}/layout`, {
      method: 'DELETE',
      headers: authHeaders(),
    }, 'Failed to delete thread layout');
  },

  async saveThreadCanvas(threadId: number, canvas: Record<string, unknown>): Promise<{ success: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/threads/${threadId}/canvas`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ canvas }),
    }, 'Failed to save thread canvas');
  },

  async loadThreadCanvas(threadId: number): Promise<Record<string, unknown> | null> {
    return fetchWithAuthNullable(`${API_BASE_URL}/threads/${threadId}/canvas`);
  },

  async deleteThreadCanvas(threadId: number): Promise<{ success: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/threads/${threadId}/canvas`, {
      method: 'DELETE',
      headers: authHeaders(),
    }, 'Failed to delete thread canvas');
  },

  async saveNodeCanvas(threadId: number, nodeId: number, canvas: Record<string, unknown>): Promise<{ success: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/threads/${threadId}/nodes/${nodeId}/canvas`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ canvas }),
    }, 'Failed to save node canvas');
  },

  async loadNodeCanvas(threadId: number, nodeId: number): Promise<Record<string, unknown> | null> {
    return fetchWithAuthNullable(`${API_BASE_URL}/threads/${threadId}/nodes/${nodeId}/canvas`);
  },

  async updateThread(threadId: number, updates: { thread_type?: string; title?: string; description?: string }): Promise<{ success: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/threads/${threadId}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(updates),
    }, 'Failed to update thread');
  },

  async deleteThread(threadId: number): Promise<{ ok: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/threads/${threadId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    }, 'Failed to delete thread');
  },

  async updateThreadContent(threadId: number, content: string): Promise<{ success: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/threads/${threadId}/content`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ content }),
    }, 'Failed to update thread content');
  },

  async saveArticleSequence(threadId: number, sequence: number[]): Promise<{ success: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/threads/${threadId}/sequence`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ sequence }),
    }, 'Failed to save article sequence');
  },

  async loadArticleSequence(threadId: number): Promise<number[] | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/threads/${threadId}/sequence`);
      if (!response.ok) return null;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return null;
      const data = await response.json();
      return data?.sequence ?? data;
    } catch {
      return null;
    }
  },

  // ── Highlights ─────────────────────────────────────────────────────────────

  async loadHighlights(threadId: number): Promise<Record<number, string[]>> {
    try {
      const response = await fetch(`${API_BASE_URL}/threads/${threadId}/highlights`);
      if (!response.ok) return {};
      const data = await response.json();
      return data || {};
    } catch {
      return {};
    }
  },

  async saveHighlights(threadId: number, highlights: Record<number, string[]>): Promise<void> {
    await fetchWithAuth(`${API_BASE_URL}/threads/${threadId}/highlights`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ highlights }),
    }, 'Failed to save highlights');
  },

  async loadAnnotations(threadId: number): Promise<Annotation[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/threads/${threadId}/annotations`);
      if (!response.ok) return [];
      const data = await response.json();
      return data || [];
    } catch {
      return [];
    }
  },

  async saveAnnotations(threadId: number, annotations: Annotation[]): Promise<void> {
    await fetchWithAuth(`${API_BASE_URL}/threads/${threadId}/annotations`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ annotations }),
    }, 'Failed to save annotations');
  },

  async deleteArticleSequence(threadId: number): Promise<{ success: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/threads/${threadId}/sequence`, {
      method: 'DELETE',
      headers: authHeaders(),
    }, 'Failed to delete article sequence');
  },

  // ── Node CRUD ───────────────────────────────────────────────────────────

  async deleteNode(threadId: number, nodeId: number, force = false): Promise<{ success: boolean; hasChildren?: boolean; childCount?: number }> {
    return fetchWithAuth(`${API_BASE_URL}/threads/${threadId}/nodes/${nodeId}?force=${force}`, {
      method: 'DELETE',
      headers: authHeaders(),
    }, 'Failed to delete node');
  },

  async updateNode(threadId: number, nodeId: number, { title, content }: { title: string; content: string }): Promise<ThreadNode> {
    return fetchWithAuth<ThreadNode>(`${API_BASE_URL}/threads/${threadId}/nodes/${nodeId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ title, content }),
    }, 'Failed to update node');
  },

  // ── Chat ────────────────────────────────────────────────────────────────

  async chatExtract({ message, reply, threadId, apiKey, nodeContext, citations }: {
    message: string; reply: string; threadId?: number | null; apiKey?: string;
    nodeContext?: unknown; citations?: ChatCitation[];
  }): Promise<ChatExtractResult> {
    try {
      const response = await fetch(`${API_BASE_URL}/chat/extract`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message, reply, threadId, apiKey, nodeContext, citations }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as Record<string, string>).error || 'Extract request failed');
      }
      return response.json();
    } catch (err: unknown) {
      const message_ = err instanceof Error ? err.message : 'Extract request failed';
      toast.error(message_);
      throw err;
    }
  },

  async chatStream({ message, history, threadId, apiKey, nodeContext, onToken, onProcessing, onDone, onError }: {
    message: string;
    history: Array<{ role: string; content: string }>;
    threadId?: number | null;
    apiKey?: string;
    nodeContext?: unknown;
    onToken?: (content: string) => void;
    onProcessing?: () => void;
    onDone?: (event: ChatStreamDoneEvent) => void;
    onError?: (error: Error) => void;
  }): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ message, history, threadId, apiKey, nodeContext }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const errMsg = (err as Record<string, string>).error || 'Chat request failed';
      toast.error(errMsg);
      throw new Error(errMsg);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let receivedDone = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'token') onToken?.(event.content);
          else if (event.type === 'processing') onProcessing?.();
          else if (event.type === 'done') { receivedDone = true; setTimeout(() => onDone?.(event), 0); }
          else if (event.type === 'error') onError?.(new Error(event.error));
        } catch {
          // malformed line
        }
      }
    }

    // Stream ended without a done event — connection was cut mid-stream
    if (!receivedDone) {
      onError?.(new Error('Response was cut off. Please try again.'));
    }
  },

  async debateStream({ message, threadId, mode, history, onToken, onDone, onError }: {
    message: string;
    threadId: number;
    mode: 'defend' | 'attack';
    history: Array<{ role: string; content: string }>;
    onToken?: (content: string) => void;
    onDone?: (event: { type: string; reply: string; weaknesses_found: Array<{ description: string; severity: 'high' | 'medium' | 'low' }> }) => void;
    onError?: (error: Error) => void;
  }): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/chat/debate`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ message, threadId, mode, history }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const errMsg = (err as Record<string, string>).error || 'Debate request failed';
      toast.error(errMsg);
      throw new Error(errMsg);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'token') onToken?.(event.content);
          else if (event.type === 'done') setTimeout(() => onDone?.(event), 0);
          else if (event.type === 'error') onError?.(new Error(event.error));
        } catch {
          // malformed line
        }
      }
    }
  },

  async getThreadChats(threadId: number): Promise<ChatHistoryItem[]> {
    return fetchWithAuth<ChatHistoryItem[]>(
      `${API_BASE_URL}/threads/${threadId}/chats`,
      { headers: authHeaders() },
      'Failed to fetch chats',
    );
  },

  async getChat(chatId: number): Promise<ChatRecord> {
    return fetchWithAuth<ChatRecord>(
      `${API_BASE_URL}/chats/${chatId}`,
      { headers: authHeaders() },
      'Failed to fetch chat',
    );
  },

  async createChat({ threadId, title, messages }: {
    threadId: number; title: string; messages: Array<Record<string, unknown>>;
  }): Promise<ChatRecord> {
    return fetchWithAuth<ChatRecord>(`${API_BASE_URL}/chats`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ threadId, title, messages }),
    }, 'Failed to create chat');
  },

  async updateChat(chatId: number, { title, messages }: { title?: string; messages: Array<Record<string, unknown>> }): Promise<ChatRecord> {
    return fetchWithAuth<ChatRecord>(`${API_BASE_URL}/chats/${chatId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ title, messages }),
    }, 'Failed to update chat');
  },

  // ── AI Operations ──────────────────────────────────────────────────────

  async redTeamThread(threadId: number, nodeId: number): Promise<RedTeamResult> {
    return fetchWithAuth<RedTeamResult>(`${API_BASE_URL}/threads/${threadId}/redteam`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ nodeId }),
    }, 'Red team failed');
  },

  async steelmanNode(threadId: number, nodeId: number): Promise<SteelmanResult> {
    return fetchWithAuth<SteelmanResult>(`${API_BASE_URL}/threads/${threadId}/nodes/${nodeId}/steelman`, {
      method: 'POST',
      headers: authHeaders(),
    }, 'Steelman failed');
  },

  async forkThread(threadId: number, { altClaim }: { altClaim?: string } = {}): Promise<ForkResult> {
    return fetchWithAuth<ForkResult>(`${API_BASE_URL}/threads/${threadId}/fork`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ altClaim }),
    }, 'Fork failed');
  },

  async socraticQuestion({ threadId, history, currentAnswer, nodeContext }: {
    threadId: number; history: SocraticHistoryEntry[]; currentAnswer: string; nodeContext?: unknown;
  }): Promise<SocraticResult> {
    return fetchWithAuth<SocraticResult>(`${API_BASE_URL}/socratic`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ threadId, history, currentAnswer, nodeContext }),
    }, 'Socratic request failed');
  },

  async getSocraticHistory(nodeId: number): Promise<SocraticHistoryEntry[]> {
    const res = await fetchWithAuth<{ history: SocraticHistoryEntry[] }>(
      `${API_BASE_URL}/nodes/${nodeId}/socratic-history`,
      { headers: authHeaders() },
      'Failed to load socratic history',
    );
    return res.history || [];
  },

  async saveSocraticHistory(nodeId: number, history: SocraticHistoryEntry[]): Promise<{ ok: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/nodes/${nodeId}/socratic-history`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ history }),
    }, 'Failed to save socratic history');
  },

  async createNodesBatch(threadId: number, nodes: { title: string; content: string; nodeType: string; parentId?: number | null; connectTo?: { targetId: number; relationType: string } }[]): Promise<{ createdNodes: ThreadNode[]; duplicateSkipped?: string[] }> {
    // Normalize legacy types and send as entityType for server compat
    const normalized = nodes.map(n => ({ ...n, entityType: normalizeEntityType(n.nodeType) }));
    return fetchWithAuth<{ createdNodes: ThreadNode[]; duplicateSkipped?: string[] }>(`${API_BASE_URL}/threads/${threadId}/nodes/batch`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ nodes: normalized }),
    }, 'Batch node create failed');
  },

  async analyzeThread(threadId: number): Promise<AnalysisResult> {
    return fetchWithAuth<AnalysisResult>(`${API_BASE_URL}/threads/${threadId}/analyze`, {
      method: 'POST',
      headers: authHeaders(),
    }, 'Analysis failed');
  },

  async suggestSequence(threadId: number): Promise<{ sequence: number[] }> {
    return fetchWithAuth(`${API_BASE_URL}/threads/${threadId}/sequence/suggest`, {
      method: 'POST',
      headers: authHeaders(),
    }, 'Sequence suggestion failed');
  },

  async verifySource({ url, claim }: { url: string; claim: string }): Promise<VerifySourceResult> {
    return fetchWithAuth<VerifySourceResult>(`${API_BASE_URL}/verify-source`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ url, claim }),
    }, 'Verification failed');
  },

  async generateNodeSuggestions({ nodeId, nodeType, content, title }: {
    nodeId: number; nodeType: string; content: string; title: string;
  }): Promise<{ suggestions: NodeSuggestion[] }> {
    return fetchWithAuth(`${API_BASE_URL}/nodes/suggest`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ nodeId, nodeType, content, title }),
    }, 'Failed to generate suggestions');
  },

  async reparentNode(threadId: number, nodeId: number, newParentId: number | null): Promise<{ success: boolean }> {
    try {
      const response = await fetch(`${API_BASE_URL}/threads/${threadId}/nodes/${nodeId}/parent`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ newParentId }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as Record<string, string>).error || 'Failed to reparent node');
      }
      return response.json();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reparent node';
      toast.error(message);
      throw err;
    }
  },

  async updateNodeOrder(threadId: number, nodeId: number, chronological_order: number): Promise<{ success: boolean }> {
    try {
      const response = await fetch(`${API_BASE_URL}/threads/${threadId}/nodes/${nodeId}/order`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ chronological_order }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as Record<string, string>).error || 'Failed to update node order');
      }
      return response.json();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update node order';
      toast.error(message);
      throw err;
    }
  },

  async enrichNode(threadId: number, nodeId: number): Promise<ThreadNode> {
    return fetchWithAuth<ThreadNode>(`${API_BASE_URL}/threads/${threadId}/nodes/${nodeId}/enrich`, {
      method: 'POST',
      headers: authHeaders(),
    }, 'Failed to enrich node');
  },

  // ── Auth ────────────────────────────────────────────────────────────────

  async register({ name, email, password }: { name: string; email: string; password: string }): Promise<User> {
    const response = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await response.json();
    if (!response.ok) {
      const msg = data.error || 'Registration failed';
      toast.error(msg);
      throw new Error(msg);
    }
    setAuthToken(data.token);
    return data.user;
  },

  async login({ email, password }: { email: string; password: string }): Promise<User> {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (!response.ok) {
      const msg = data.error || 'Login failed';
      toast.error(msg);
      throw new Error(msg);
    }
    setAuthToken(data.token);
    return data.user;
  },

  async getMe(): Promise<User> {
    return fetchWithAuth<User>(
      `${API_BASE_URL}/auth/me`,
      { headers: authHeaders() },
      'Not authenticated',
    );
  },

  logout() {
    setAuthToken(null);
  },

  // ── Admin ───────────────────────────────────────────────────────────────

  async setupIndexes(): Promise<{ success: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/admin/setup-indexes`, {
      method: 'POST',
      headers: authHeaders(),
    }, 'Failed to setup indexes');
  },

  async migrateEmbeddings(): Promise<{ success: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/admin/migrate-embeddings`, {
      method: 'POST',
      headers: authHeaders(),
    }, 'Failed to migrate embeddings');
  },

  // ── Search ──────────────────────────────────────────────────────────────

  async semanticSearch(query: string, limit = 20): Promise<SemanticSearchResult> {
    return fetchWithAuth<SemanticSearchResult>(
      `${API_BASE_URL}/search/semantic?q=${encodeURIComponent(query)}&limit=${limit}`,
      undefined,
      'Semantic search failed',
    );
  },

  async searchAnswer(question: string): Promise<SearchAnswerResult> {
    return fetchWithAuth<SearchAnswerResult>(`${API_BASE_URL}/search/answer`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ question }),
    }, 'Q&A synthesis failed');
  },

  async getRelatedThreads(threadId: number): Promise<Thread[]> {
    return fetchWithAuthFallback<Thread[]>(`${API_BASE_URL}/threads/${threadId}/related`, []);
  },

  async getRandomThread(): Promise<Thread> {
    return fetchWithAuth<Thread>(
      `${API_BASE_URL}/threads/random`,
      undefined,
      'No threads found',
    );
  },

  async findContradictions(threadId: number): Promise<{ contradictions: ContradictionMatch[] }> {
    return fetchWithAuth(`${API_BASE_URL}/search/contradictions`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ threadId }),
    }, 'Contradiction search failed');
  },

  // ── Links ───────────────────────────────────────────────────────────────

  async createLink({ sourceNodeId, targetNodeId, type, description, confidence, status }: {
    sourceNodeId: number; targetNodeId: number; type: string; description: string; confidence: number; status: string;
  }): Promise<CrossThreadLink> {
    return fetchWithAuth<CrossThreadLink>(`${API_BASE_URL}/links`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ sourceNodeId, targetNodeId, type, description, confidence, status }),
    }, 'Failed to create link');
  },

  async getNodeLinks(nodeId: number): Promise<CrossThreadLink[]> {
    return fetchWithAuthFallback<CrossThreadLink[]>(`${API_BASE_URL}/links/node/${nodeId}`, []);
  },

  async deleteLink(linkId: number): Promise<{ success: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/links/${linkId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    }, 'Failed to delete link');
  },

  async updateLinkStatus(linkId: number, status: string): Promise<CrossThreadLink> {
    return fetchWithAuth<CrossThreadLink>(`${API_BASE_URL}/links/${linkId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ status }),
    }, 'Failed to update link');
  },

  async suggestLinks(threadId: number): Promise<{ suggestions: LinkSuggestion[] }> {
    return fetchWithAuth(`${API_BASE_URL}/links/suggest`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ threadId }),
    }, 'Link suggestion failed');
  },

  // ── Graph ───────────────────────────────────────────────────────────────

  async getGlobalGraphSummary(): Promise<GlobalGraphThread[]> {
    return fetchWithAuth<GlobalGraphThread[]>(
      `${API_BASE_URL}/graph/global/summary`,
      undefined,
      'Failed to fetch global graph',
    );
  },

  async getConcepts(): Promise<Concept[]> {
    return fetchWithAuth<Concept[]>(
      `${API_BASE_URL}/graph/concepts`,
      undefined,
      'Failed to fetch concepts',
    );
  },

  async getConceptNodes(conceptId: number): Promise<ConceptNode[]> {
    return fetchWithAuth<ConceptNode[]>(
      `${API_BASE_URL}/graph/concepts/${conceptId}/nodes`,
      undefined,
      'Failed to fetch concept nodes',
    );
  },

  async extractConcepts(nodeId: number): Promise<{ concepts: string[] }> {
    return fetchWithAuth(`${API_BASE_URL}/graph/concepts/extract`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ nodeId }),
    }, 'Concept extraction failed');
  },

  // ── Review ──────────────────────────────────────────────────────────────

  async initReview(threadId: number): Promise<{ created: number }> {
    return fetchWithAuth(`${API_BASE_URL}/review/init`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ threadId }),
    }, 'Review init failed');
  },

  async getDueReviews(threadId?: number): Promise<ReviewCard[]> {
    const url = threadId ? `${API_BASE_URL}/review/due?threadId=${threadId}` : `${API_BASE_URL}/review/due`;
    return fetchWithAuth<ReviewCard[]>(url, undefined, 'Failed to fetch due reviews');
  },

  async submitReview(nodeId: number, quality: number): Promise<{ success: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/review/submit`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ nodeId, quality }),
    }, 'Review submit failed');
  },

  async getReviewStats(threadId?: number): Promise<ReviewStats> {
    const url = threadId ? `${API_BASE_URL}/review/stats?threadId=${threadId}` : `${API_BASE_URL}/review/stats`;
    return fetchWithAuth<ReviewStats>(url, undefined, 'Failed to fetch review stats');
  },

  async getDecayData(threadId: number): Promise<DecayDataPoint[]> {
    return fetchWithAuthFallback<DecayDataPoint[]>(`${API_BASE_URL}/review/decay?threadId=${threadId}`, []);
  },

  async generateQuiz(nodeId: number, quizType: string): Promise<QuizResult> {
    return fetchWithAuth<QuizResult>(`${API_BASE_URL}/review/quiz`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ nodeId, quizType }),
    }, 'Quiz generation failed');
  },

  // ── Vocabulary ────────────────────────────────────────────────────────────

  async vocabLookup(word: string, context: string): Promise<VocabLookupResult> {
    return fetchWithAuth<VocabLookupResult>(`${API_BASE_URL}/vocabulary/lookup`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ word, context }),
    }, 'Dictionary lookup failed');
  },

  async vocabSave(data: { word: string; definition: string; partOfSpeech?: string; pronunciation?: string; example?: string; etymology?: string; context?: string }): Promise<{ id: number; word: string; definition: string; created?: boolean; alreadyExists?: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/vocabulary/words`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(data),
    }, 'Failed to save word');
  },

  async vocabList(threadId?: number | null): Promise<VocabWord[]> {
    const qs = threadId ? `?threadId=${threadId}` : '';
    return fetchWithAuth<VocabWord[]>(`${API_BASE_URL}/vocabulary/words${qs}`, {
      headers: authHeaders(),
    }, 'Failed to fetch vocabulary');
  },

  async vocabDelete(wordId: number): Promise<{ ok: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/vocabulary/words/${wordId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    }, 'Failed to delete word');
  },

  async vocabDue(threadId?: number | null): Promise<VocabWord[]> {
    const qs = threadId ? `?threadId=${threadId}` : '';
    return fetchWithAuth<VocabWord[]>(`${API_BASE_URL}/vocabulary/due${qs}`, {
      headers: authHeaders(),
    }, 'Failed to fetch due words');
  },

  async vocabReview(wordId: number, quality: number): Promise<{ easiness: number; interval: number; repetitions: number; dueDate: string }> {
    return fetchWithAuth(`${API_BASE_URL}/vocabulary/review`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ wordId, quality }),
    }, 'Review submit failed');
  },

  async vocabStats(threadId?: number | null): Promise<VocabStats> {
    const qs = threadId ? `?threadId=${threadId}` : '';
    return fetchWithAuth<VocabStats>(`${API_BASE_URL}/vocabulary/stats${qs}`, {
      headers: authHeaders(),
    }, 'Failed to fetch vocab stats');
  },

  // ── Ingest ──────────────────────────────────────────────────────────────

  async ingestUrl(url: string, threadId?: number | null): Promise<IngestResult> {
    try {
      const response = await fetch(`${API_BASE_URL}/ingest/url`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ url, threadId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error((body as Record<string, string>).error || `URL ingestion failed (${response.status})`);
      }
      return response.json();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'URL ingestion failed';
      toast.error(message);
      throw err;
    }
  },

  async ingestPdf(pdfBase64: string, filename: string, threadId?: number | null): Promise<IngestResult> {
    try {
      const response = await fetch(`${API_BASE_URL}/ingest/pdf`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ pdfBase64, filename, threadId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error((body as Record<string, string>).error || `PDF ingestion failed (${response.status})`);
      }
      return response.json();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'PDF ingestion failed';
      toast.error(message);
      throw err;
    }
  },

  async getBookmarks(): Promise<Bookmark[]> {
    return fetchWithAuth<Bookmark[]>(
      `${API_BASE_URL}/ingest/bookmarks`,
      { headers: authHeaders() },
      'Failed to fetch bookmarks',
    );
  },

  async createBookmark({ url, title, notes, source_type }: {
    url: string; title: string; notes?: string; source_type: string;
  }): Promise<Bookmark> {
    return fetchWithAuth<Bookmark>(`${API_BASE_URL}/ingest/bookmarks`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ url, title, notes, source_type }),
    }, 'Failed to create bookmark');
  },

  async updateBookmark(id: number, updates: Partial<Bookmark>): Promise<Bookmark> {
    return fetchWithAuth<Bookmark>(`${API_BASE_URL}/bookmarks/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(updates),
    }, 'Failed to update bookmark');
  },

  async deleteBookmark(id: number): Promise<{ success: boolean }> {
    return fetchWithAuth(`${API_BASE_URL}/bookmarks/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    }, 'Failed to delete bookmark');
  },

  async generateBibliography(threadId: number, format: string): Promise<{ bibliography: string }> {
    return fetchWithAuth(`${API_BASE_URL}/threads/${threadId}/bibliography`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ format }),
    }, 'Bibliography generation failed');
  },

  // ── Snapshots & Confidence ──────────────────────────────────────────────

  async createSnapshot(threadId: number, trigger: string, triggerDetail?: string): Promise<Snapshot> {
    return fetchWithAuth<Snapshot>(`${API_BASE_URL}/threads/${threadId}/snapshots`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ trigger, triggerDetail }),
    }, 'Snapshot creation failed');
  },

  async getSnapshots(threadId: number): Promise<Snapshot[]> {
    return fetchWithAuth<Snapshot[]>(
      `${API_BASE_URL}/threads/${threadId}/snapshots`,
      undefined,
      'Failed to fetch snapshots',
    );
  },

  async getSnapshotDiff(threadId: number, v1: number, v2: number): Promise<SnapshotDiff> {
    return fetchWithAuth<SnapshotDiff>(
      `${API_BASE_URL}/threads/${threadId}/snapshots/diff?v1=${v1}&v2=${v2}`,
      undefined,
      'Failed to compute diff',
    );
  },

  async recordConfidence(threadId: number, { score, breakdown, verdict, node_count }: {
    score: number; breakdown: Record<string, number>; verdict: string; node_count?: number;
  }): Promise<ConfidenceRecord> {
    return fetchWithAuth<ConfidenceRecord>(`${API_BASE_URL}/threads/${threadId}/confidence`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ score, breakdown, verdict, node_count }),
    }, 'Failed to record confidence');
  },

  async getConfidenceHistory(threadId: number): Promise<ConfidenceRecord[]> {
    return fetchWithAuth<ConfidenceRecord[]>(
      `${API_BASE_URL}/threads/${threadId}/confidence`,
      undefined,
      'Failed to fetch confidence history',
    );
  },

  async getTimeline(threadId: number): Promise<TimelineEvent[]> {
    return fetchWithAuth<TimelineEvent[]>(
      `${API_BASE_URL}/threads/${threadId}/timeline`,
      undefined,
      'Failed to fetch timeline',
    );
  },

  async getNodeHistory(threadId: number, nodeId: number): Promise<NodeHistoryEntry[]> {
    return fetchWithAuth<NodeHistoryEntry[]>(
      `${API_BASE_URL}/threads/${threadId}/nodes/${nodeId}/history`,
      undefined,
      'Failed to fetch node history',
    );
  },

  // ── Validation & Analysis ───────────────────────────────────────────────

  async validateReasoningChain(threadId: number): Promise<{
    chain_strength: number;
    summary: string;
    issues: Array<{
      type: string;
      fallacy_name?: string;
      node_ids: number[];
      description: string;
      severity: string;
      suggestion: string;
    }>;
  }> {
    return fetchWithAuth(`${API_BASE_URL}/threads/${threadId}/validate`, {
      method: 'POST',
      headers: authHeaders(),
    }, 'Reasoning validation failed');
  },

  async getNodeConfidence(threadId: number): Promise<{ scores: Record<number, number> }> {
    return fetchWithAuth(`${API_BASE_URL}/threads/${threadId}/node-confidence`, {
      headers: authHeaders(),
    }, 'Node confidence scoring failed');
  },

  async getTemplates(): Promise<Array<{ key: string; name: string; description: string; nodeCount: number }>> {
    return fetchWithAuth<Array<{ key: string; name: string; description: string; nodeCount: number }>>(
      `${API_BASE_URL}/threads/templates`,
      undefined,
      'Failed to fetch templates',
    );
  },

  async createThreadFromTemplate(templateKey: string, title: string, description?: string): Promise<Thread> {
    return fetchWithAuth<Thread>(`${API_BASE_URL}/threads/from-template`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ templateKey, title, description }),
    }, 'Failed to create thread from template');
  },

  async exportThread(threadId: number, format: string): Promise<ExportResult> {
    return fetchWithAuth<ExportResult>(`${API_BASE_URL}/threads/${threadId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format }),
    }, 'Export failed');
  },

  async generatePerspectives(threadId: number): Promise<{ perspectives: Array<Thread & { nodeCount?: number; perspectiveName?: string }> }> {
    return fetchWithAuth(`${API_BASE_URL}/threads/${threadId}/perspectives`, {
      method: 'POST',
      headers: authHeaders(),
    }, 'Failed to generate perspectives');
  },

  async getPerspectives(threadId: number): Promise<{ perspectives: Array<Thread & { nodeCount?: number; perspectiveName?: string }> }> {
    return fetchWithAuthFallback<{ perspectives: Array<Thread & { nodeCount?: number; perspectiveName?: string }> }>(
      `${API_BASE_URL}/threads/${threadId}/perspectives`,
      { perspectives: [] },
    );
  },

  async generateSummary(threadId: number): Promise<ThreadSummary> {
    return fetchWithAuth<ThreadSummary>(`${API_BASE_URL}/threads/${threadId}/summary`, {
      method: 'POST',
      headers: authHeaders(),
    }, 'Failed to generate summary');
  },

  async getSummary(threadId: number): Promise<ThreadSummary | null> {
    return fetchWithAuthNullable<ThreadSummary>(`${API_BASE_URL}/threads/${threadId}/summary`);
  },

  async getDashboardStats(): Promise<DashboardStats> {
    return fetchWithAuth<DashboardStats>(`${API_BASE_URL}/threads/dashboard/stats`, {
      headers: authHeaders(),
    }, 'Failed to fetch dashboard stats');
  },

  async getDevilsAdvocate(threadId: number): Promise<DevilsAdvocateResult> {
    return fetchWithAuth<DevilsAdvocateResult>(`${API_BASE_URL}/threads/${threadId}/devils-advocate`, {
      method: 'POST',
      headers: authHeaders(),
    }, 'Devil\'s advocate analysis failed');
  },

  async compareThreads(threadIdA: number, threadIdB: number): Promise<ThreadComparison> {
    return fetchWithAuth<ThreadComparison>(`${API_BASE_URL}/threads/compare`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ threadIdA, threadIdB }),
    }, 'Thread comparison failed');
  },

  async watchThread(threadId: number, query?: string): Promise<WebEvidenceResult> {
    return fetchWithAuth<WebEvidenceResult>(`${API_BASE_URL}/threads/${threadId}/watch`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ query }),
    }, 'Web evidence search failed');
  },

  async getCitationNetwork(): Promise<CitationNetwork> {
    return fetchWithAuth<CitationNetwork>(`${API_BASE_URL}/threads/citations/network`, {
      headers: authHeaders(),
    }, 'Failed to fetch citation network');
  },
};
