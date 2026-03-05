import type { Record as Neo4jRecord } from 'neo4j-driver';

export type NeoRecord = Neo4jRecord;

export interface Neo4jProps {
  [key: string]: unknown;
}

// ── Entity Types ──────────────────────────────────────────────────────────
export type EntityType = 'claim' | 'evidence' | 'source' | 'context' | 'example' | 'counterpoint' | 'synthesis' | 'question' | 'note';

// ── Relationship Types ────────────────────────────────────────────────────
export type RelationType = 'SUPPORTS' | 'CONTRADICTS' | 'QUALIFIES' | 'DERIVES_FROM' | 'ILLUSTRATES' | 'CITES' | 'ADDRESSES' | 'REFERENCES';

export interface RelationshipProps {
  strength?: number;       // 0-1, for SUPPORTS
  mechanism?: string;      // 'causal' | 'correlational' | 'analogical' | 'testimonial', for SUPPORTS
  severity?: string;       // 'undermining' | 'rebutting' | 'undercutting', for CONTRADICTS
  explanation?: string;    // for CONTRADICTS
  scope?: string;          // for QUALIFIES
  reasoning?: string;      // for DERIVES_FROM
  confidence?: number;     // 0-1, for DERIVES_FROM
  relevance?: number;      // 0-1, for ILLUSTRATES
  page?: string;           // for CITES
  section?: string;        // for CITES
  quote?: string;          // for CITES
  anchor_text?: string;    // for REFERENCES (internal hyperlinks)
  context?: string;        // for REFERENCES
  notes?: string;          // general notes on any relationship
}

// ── Node Data ─────────────────────────────────────────────────────────────
export interface NodeData {
  id: number | null;
  title: string;
  content: string;           // always HTML
  entity_type: EntityType;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by?: number | null;
  confidence?: number | null;
  summary?: string;
}

// ── Source Data (first-class entity) ──────────────────────────────────────
export interface SourceData {
  id: number | null;
  title: string;
  url?: string | null;
  source_type: string;       // 'paper' | 'book' | 'article' | 'dataset' | 'website' | 'report' | 'other'
  authors?: string[];
  published_date?: string | null;
  content?: string;          // notes/summary about the source
  reliability_score?: number | null;
  citation_count?: number | null;
  created_at: string;
  updated_at: string;
}

// ── Relationship Data (edges returned to frontend) ────────────────────────
export interface RelationshipData {
  id: number;
  source_id: number;
  target_id: number;
  relation_type: RelationType;
  properties: RelationshipProps;
  created_at: string;
  created_by?: number | null;
}

// ── Thread Data ───────────────────────────────────────────────────────────
export interface ThreadData {
  id: number | null;
  title: string;
  description: string;
  thread_type: string;       // 'argument' | 'research' | 'timeline' | 'comparison' | 'collection'
  created_at: string;
  updated_at: string;
  created_by?: number | null;
  nodes: ThreadNodeEntry[];
}

// ── Thread ↔ Node inclusion ───────────────────────────────────────────────
export interface ThreadNodeEntry {
  node: NodeData;
  position: number;
  role: string;              // 'root' | 'supporting' | 'opposing' | 'context' | 'question'
}

// ── Keep existing types needed by other parts of the codebase ─────────────
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

export interface Citation {
  url: string;
  title: string;
}

export interface ProposedNode {
  type: string;
  title: string;
  content: string;
  relationType?: string;
  chronological_order?: number;
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

export interface ContradictionMatch {
  sourceNode: { id: number | null; title: string; node_type: string };
  similarNode: { id: number | null; title: string; node_type: string };
  threadId: number | null;
  threadTitle: string;
  similarity: number;
}

export interface IngestNode {
  type: string;
  title: string;
  content: string;
  sourceUrl?: string;
}

export interface SnapshotNode {
  id: number | null;
  title: string;
  content: string;
  node_type: string;
  parentId: number | null;
}

export interface ClonedNode {
  id: number;
  title: string;
  content: string;
  entity_type: string;
  oldParentId: number | null;
  metadata: string;
}
