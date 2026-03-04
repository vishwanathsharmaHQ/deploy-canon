import { useEffect, useCallback, useRef, useMemo } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import ThreadGraph from './components/ThreadGraph'
import NodeDetailsModal from './components/NodeDetailsModal'
import ArticleReader from './components/ArticleReader'
import ThreadCanvas from './components/ThreadCanvas'
import SequenceEditor from './components/SequenceEditor'
import ViewTabBar from './components/ViewTabBar'
import NodeEditor from './components/NodeEditor'
import ChatPanel from './components/ChatPanel'
import AuthModal from './components/AuthModal'
import GlobalGraphView from './components/GlobalGraphView'
import SemanticSearchPanel from './components/SemanticSearchPanel'
import ReviewMode from './components/ReviewMode'
import IngestPanel from './components/IngestPanel'
import ReadLaterQueue from './components/ReadLaterQueue'
import ThreadTimeline from './components/ThreadTimeline'
import { api } from './services/api'
import { NODE_TYPES, THREAD_TYPES } from './constants'
import type { ThreadNode, ViewName } from './types'
import { useAuthStore } from './stores/useAuthStore'
import { useUIStore } from './stores/useUIStore'
import { useThreadStore } from './stores/useThreadStore'
import { useNodeStore } from './stores/useNodeStore'
import './App.css'

