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

export type ThreadType = 'standard' | 'historical' | 'debate' | 'comparison';

export interface ThreadMetadata {
  title: string;
  description?: string;
  content?: string;
  createdAt?: string;
  version?: number;
  thread_type?: ThreadType;
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
  id: number | null;
  type: string;
  description: string;
  confidence: number;
  status: string;
  direction: string;
  otherNode: {
    id: number | null;
    title: string;
    node_type: string;
  };
  threadId: number | null;
  threadTitle: string;
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
  id: number | null;
  version: number | null;
  trigger: string;
  triggerDetail?: string;
  nodeCount: number;
  confidenceScore?: number | null;
  created_at: string;
}

export interface ConfidenceRecord {
  id: number | null;
  score: number;
  verdict: string;
  breakdown: Record<string, number>;
  nodeCount?: number | null;
  created_at: string;
}

export interface ReviewCard {
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

export interface ReviewStats {
  total: number | null;
  reviewable: number | null;
  due: number | null;
  mastered: number | null;
  reviewed: number | null;
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
  title?: string;
  nodeId?: number | null;
  nodeType?: string;
  version?: number | null;
  trigger?: string;
  score?: unknown;
  verdict?: string;
  timestamp: string;
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

// ── API return types ────────────────────────────────────────────────────────

export interface NodeSuggestion {
  title: string;
  content: string;
  type: string;
}

export interface LayoutData {
  nodes: Record<string, { x: number; y: number }>;
  settings?: { isMatteMode?: boolean };
}

export interface ChatStreamDoneEvent {
  type: 'done';
  reply?: string;
  citations?: ChatCitation[];
}

export interface ChatCitation {
  url: string;
  title: string;
}

export interface ChatExtractResult {
  citations: ChatCitation[];
  proposedNodes: ProposedNode[];
  threadId: number | null;
  newThread: { id: number; title: string; description: string } | null;
  proposedUpdate: { nodeId: number; title: string; description: string; content: string } | null;
}

export interface ProposedNode {
  type: string;
  title: string;
  content: string;
  chronological_order?: number;
}

export interface RedTeamResult {
  proposals: Array<{ title: string; content: string; nodeType: string }>;
  parentNodeId: number;
}

export interface SteelmanResult {
  proposal: { title: string; content: string; nodeType: string };
  parentId: number | null;
}

export interface ForkResult {
  thread: {
    id: number;
    title: string;
    description: string;
    content: string;
    metadata: Record<string, unknown>;
    nodes: ThreadNode[];
    edges: Edge[];
    forkedFrom: number;
  };
}

export interface AnalysisResult {
  score: number;
  breakdown: Record<string, number>;
  verdict: string;
  strengths?: string[];
  gaps?: string[];
  summary?: string;
}

export interface SocraticResult {
  question: string;
  nodeFromAnswer?: { type: string; title: string; content: string } | null;
}

export interface SocraticHistoryEntry {
  role: string;
  content: string;
}

export interface SemanticSearchResult {
  threads: Array<Thread & { relevance: number }>;
  nodes: Array<ThreadNode & { relevance: number; threadId: number | null; threadTitle: string }>;
}

export interface SearchAnswerResult {
  answer: string;
  sources: Array<{
    nodeId: number | null;
    nodeTitle: string;
    threadId: number | null;
    threadTitle: string;
    relevance: number;
  }>;
}

export interface ContradictionMatch {
  sourceNode: { id: number | null; title: string; node_type: string };
  similarNode: { id: number | null; title: string; node_type: string };
  threadId: number | null;
  threadTitle: string;
  similarity: number;
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

export interface GlobalGraphThread {
  id: number | null;
  title: string;
  description: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  nodes: ThreadNode[];
  nodeCount: number | null;
  crossLinkCount: number | null;
  linkedThreadIds: (number | null)[];
}

export interface Concept {
  id: number | null;
  name: string;
  aliases: string[];
  usageCount: number | null;
}

export interface ConceptNode {
  id: number | null;
  title: string;
  content: string;
  node_type: string;
  parent_id: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  type: number;
  threadId: number | null;
  threadTitle: string;
}

export interface DecayDataPoint {
  nodeId: number | null;
  decayPercent: number;
  daysSinceDue: number;
}

export interface QuizResult {
  question: string;
  hint?: string;
  idealAnswer?: string;
}

export interface IngestResult {
  title: string;
  summary?: string;
  truncated?: boolean;
  sourceUrl?: string;
  threadId?: number | null;
  proposedNodes?: Array<{ title: string; content: string; type: NodeTypeName }>;
  pageCount?: number;
}

export interface SnapshotDiffNode {
  id: number | null;
  title: string;
  content: string;
  node_type: string;
  parentId: number | null;
}

export interface SnapshotDiff {
  added: SnapshotDiffNode[];
  removed: SnapshotDiffNode[];
  modified: SnapshotDiffNode[];
  v1NodeCount: number;
  v2NodeCount: number;
}

export interface NodeHistoryEntry {
  version: number;
  title: string;
  content: string;
  updated_at: string;
}

export interface ExportResult {
  // Markdown format
  markdown?: string;
  content?: string;
  title?: string;
  // JSON format
  thread?: { id: number | null; title: string; description: string };
  nodes?: Array<{ id: number | null; title: string; content: string; node_type: string; parentId: number | null }>;
}

export interface VerifySourceResult {
  verified: boolean;
  confidence: number;
  explanation: string;
  status?: string;
}

export interface ChatRecord {
  id: number;
  threadId: number;
  title: string;
  messages: Message[];
  created_at: string;
  updated_at: string;
}

export interface ChatHistoryItem {
  id: number | null;
  title: string;
  messageCount: number;
  created_at: string;
  updated_at: string;
}
