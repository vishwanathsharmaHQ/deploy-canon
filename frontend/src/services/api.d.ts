import type {
  User,
  Thread,
  ThreadNode,
  Edge,
  CrossThreadLink,
  ChatCitation,
  ChatStreamDoneEvent,
  ChatExtractResult,
  ChatHistoryItem,
  NodeSuggestion,
  LayoutData,
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
  IngestResult,
  Bookmark,
  Snapshot,
  SnapshotDiff,
  ConfidenceRecord,
  TimelineEvent,
  NodeHistoryEntry,
  ExportResult,
  VerifySourceResult,
} from '../types';

export function setAuthToken(token: string | null): void;

export const api: {
  // Thread operations
  getThreads(): Promise<Thread[]>;
  createThread(data: { title: string; description?: string; content?: string; metadata?: Record<string, unknown> }): Promise<Thread>;
  searchThreads(query: string): Promise<Thread[]>;
  generateThread(topic: string): Promise<Thread>;
  getThreadNodes(threadId: number): Promise<{ nodes: ThreadNode[]; edges: Edge[] }>;

  // Node operations
  createNode(data: { threadId: number; title: string; content: string; nodeType: string; parentId?: number | null; metadata?: Record<string, unknown> }): Promise<ThreadNode>;
  deleteNode(threadId: number, nodeId: number, force?: boolean): Promise<{ ok: boolean; hasChildren?: boolean; childCount?: number }>;
  updateNode(threadId: number, nodeId: number, data: { title?: string; content?: string }): Promise<ThreadNode>;
  createNodesBatch(threadId: number, nodes: Array<{ title: string; content: string; nodeType: string; parentId?: number | null }>): Promise<{ createdNodes: ThreadNode[]; duplicateSkipped: string[] }>;
  generateNodeSuggestions(data: { nodeId: number; nodeType: string; content: string; title: string }): Promise<{ suggestions: NodeSuggestion[] }>;
  reparentNode(threadId: number, nodeId: number, newParentId: number | null): Promise<{ ok: boolean; newParentId: number | null }>;
  updateNodeOrder(threadId: number, nodeId: number, chronological_order: number): Promise<{ ok: boolean; chronological_order: number }>;
  enrichNode(threadId: number, nodeId: number): Promise<{ enrichedContent: string; children: ThreadNode[] }>;

  // Edge operations
  createEdge(data: { sourceId: number; targetId: number; relationshipType?: string; metadata?: Record<string, unknown> }): Promise<Edge>;

  // Layout / Canvas / Sequence
  saveThreadLayout(threadId: number, layout: LayoutData): Promise<{ ok: boolean }>;
  loadThreadLayout(threadId: number): Promise<LayoutData | null>;
  deleteThreadLayout(threadId: number): Promise<{ ok: boolean }>;
  saveThreadCanvas(threadId: number, canvas: Record<string, unknown>): Promise<{ ok: boolean }>;
  loadThreadCanvas(threadId: number): Promise<Record<string, unknown> | null>;
  deleteThreadCanvas(threadId: number): Promise<{ ok: boolean }>;
  updateThreadContent(threadId: number, content: string): Promise<{ ok: boolean }>;
  saveArticleSequence(threadId: number, sequence: number[]): Promise<{ ok: boolean }>;
  loadArticleSequence(threadId: number): Promise<number[] | null>;
  deleteArticleSequence(threadId: number): Promise<{ ok: boolean }>;
  suggestSequence(threadId: number): Promise<{ sequence: number[] }>;

  // Chat
  chatStream(opts: {
    message: string;
    history?: Array<{ role: string; content: string }>;
    threadId?: number | null;
    apiKey?: string;
    nodeContext?: Record<string, unknown> | null;
    onToken?: (t: string) => void;
    onProcessing?: () => void;
    onDone?: (e: ChatStreamDoneEvent) => void;
    onError?: (e: Error) => void;
  }): Promise<void>;
  chatExtract(data: {
    message: string;
    reply: string;
    threadId?: number | null;
    apiKey?: string;
    nodeContext?: Record<string, unknown> | null;
    citations?: ChatCitation[];
  }): Promise<ChatExtractResult>;
  getThreadChats(threadId: number): Promise<ChatHistoryItem[]>;
  getChat(chatId: number): Promise<ChatRecord>;
  createChat(data: { threadId: number; title: string; messages: Array<{ role: string; content: string; citations?: ChatCitation[]; createdNodes?: ThreadNode[] }> }): Promise<{ id: number; title: string; created_at: string }>;
  updateChat(chatId: number, data: { title?: string; messages?: Array<{ role: string; content: string }> }): Promise<{ id: number | null; title: string; updated_at: string }>;

  // Thread actions
  redTeamThread(threadId: number, nodeId?: number): Promise<RedTeamResult>;
  steelmanNode(threadId: number, nodeId: number): Promise<SteelmanResult>;
  forkThread(threadId: number, opts?: { altClaim?: string }): Promise<ForkResult>;
  analyzeThread(threadId: number): Promise<AnalysisResult>;

  // Socratic
  socraticQuestion(data: { threadId: number; history: SocraticHistoryEntry[]; currentAnswer?: string; nodeContext?: { nodeId: number; nodeType: string; title: string; content: string } | null }): Promise<SocraticResult>;
  getSocraticHistory(threadId: number): Promise<SocraticHistoryEntry[]>;
  saveSocraticHistory(threadId: number, history: SocraticHistoryEntry[]): Promise<{ ok: boolean }>;

  // Auth
  register(data: { name?: string; email: string; password: string }): Promise<User>;
  login(data: { email: string; password: string }): Promise<User>;
  getMe(): Promise<User>;
  logout(): void;

  // Search
  semanticSearch(query: string, limit?: number): Promise<SemanticSearchResult>;
  searchAnswer(question: string): Promise<SearchAnswerResult>;
  getRelatedThreads(threadId: number): Promise<Array<Thread & { relevance: number }>>;
  getRandomThread(): Promise<Thread>;
  findContradictions(threadId: number): Promise<{ contradictions: ContradictionMatch[] }>;

  // Links
  createLink(data: { sourceNodeId: number; targetNodeId: number; type?: string; description?: string; confidence?: number; status?: string }): Promise<{ id: number; sourceNodeId: number; targetNodeId: number; type: string; description: string; confidence: number; status: string }>;
  getNodeLinks(nodeId: number): Promise<CrossThreadLink[]>;
  deleteLink(linkId: number): Promise<{ ok: boolean }>;
  updateLinkStatus(linkId: number, status: string): Promise<{ ok: boolean }>;
  suggestLinks(threadId: number): Promise<{ suggestions: LinkSuggestion[] }>;

  // Graph / Concepts
  getGlobalGraphSummary(): Promise<GlobalGraphThread[]>;
  getConcepts(): Promise<Concept[]>;
  getConceptNodes(conceptId: number): Promise<ConceptNode[]>;
  extractConcepts(nodeId: number): Promise<{ concepts: string[] }>;

  // Review
  initReview(threadId: number): Promise<{ ok: boolean; reviewableNodes: number }>;
  getDueReviews(threadId?: number): Promise<ReviewCard[]>;
  submitReview(nodeId: number, quality: number): Promise<{ easiness: number; interval: number; repetitions: number; dueDate: string }>;
  getReviewStats(threadId?: number): Promise<ReviewStats>;
  getDecayData(threadId: number): Promise<DecayDataPoint[]>;
  generateQuiz(nodeId: number, quizType?: string): Promise<QuizResult>;

  // Ingestion
  ingestUrl(url: string, threadId?: number | null): Promise<IngestResult>;
  ingestPdf(pdfBase64: string, filename: string, threadId?: number | null): Promise<IngestResult>;
  getBookmarks(): Promise<Bookmark[]>;
  createBookmark(data: { url: string; title?: string; notes?: string; source_type?: string }): Promise<Bookmark>;
  updateBookmark(id: number, updates: Record<string, unknown>): Promise<Bookmark>;
  deleteBookmark(id: number): Promise<{ ok: boolean }>;
  generateBibliography(threadId: number, format: string): Promise<{ content: string }>;

  // Snapshots / Confidence / Timeline
  createSnapshot(threadId: number, trigger: string, triggerDetail?: string): Promise<{ id: number; version: number; trigger: string; nodeCount: number; created_at: string }>;
  getSnapshots(threadId: number): Promise<Snapshot[]>;
  getSnapshotDiff(threadId: number, v1: number, v2: number): Promise<SnapshotDiff>;
  recordConfidence(threadId: number, data: { score: number; breakdown?: Record<string, number>; verdict?: string; node_count?: number }): Promise<{ id: number; score: number; created_at: string }>;
  getConfidenceHistory(threadId: number): Promise<ConfidenceRecord[]>;
  getTimeline(threadId: number): Promise<TimelineEvent[]>;
  getNodeHistory(threadId: number, nodeId: number): Promise<{ history: NodeHistoryEntry[] }>;
  exportThread(threadId: number, format: string): Promise<ExportResult>;

  // Admin
  setupIndexes(): Promise<{ ok: boolean }>;
  migrateEmbeddings(): Promise<{ ok: boolean }>;
  verifySource(data: { url: string; claim: string }): Promise<VerifySourceResult>;
};
