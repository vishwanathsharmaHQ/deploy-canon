// Domain types for Deploy Canon

// ── Entity Types ──────────────────────────────────────────────────────────

export type EntityType = 'claim' | 'evidence' | 'source' | 'context' | 'example' | 'counterpoint' | 'synthesis' | 'question' | 'note';

export type RelationType = 'SUPPORTS' | 'CONTRADICTS' | 'QUALIFIES' | 'DERIVES_FROM' | 'ILLUSTRATES' | 'CITES' | 'ADDRESSES' | 'REFERENCES';

/** Backward compat alias */
export type NodeTypeName = EntityType;

export type ThreadType = 'argument' | 'research' | 'timeline' | 'comparison' | 'collection';

// ── Core Interfaces ───────────────────────────────────────────────────────

export interface ThreadNode {
  id: number;
  title: string;
  content: string;
  entity_type: EntityType;
  metadata: NodeMetadata;
  created_at: string;
  updated_at: string;
  created_by?: number | null;
  confidence?: number | null;
  summary?: string;
  // Thread-specific context (from INCLUDES relationship)
  position?: number;
  role?: string;
  // Backward compat helpers (computed on frontend)
  node_type: string;        // uppercase version of entity_type for display
  type: number;             // index into ENTITY_TYPES for legacy code
  parent_id: number | null; // first SUPPORTS/DERIVES_FROM source, for tree compat
  threadId?: number;
  confidence_score?: number | null; // legacy alias for confidence
}

export interface NodeMetadata {
  title: string;
  description?: string;
  [key: string]: unknown;
}

export interface Source {
  id: number;
  title: string;
  url?: string | null;
  source_type: string;
  authors?: string[];
  published_date?: string | null;
  content?: string;
  reliability_score?: number | null;
  citation_count?: number | null;
  created_at: string;
  updated_at: string;
}

export interface Relationship {
  id: number;
  source_id: number;
  target_id: number;
  relation_type: RelationType;
  properties: RelationshipProps;
  created_at: string;
  created_by?: number | null;
}

export interface RelationshipProps {
  strength?: number;
  mechanism?: string;
  severity?: string;
  explanation?: string;
  scope?: string;
  reasoning?: string;
  confidence?: number;
  relevance?: number;
  page?: string;
  section?: string;
  quote?: string;
  anchor_text?: string;
  context?: string;
  notes?: string;
}

export interface Thread {
  id: number;
  title: string;
  description: string;
  thread_type: string;
  created_at: string;
  updated_at: string;
  created_by?: number | null;
  nodes: ThreadNode[];
  relationships?: Relationship[];
  sources?: Source[];
  // Backward compat
  content: string;          // empty string for compat
  metadata: ThreadMetadata;
  edges?: Edge[];
  forked_from?: number | null;
}

export interface ThreadMetadata {
  title: string;
  description?: string;
  content?: string;
  createdAt?: string;
  version?: number;
  thread_type?: ThreadType;
  [key: string]: unknown;
}

/** Legacy edge interface — kept for backward compat */
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

export interface ValidationIssue {
  type: 'fallacy' | 'missing_link' | 'circular' | 'over_reliance' | 'unsupported' | 'contradiction';
  fallacy_name?: string;
  node_ids: number[];
  description: string;
  severity: 'high' | 'medium' | 'low';
  suggestion: string;
}

export interface ValidationResult {
  chain_strength: number;
  summary: string;
  issues: ValidationIssue[];
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
  | 'editor'
  | 'summary'
  | 'dashboard'
  | 'compare'
  | 'citations'
  | 'highlights';

export interface CitationSource {
  id: string;
  title: string;
  url?: string;
  referenceCount: number;
  threadCount: number;
  threads: Array<{ id: number; title: string }>;
  nodes: Array<{ id: number; title: string; threadId: number }>;
  isSinglePointOfFailure: boolean;
}

export interface CitationConnection {
  sourceA: string;
  sourceB: string;
  sharedThreads: number;
}

export interface CitationNetwork {
  sources: CitationSource[];
  connections: CitationConnection[];
  stats: {
    totalSources: number;
    avgReferencesPerSource: number;
    singlePointOfFailureCount: number;
  };
}

export interface ComparisonNode {
  id: number;
  title: string;
  node_type: string;
  content_preview: string;
}

export interface ThreadComparison {
  threadA: { id: number; title: string; nodeCount: number };
  threadB: { id: number; title: string; nodeCount: number };
  shared: Array<{ nodeA: ComparisonNode; nodeB: ComparisonNode; similarity: number }>;
  contradictions: Array<{ nodeA: ComparisonNode; nodeB: ComparisonNode; reason: string }>;
  uniqueToA: ComparisonNode[];
  uniqueToB: ComparisonNode[];
}

export interface DashboardStats {
  totalThreads: number;
  totalNodes: number;
  nodeTypeDistribution: Record<string, number>;
  averageConfidence: number | null;
  lowConfidenceThreads: Array<{ id: number; title: string; confidence: number }>;
  recentNodes: Array<{ id: number; title: string; nodeType: string; threadId: number; threadTitle: string; created_at: string }>;
  totalEvidence: number;
  totalCounterpoints: number;
}

export interface ThreadSummary {
  executive_summary: string;
  key_arguments: Array<{ title: string; supporting_evidence_count: number; confidence: number }>;
  overall_verdict: string;
  word_count: number;
  generated_at: string;
}

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
  relationType?: string;
  chronological_order?: number;
}

export interface RedTeamResult {
  proposals: Array<{ title: string; content: string; entityType: string }>;
  parentNodeId: number;
}

export interface SteelmanResult {
  proposal: { title: string; content: string; entityType: string };
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

export interface VocabWord {
  id: number | null;
  word: string;
  definition: string;
  partOfSpeech: string;
  pronunciation: string;
  exampleSentence: string;
  etymology: string;
  context: string;
  createdAt: string;
  reviewDueDate: string;
  reviewInterval: number;
  reviewEasiness: number;
  reviewRepetitions: number;
}

export interface VocabStats {
  total: number | null;
  due: number | null;
  mastered: number | null;
  reviewed: number | null;
}

export interface VocabLookupResult {
  word: string;
  definition: string;
  partOfSpeech: string;
  pronunciation: string;
  example: string;
  etymology: string;
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

export interface DevilsAdvocateChallenge {
  targetNodeId: number;
  targetNodeTitle: string;
  challengeQuestion: string;
  counterargument: { title: string; content: string; nodeType: string };
  severity: 'high' | 'medium' | 'low';
}

export interface DevilsAdvocateResult {
  challenges: DevilsAdvocateChallenge[];
  unchallengedCount: number;
  totalNodes: number;
}

export interface WebEvidence {
  title: string;
  content: string;
  source_url: string;
  relevance: 'high' | 'medium' | 'low';
  relationship: 'supports' | 'contradicts' | 'extends';
  relatedNodeId?: number;
  relatedNodeTitle?: string;
  proposedNodeType: string;
}

export interface WebEvidenceResult {
  query: string;
  findings: WebEvidence[];
  searched_at: string;
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
