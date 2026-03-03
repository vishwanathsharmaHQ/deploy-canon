// Domain types for Deploy Canon

export interface Thread {
  id: number;
  title: string;
  description: string;
  content: string;
  metadata: ThreadMetadata;
  created_at: string;
  updated_at: string;
  nodes: ThreadNode[];
  edges?: Edge[];
}

export interface ThreadMetadata {
  title: string;
  description?: string;
  content?: string;
  createdAt?: string;
  version?: number;
  [key: string]: unknown;
}

export interface ThreadNode {
  id: number;
  title: string;
  content: string;
  node_type: NodeTypeName;
  parent_id: number | null;
  type: number; // index into NODE_TYPES
  metadata: NodeMetadata;
  created_at: string;
  updated_at: string;
  threadId?: number;
}

export interface NodeMetadata {
  title: string;
  description?: string;
  [key: string]: unknown;
}

export interface Edge {
  source_id: number;
  target_id: number;
  relationship_type: string;
}

export interface CrossThreadLink {
  id: number;
  sourceNodeId: number;
  targetNodeId: number;
  type: string;
  description: string;
  confidence: number;
  status: string;
  created_at: string;
  otherNode?: {
    id: number;
    title: string;
    node_type: NodeTypeName;
    threadId: number;
    threadTitle: string;
  };
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  extractedNodes?: ExtractedNode[];
}

export interface Citation {
  nodeId: number;
  title: string;
  content: string;
  node_type: NodeTypeName;
}

export interface Chat {
  id: number;
  threadId: number;
  title: string;
  messages: Message[];
  created_at: string;
  updated_at: string;
}

export interface Snapshot {
  id: number;
  threadId: number;
  version: number;
  trigger: string;
  triggerDetail?: string;
  nodeCount: number;
  edgeCount: number;
  created_at: string;
}

export interface ConfidenceRecord {
  id: number;
  threadId: number;
  score: number;
  breakdown: Record<string, number>;
  verdict: string;
  created_at: string;
}

export interface ReviewCard {
  id: number;
  nodeId: number;
  title: string;
  content: string;
  node_type: NodeTypeName;
  interval: number;
  repetitions: number;
  ease_factor: number;
  next_review: string;
  last_review: string;
}

export interface ReviewStats {
  total: number;
  due: number;
  mastered: number;
  avgEase: number;
}

export interface Bookmark {
  id: number;
  url: string;
  title: string;
  notes: string;
  source_type: string;
  status: string;
  created_at: string;
}

export interface TimelineEvent {
  type: string;
  title: string;
  nodeType?: NodeTypeName;
  timestamp: string;
  detail?: string;
}

export interface User {
  id: number;
  email: string;
  name: string;
}

export interface ExtractedNode {
  title: string;
  content: string;
  nodeType: NodeTypeName;
  parentId?: number;
}

export type NodeTypeName =
  | 'ROOT'
  | 'EVIDENCE'
  | 'REFERENCE'
  | 'CONTEXT'
  | 'EXAMPLE'
  | 'COUNTERPOINT'
  | 'SYNTHESIS';

export type ViewName =
  | 'graph'
  | 'global'
  | 'article'
  | 'sequence'
  | 'canvas'
  | 'chat'
  | 'review'
  | 'ingest'
  | 'timeline'
  | 'editor';