function App() {
  // ── Zustand stores ──────────────────────────────────────────────────────────
  const { currentUser, showAuthModal, setShowAuthModal, checkAuth, logout } = useAuthStore()
  const {
    view, setView, isFullScreen, loading, error, setLoading, setError,
    showCreateThreadModal, setShowCreateThreadModal,
    showSearchResults, setShowSearchResults,
    showSemanticSearch, setShowSemanticSearch,
    showThreadDropdown, setShowThreadDropdown,
    searchQuery, setSearchQuery, isSearchLoading, setIsSearchLoading,
  } = useUIStore()
  const {
    threads, selectedThreadId, setSelectedThreadId,
    title, setTitle, description, setDescription,
    threadType, setThreadType,
    setThreads, loadThreads, createThread,
  } = useThreadStore()
  const {
    selectedNode, setSelectedNode, graphSelectedNodeId, setGraphSelectedNodeId,
    editorNode, setEditorNode, handleCloseModal,
  } = useNodeStore()

  const dropdownRef = useRef<HTMLDivElement>(null)

  // ── Auth check on mount ─────────────────────────────────────────────────────
  useEffect(() => { checkAuth() }, [])

  // ── Load threads on mount ───────────────────────────────────────────────────
  useEffect(() => { loadThreads() }, [])

  // ── Require login helper ────────────────────────────────────────────────────
  function requireLogin(action: () => void) {
    if (!currentUser) { setShowAuthModal(true); return }
    action()
  }

  // ── Node handlers ───────────────────────────────────────────────────────────
  const handleNodeClick = (node: ThreadNode) => setSelectedNode(node)

  const handleUpdateNode = async ({ nodeId, threadId }: { nodeId: number; threadId: number }, { title, content }: { title: string; content: string }) => {
    try {
      await api.updateNode(threadId, nodeId, { title, content })
      await loadThreads()
    } catch (err: unknown) {
      setError('Failed to update node: ' + (err as Error).message)
    }
  }

  const handleAddNode = async (threadData: { newNode: { title?: string; content?: string; type?: number | string; threadId: number; parentId?: number | null } }) => {
    const { newNode } = threadData
    if (!newNode?.title || !newNode?.content) return
    try {
      setLoading(true)
      setError(null)
      const nodeType = typeof newNode.type === 'number' ? NODE_TYPES[newNode.type] : newNode.type || NODE_TYPES[0]
      await api.createNode({
        threadId: newNode.threadId,
        title: newNode.title,
        content: newNode.content,
        nodeType,
        parentId: newNode.parentId,
        metadata: { title: newNode.title, description: newNode.content.substring(0, 100), createdAt: new Date().toISOString() },
      })
      await loadThreads()
      setSelectedNode(null)
    } catch (err: unknown) {
      setError('Failed to create node: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // ── Thread navigation ───────────────────────────────────────────────────────
  const threadToShow = threads.find(t => t.id === selectedThreadId)
  const graphData = threadToShow ? [threadToShow] : []

  const currentThreadIndex = threads.findIndex(t => t.id === selectedThreadId)
  const hasPrevThread = currentThreadIndex > 0
  const hasNextThread = currentThreadIndex >= 0 && currentThreadIndex < threads.length - 1
  const handlePrevThread = () => { if (hasPrevThread) setSelectedThreadId(threads[currentThreadIndex - 1].id) }
  const handleNextThread = () => { if (hasNextThread) setSelectedThreadId(threads[currentThreadIndex + 1].id) }

  // ── Graph chat context ──────────────────────────────────────────────────────
  const graphChatContext = useMemo(() => {
    if (!threadToShow) return null
    // Node-specific context when a non-thread node is selected
    if (graphSelectedNodeId) {
      const node = (threadToShow.nodes || []).find(n => n.id === graphSelectedNodeId)
      if (node) return { nodeId: node.id, nodeType: node.node_type, title: node.title || node.metadata?.title, content: typeof node.content === 'string' ? node.content.substring(0, 600) : '' }
    }
    // Thread-level context when thread is selected but no specific node
    const nodes = threadToShow.nodes || []
    const nodeSummary = nodes.slice(0, 15).map(n => `[${n.node_type}] ${n.title || n.metadata?.title || 'Untitled'}`).join('; ')
    return {
      threadTitle: threadToShow.metadata?.title || threadToShow.title || `Thread ${threadToShow.id}`,
      threadDescription: threadToShow.description || '',
      threadType: (threadToShow.metadata?.thread_type as string) || 'standard',
      nodesSummary: nodeSummary || 'No nodes yet',
    }
  }, [graphSelectedNodeId, threadToShow])

  // ── Search ──────────────────────────────────────────────────────────────────
  const filteredThreads = useMemo(() => {
    if (!searchQuery) return []
    return threads.filter(thread =>
      thread.metadata?.title?.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [threads, searchQuery])

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
    setShowSearchResults(!!e.target.value)
  }

  const handleSearchSubmit = async (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || !searchQuery.trim()) return
    e.preventDefault()
    const wordCount = searchQuery.trim().split(/\s+/).length
    try {
      setIsSearchLoading(true)
      if (wordCount > 3) {
        try {
          const semanticResults = await api.semanticSearch(searchQuery, 10)
          if (semanticResults.threads?.length > 0 || semanticResults.nodes?.length > 0) {
            const threadResults = semanticResults.threads || []
            if (threadResults.length > 0) {
              const existingIds = new Set(threads.map(t => t.id))
              setThreads([...threads, ...threadResults.filter(t => !existingIds.has(t.id))])
            }
            setShowSearchResults(true)
            setIsSearchLoading(false)
            return
          }
        } catch { /* fall through to substring search */ }
      }
      const results = await api.searchThreads(searchQuery)
      if (results.length === 0) {
        if (!currentUser) { setShowAuthModal(true); return }
        const newThread = await api.generateThread(searchQuery)
        setSelectedThreadId(newThread.id)
        await loadThreads()
        setSearchQuery('')
        setShowSearchResults(false)
      } else {
        const existingIds = new Set(threads.map(t => t.id))
        setThreads([...threads, ...results.filter(t => !existingIds.has(t.id))])
        setShowSearchResults(true)
      }
    } catch {
      setError('Failed to search or generate thread')
    } finally {
      setIsSearchLoading(false)
    }
  }

  // ── Fullscreen ──────────────────────────────────────────────────────────────
  const toggleFullScreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen()
    }
  }, [])

  // ── Click outside dropdown ──────────────────────────────────────────────────
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowThreadDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // ── Reload helpers for child components ─────────────────────────────────────
  const onNodesCreated = async (tid: number) => { await loadThreads(); setSelectedThreadId(tid) }
  const onThreadCreated = async (tid: number) => { await loadThreads(); setSelectedThreadId(tid) }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {error && <div className="error">{error}</div>}

      <div className="header">
        <div className="header-center"><h1>canonthread</h1></div>
        <div className="header-right">
          {currentUser ? (
            <div className="user-menu">
              <span className="user-email">{currentUser.email}</span>
              <button className="btn-outline" onClick={() => { logout() }}>Sign out</button>
            </div>
          ) : (
            <button className="btn-primary" onClick={() => setShowAuthModal(true)}>Sign in</button>
          )}
          <button
            className="fullscreen-toggle"
            onClick={toggleFullScreen}
            title={isFullScreen ? 'Exit full screen' : 'Enter full screen'}
            aria-label={isFullScreen ? 'Exit full screen' : 'Enter full screen'}
          />
        </div>
      </div>

      <div className="main-content">
        {(threadToShow || view === 'chat' || view === 'global' || view === 'ingest') && (
          <ViewTabBar
            view={view}
            onChangeView={(newView: ViewName) => {
              if (['sequence', 'editor', 'canvas', 'review', 'ingest', 'timeline'].includes(newView)) {
                requireLogin(() => setView(newView))
              } else { setView(newView) }
            }}
            threadTitle={threadToShow?.metadata?.title || threadToShow?.title || (threadToShow ? `Thread ${threadToShow.id}` : '')}
            onPrevThread={handlePrevThread}
            onNextThread={handleNextThread}
            hasPrev={hasPrevThread}
            hasNext={hasNextThread}
          />
        )}

        {view === 'editor' && editorNode && threadToShow ? (
          <NodeEditor
            thread={threadToShow}
            selectedNode={editorNode}
            onSubmit={async (data: { id: number | string; type: string | number; newNode: { title: string; content: string; type: number; threadId: number; parentId: number | null } }) => { await handleAddNode(data); setView('graph'); setEditorNode(null) }}
            onCancel={() => { setView('graph'); setEditorNode(null) }}
          />
        ) : view === 'sequence' && threadToShow ? (
          <SequenceEditor thread={threadToShow} onDone={() => setView('article')} />
        ) : view === 'canvas' && threadToShow ? (
          <ThreadCanvas thread={threadToShow} />
        ) : view === 'global' ? (
          <ReactFlowProvider>
            <GlobalGraphView onSelectThread={(tid: number) => { setSelectedThreadId(tid); setView('graph') }} />
          </ReactFlowProvider>
        ) : view === 'review' && threadToShow ? (
          <ReviewMode threadId={threadToShow.id} onClose={() => setView('graph')} />
        ) : view === 'ingest' ? (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <IngestPanel
              threadId={threadToShow?.id ?? null}
              currentUser={currentUser}
              onAuthRequired={() => setShowAuthModal(true)}
              onNodesCreated={async (tid: number) => { await loadThreads(); setSelectedThreadId(tid); setView('graph') }}
              onThreadCreated={async (tid: number) => { await loadThreads(); setSelectedThreadId(tid); setView('graph') }}
            />
            <div style={{ padding: '0 20px 20px' }}>
              <ReadLaterQueue
                currentUser={currentUser}
                onAuthRequired={() => setShowAuthModal(true)}
                onIngestUrl={() => {}}
              />
            </div>
          </div>
        ) : view === 'timeline' && threadToShow ? (
          <ThreadTimeline threadId={threadToShow.id} threadTitle={threadToShow?.metadata?.title || threadToShow?.title} />
        ) : view === 'article' && threadToShow ? (
          <ArticleReader
            thread={threadToShow}
            initialNodeId={graphSelectedNodeId}
            currentUser={currentUser}
            onAuthRequired={() => setShowAuthModal(true)}
            onContentChange={(html: string) => {
              setThreads(threads.map(t =>
                t.id === threadToShow.id ? { ...t, content: html } : t
              ))
            }}
            onUpdateNode={handleUpdateNode}
            onNodesCreated={onNodesCreated}
            onThreadCreated={onThreadCreated}
            onViewInGraph={(nodeId: number) => { setGraphSelectedNodeId(nodeId); setView('graph') }}
          />
        ) : null}

        {/* Chat — always mounted to preserve conversation across tab switches */}
        <div style={{ display: view === 'chat' ? undefined : 'none', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <ChatPanel
            selectedThreadId={selectedThreadId}
            initialThreadId={selectedThreadId}
            articleContext={graphChatContext}
            currentUser={currentUser}
            onAuthRequired={() => setShowAuthModal(true)}
            onNodesCreated={onNodesCreated}
            onThreadCreated={onThreadCreated}
            onProposedUpdate={async () => {}}
          />
        </div>

        {/* Graph view — always mounted to avoid remount/layout-jump, hidden via CSS */}
        <div className="visualization-container" style={{ display: view === 'graph' ? undefined : 'none' }}>
          <div className="thread-controls">
            <div className="custom-select" ref={dropdownRef}>
              <button className="thread-selector" onClick={() => setShowThreadDropdown(!showThreadDropdown)}>
                {selectedThreadId
                  ? threads.find(t => t.id === selectedThreadId)?.metadata?.title || `Thread ${selectedThreadId}`
                  : 'Select a Thread'}
              </button>
              {showThreadDropdown && (
                <div className="dropdown-menu">
                  <div className="dropdown-item create-thread-option" onClick={() => requireLogin(() => { setShowCreateThreadModal(true); setShowThreadDropdown(false) })}>
                    + Create New Thread
                  </div>
                  {threads.map(thread => (
                    <div key={thread.id} className="dropdown-item" onClick={() => { setSelectedThreadId(thread.id); setShowThreadDropdown(false) }}>
                      {thread.metadata?.title || `Thread ${thread.id}`}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="search-container">
              <input
                type="text"
                className="search-input"
                placeholder="Search threads... (3+ words for semantic)"
                value={searchQuery}
                onChange={handleSearchInputChange}
                onKeyDown={handleSearchSubmit}
                onFocus={() => setShowSearchResults(true)}
              />
              <button
                className="semantic-search-toggle"
                onClick={() => setShowSemanticSearch(!showSemanticSearch)}
                title="Advanced semantic search"
                style={{
                  background: showSemanticSearch ? '#00ff9d22' : 'transparent',
                  border: `1px solid ${showSemanticSearch ? '#00ff9d' : '#444'}`,
                  color: showSemanticSearch ? '#00ff9d' : '#888',
                  borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '11px', marginLeft: '4px', whiteSpace: 'nowrap',
                }}
              >
                AI
              </button>
              {showSearchResults && searchQuery && (
                <div className="search-results">
                  {isSearchLoading ? (
                    <div className="loading-results">
                      <div className="loading-spinner" />
                      <p>Generating thread for "{searchQuery}"...</p>
                    </div>
                  ) : filteredThreads.length > 0 ? (
                    filteredThreads.map(thread => (
                      <div key={thread.id} className="search-result-item" onClick={() => { setSelectedThreadId(thread.id); setSearchQuery(''); setShowSearchResults(false) }}>
                        {thread.metadata?.title || `Thread ${thread.id}`}
                      </div>
                    ))
                  ) : (
                    <div className="no-results">Press Enter to generate a new thread about "{searchQuery}"</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {showSemanticSearch && (
            <div style={{ position: 'absolute', top: '50px', left: 0, right: 0, bottom: 0, zIndex: 20, background: '#1a1a2e' }}>
              <SemanticSearchPanel
                onSelectThread={(tid: number) => { setSelectedThreadId(tid); setShowSemanticSearch(false); setView('graph') }}
                onSelectNode={(nodeId: number, tid: number) => { setSelectedThreadId(tid); setGraphSelectedNodeId(nodeId); setShowSemanticSearch(false); setView('article') }}
                onClose={() => setShowSemanticSearch(false)}
              />
            </div>
          )}

          {selectedThreadId ? (
            <ReactFlowProvider>
              <ThreadGraph
                threads={graphData}
                onNodeClick={handleNodeClick}
                onAddNode={handleAddNode}
                onOpenEditor={(node: ThreadNode) => requireLogin(() => { setEditorNode(node); setView('editor') })}
                onSelectedNodeChange={setGraphSelectedNodeId}
                onOpenInArticle={(nodeId: number) => { setGraphSelectedNodeId(nodeId); setView('article') }}
                onNavigateToThread={(tid: number) => { setSelectedThreadId(tid); setView('graph') }}
                loading={loading}
              />
            </ReactFlowProvider>
          ) : (
            <div className="no-thread-message">Please select a thread from the dropdown</div>
          )}
        </div>

        {showCreateThreadModal && (
          <div className="modal-overlay" onClick={() => setShowCreateThreadModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Create New Thread</h3>
                <button className="close-button" onClick={() => setShowCreateThreadModal(false)}>×</button>
              </div>
              <div className="modal-body">
                <div className="create-thread-form">
                  <input type="text" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="thread-input" />
                  <input type="text" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} className="thread-input" />
                  <select
                    value={threadType}
                    onChange={(e) => setThreadType(e.target.value)}
                    className="thread-input"
                    style={{ padding: '8px 12px', background: '#2a2a3e', color: '#e0e0e0', border: '1px solid #444', borderRadius: '6px' }}
                  >
                    {THREAD_TYPES.map(t => (
                      <option key={t.key} value={t.key}>{t.label} — {t.description}</option>
                    ))}
                  </select>
                  <div className="form-buttons">
                    <button className="cancel-button" onClick={() => setShowCreateThreadModal(false)} disabled={loading}>Cancel</button>
                    <button
                      className="submit-button"
                      onClick={async () => {
                        setLoading(true)
                        try { await createThread() } catch (err: unknown) { setError('Failed to create thread: ' + (err as Error).message) } finally { setLoading(false) }
                      }}
                      disabled={loading}
                    >
                      {loading ? 'Creating...' : 'Create Thread'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedNode && (
          <NodeDetailsModal
            node={selectedNode}
            onClose={handleCloseModal}
            loading={loading}
          />
        )}

        {showAuthModal && (
          <AuthModal
            onSuccess={() => { useAuthStore.getState().checkAuth(); setShowAuthModal(false) }}
            onClose={() => setShowAuthModal(false)}
          />
        )}
      </div>
    </div>
  )
}

export default App
