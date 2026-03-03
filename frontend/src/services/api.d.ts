import type { User, Thread, ThreadNode, Edge } from '../types';

export function setAuthToken(token: string | null): void;

export const api: {
  // Thread operations
  getThreads(): Promise<Thread[]>;
  createThread(data: { title: string; description?: string; content?: string; metadata?: Record<string, any> }): Promise<Thread>;
  searchThreads(query: string): Promise<Thread[]>;
  generateThread(topic: string): Promise<Thread>;
  getThreadNodes(threadId: number): Promise<{ nodes: ThreadNode[]; edges: Edge[] }>;

  // Node operations
  createNode(data: { threadId: number; title: string; content: string; nodeType: string; parentId?: number; metadata?: Record<string, any> }): Promise<ThreadNode>;
  deleteNode(threadId: number, nodeId: number, force?: boolean): Promise<{ ok: boolean }>;
  updateNode(threadId: number, nodeId: number, data: { title?: string; content?: string }): Promise<{ ok: boolean }>;
  createNodesBatch(threadId: number, nodes: Array<{ title: string; content: string; nodeType: string; parentId?: number }>): Promise<{ created: ThreadNode[] }>;
  generateNodeSuggestions(data: { nodeId: number; nodeType: string; content: string; title: string }): Promise<any>;

  // Edge operations
  createEdge(data: { sourceId: number; targetId: number; relationshipType?: string; metadata?: Record<string, any> }): Promise<any>;

  // Layout / Canvas / Sequence
  saveThreadLayout(threadId: number, layout: any): Promise<any>;
  loadThreadLayout(threadId: number): Promise<any>;
  deleteThreadLayout(threadId: number): Promise<any>;
  saveThreadCanvas(threadId: number, canvas: any): Promise<any>;
  loadThreadCanvas(threadId: number): Promise<any>;
  deleteThreadCanvas(threadId: number): Promise<any>;
  updateThreadContent(threadId: number, content: string): Promise<any>;
  saveArticleSequence(threadId: number, sequence: any): Promise<any>;
  loadArticleSequence(threadId: number): Promise<any>;
  deleteArticleSequence(threadId: number): Promise<any>;
  suggestSequence(threadId: number): Promise<any>;

  // Chat
  chatStream(opts: { message: string; history?: any[]; threadId?: number; apiKey?: string; nodeContext?: any; onToken?: (t: string) => void; onProcessing?: () => void; onDone?: (e: any) => void; onError?: (e: Error) => void }): Promise<void>;
  chatExtract(data: { message: string; reply: string; threadId?: number; apiKey?: string; nodeContext?: any; citations?: any[] }): Promise<any>;
  getThreadChats(threadId: number): Promise<any[]>;
  getChat(chatId: number): Promise<any>;
  createChat(data: { threadId: number; title: string; messages: any[] }): Promise<any>;
  updateChat(chatId: number, data: { title?: string; messages?: any[] }): Promise<any>;

  // Thread actions
  redTeamThread(threadId: number, nodeId?: number): Promise<any>;
  steelmanNode(threadId: number, nodeId: number): Promise<any>;
  forkThread(threadId: number, opts?: { altClaim?: string }): Promise<any>;
  analyzeThread(threadId: number): Promise<any>;

  // Socratic
  socraticQuestion(data: { threadId: number; history: any[]; currentAnswer?: string; nodeContext?: any }): Promise<any>;
  getSocraticHistory(threadId: number): Promise<any>;
  saveSocraticHistory(threadId: number, history: any[]): Promise<any>;

  // Auth
  register(data: { name?: string; email: string; password: string }): Promise<User>;
  login(data: { email: string; password: string }): Promise<User>;
  getMe(): Promise<User>;
  logout(): void;

  // Search
  semanticSearch(query: string, limit?: number): Promise<{ threads: any[]; nodes: any[] }>;
  searchAnswer(question: string): Promise<{ answer: string; sources: any[] }>;
  getRelatedThreads(threadId: number): Promise<any[]>;
  getRandomThread(): Promise<Thread>;
  findContradictions(threadId: number): Promise<{ contradictions: any[] }>;

  // Links
  createLink(data: { sourceNodeId: number; targetNodeId: number; type?: string; description?: string; confidence?: number; status?: string }): Promise<any>;
  getNodeLinks(nodeId: number): Promise<any[]>;
  deleteLink(linkId: number): Promise<any>;
  updateLinkStatus(linkId: number, status: string): Promise<any>;
  suggestLinks(threadId: number): Promise<{ suggestions: any[] }>;

  // Graph / Concepts
  getGlobalGraphSummary(): Promise<any[]>;
  getConcepts(): Promise<any[]>;
  getConceptNodes(conceptId: number): Promise<any[]>;
  extractConcepts(nodeId: number): Promise<{ concepts: string[] }>;

  // Review
  initReview(threadId: number): Promise<any>;
  getDueReviews(threadId?: number): Promise<any[]>;
  submitReview(nodeId: number, quality: number): Promise<any>;
  getReviewStats(threadId?: number): Promise<any>;
  getDecayData(threadId: number): Promise<any[]>;
  generateQuiz(nodeId: number, quizType?: string): Promise<any>;

  // Ingestion
  ingestUrl(url: string, threadId?: number): Promise<any>;
  ingestPdf(pdfBase64: string, filename: string, threadId?: number): Promise<any>;
  getBookmarks(): Promise<any[]>;
  createBookmark(data: { url: string; title?: string; notes?: string; source_type?: string }): Promise<any>;
  updateBookmark(id: number, updates: Record<string, any>): Promise<any>;
  deleteBookmark(id: number): Promise<any>;
  generateBibliography(threadId: number, format: string): Promise<any>;

  // Snapshots / Confidence / Timeline
  createSnapshot(threadId: number, trigger: string, triggerDetail?: string): Promise<any>;
  getSnapshots(threadId: number): Promise<any[]>;
  getSnapshotDiff(threadId: number, v1: number, v2: number): Promise<any>;
  recordConfidence(threadId: number, data: { score: number; breakdown?: any; verdict?: string }): Promise<any>;
  getConfidenceHistory(threadId: number): Promise<any[]>;
  getTimeline(threadId: number): Promise<any[]>;
  getNodeHistory(threadId: number, nodeId: number): Promise<{ history: any[] }>;
  exportThread(threadId: number, format: string): Promise<any>;

  // Admin
  setupIndexes(): Promise<any>;
  migrateEmbeddings(): Promise<any>;
  verifySource(data: { url: string; claim: string }): Promise<any>;
};
