import type { Record as Neo4jRecord } from 'neo4j-driver';

// Neo4j record alias
export type NeoRecord = Neo4jRecord;

// Props coming off neo4j node.properties
export interface Neo4jProps {
  [key: string]: unknown;
}

// Return shape from formatThread
export interface ThreadData {
  id: number | null;
  title: string;
  description: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  nodes: NodeData[];
}

// Return shape from formatNode
export interface NodeData {
  id: number | null;
  title: string;
  content: string;
  node_type: string;
  parent_id: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  type: number;
}

// Snapshot diff structures
export interface SnapshotNode {
  id: number | null;
  title: string;
  content: string;
  node_type: string;
  parentId: number | null;
}

// Timeline events
export interface TimelineEvent {
  type: string;
  title?: string;
  nodeId?: number | null;
  nodeType?: string;
  version?: number | null;
  trigger?: string;
  score?: unknown;
  verdict?: string;
  timestamp: string;
}

// Chat/extraction types
export interface Citation {
  url: string;
  title: string;
}

export interface ProposedNode {
  type: string;
  title: string;
  content: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ExtractionResult {
  topicShift: boolean;
  newThreadTitle: string;
  newThreadDescription: string;
  proposedUpdate: {
    nodeId: number;
    title: string;
    description: string;
    content: string;
  } | null;
  nodes: { type: string; title: string; content: string }[];
}

// Link suggestions
export interface LinkSuggestion {
  sourceNodeId: number | null;
  sourceNodeTitle: string;
  targetNodeId: number | null;
  targetNodeTitle: string;
  targetNodeType: string;
  threadId: number | null;
  threadTitle: string;
  similarity: number;
}

// Contradictions
export interface ContradictionMatch {
  sourceNode: { id: number | null; title: string; node_type: string };
  similarNode: { id: number | null; title: string; node_type: string };
  threadId: number | null;
  threadTitle: string;
  similarity: number;
}

// Ingestion
export interface IngestNode {
  type: string;
  title: string;
  content: string;
  sourceUrl?: string;
}

// Cloned node used in fork
export interface ClonedNode {
  id: number;
  title: string;
  content: string;
  node_type: string;
  oldParentId: number | null;
  metadata: string;
}
