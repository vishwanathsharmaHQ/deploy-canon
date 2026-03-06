import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '../services/api';
import { NODE_TYPE_COLORS, ENTITY_TYPE_LABELS, THREAD_TYPES } from '../constants';
import { relativeDate } from '../utils/dates';
import { createMdComponents } from '../utils/markdown';
import { useChatStream } from '../hooks/useChatStream';
import type { ChatMessage } from '../hooks/useChatStream';
import type { User, NodeTypeName, ProposedNode } from '../types';
import './ChatPanel.css';

const mdComponents = createMdComponents('cp-youtube');

/** Infer a Neo4j relationship type from the entity type */
function inferRelationType(entityType: string): string {
  switch (entityType) {
    case 'evidence': return 'SUPPORTS';
    case 'source': return 'CITES';
    case 'example': return 'ILLUSTRATES';
    case 'counterpoint': return 'CONTRADICTS';
    case 'context': return 'QUALIFIES';
    case 'synthesis': return 'DERIVES_FROM';
    case 'question': return 'ADDRESSES';
    default: return 'SUPPORTS';
  }
}

interface ProposedUpdate {
  nodeId: number;
  title: string;
  description: string;
}

interface ChatPanelProps {
  selectedThreadId: number | null;
  initialThreadId?: number | null;
  onNodesCreated?: (threadId: number) => void;
  onThreadCreated?: (threadId: number) => void;
  articleContext?: Record<string, unknown> | null;
  onProposedUpdate?: (update: ProposedUpdate) => Promise<void>;
  defaultSidebarCollapsed?: boolean;
  currentUser: User | null | undefined;
  onAuthRequired?: () => void;
}

export default function ChatPanel({ selectedThreadId, initialThreadId, onNodesCreated, onThreadCreated, articleContext, onProposedUpdate, defaultSidebarCollapsed = false, currentUser, onAuthRequired }: ChatPanelProps) {
  const {
    messages,
    setMessages,
    loading,
    activeChatId,
    chatHistory,
    loadChatHistory,
    handleSend: sendMessage,
    handleLoadChat,
    handleNewChat,
  } = useChatStream({
    initialThreadId,
    selectedThreadId,
    articleContext,
    onThreadCreated,
  });

  const [input, setInput] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => defaultSidebarCollapsed || window.innerWidth <= 768);
  const [excludedNodes, setExcludedNodes] = useState<Record<number, Set<number>>>({}); // { [msgIndex]: Set<nodeIndex> }
  const [acceptingIndex, setAcceptingIndex] = useState<number | null>(null);
  const [threadTypeOverrides, setThreadTypeOverrides] = useState<Record<number, string>>({}); // { [msgIndex]: threadType }

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Track whether user is near bottom of chat
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 100;
    };
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Only auto-scroll if user is near bottom
  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  // When the selected thread changes from the sidebar, refresh the chat list
  useEffect(() => {
    loadChatHistory(selectedThreadId);
  }, [selectedThreadId, loadChatHistory]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    isNearBottomRef.current = true;
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    await sendMessage(userMsg);
  }, [input, loading, sendMessage]);

  const toggleExcludedNode = useCallback((msgIndex: number, nodeIndex: number) => {
    setExcludedNodes(prev => {
      const set = new Set(prev[msgIndex] || []);
      if (set.has(nodeIndex)) set.delete(nodeIndex);
      else set.add(nodeIndex);
      return { ...prev, [msgIndex]: set };
    });
  }, []);

  const handleAcceptNodes = useCallback(async (msgIndex: number, proposedNodes: ProposedNode[], threadId: number) => {
    setAcceptingIndex(msgIndex);
    try {
      // Apply thread type override if user selected one
      const chosenType = threadTypeOverrides[msgIndex];
      if (chosenType) {
        await api.updateThread(threadId, { thread_type: chosenType });
      }

      const excluded = excludedNodes[msgIndex] || new Set();
      const filteredNodes = proposedNodes.filter((_, idx) => !excluded.has(idx));
      if (filteredNodes.length === 0) return;

      const rootNodes = filteredNodes.filter(n => n.type === 'claim');
      const secondaryNodes = filteredNodes.filter(n => n.type !== 'claim');
      let firstRootNodeId: number | null = null;
      let allDuplicateSkipped: string[] = [];

      // Create all ROOT nodes (each as a top-level node with no parent)
      for (const rootNode of rootNodes) {
        const metadata = rootNode.chronological_order != null
          ? { chronological_order: rootNode.chronological_order }
          : undefined;
        const created = await api.createNode({ threadId, title: rootNode.title, content: rootNode.content, nodeType: 'claim', parentId: null, metadata });
        if (!firstRootNodeId) firstRootNodeId = created.id;
      }

      // Create non-ROOT nodes as children of:
      // 1. First newly created ROOT (if any)
      // 2. The contextual node the user was asking about (if articleContext has nodeId)
      // 3. null (fallback, shouldn't normally happen)
      const contextualParentId = articleContext && 'nodeId' in articleContext ? (articleContext.nodeId as number) : null;
      const parentForSecondary = firstRootNodeId || contextualParentId;

      if (secondaryNodes.length > 0 && parentForSecondary) {
        const batchResult = await api.createNodesBatch(threadId, secondaryNodes.map(n => {
          // Infer relationship type from node type if not provided
          const relationType = n.relationType || inferRelationType(n.type);
          return {
            title: n.title, content: n.content, nodeType: n.type, parentId: parentForSecondary,
            connectTo: { targetId: parentForSecondary, relationType },
          };
        }));
        if ((batchResult.duplicateSkipped?.length ?? 0) > 0) {
          allDuplicateSkipped = batchResult.duplicateSkipped ?? [];
        }
      } else if (secondaryNodes.length > 0) {
        const batchResult = await api.createNodesBatch(threadId, secondaryNodes.map(n => ({
          title: n.title, content: n.content, nodeType: n.type,
        })));
        if ((batchResult.duplicateSkipped?.length ?? 0) > 0) {
          allDuplicateSkipped = batchResult.duplicateSkipped ?? [];
        }
      }

      setMessages(prev => prev.map((m, i) =>
        i === msgIndex ? { ...m, proposedNodes: null, nodesAccepted: true, duplicateSkipped: allDuplicateSkipped.length > 0 ? allDuplicateSkipped : null } : m
      ));
      setExcludedNodes(prev => { const copy = { ...prev }; delete copy[msgIndex]; return copy; });
      onNodesCreated?.(threadId);
    } catch (err) {
      console.error('Accept nodes failed:', err);
    } finally {
      setAcceptingIndex(null);
    }
  }, [onNodesCreated, excludedNodes, setMessages, articleContext, threadTypeOverrides]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
  };

  return (
    <div className="cp-panel">

      {/* ── Sidebar ── */}
      <div className={`cp-sidebar${sidebarCollapsed ? ' cp-sidebar--collapsed' : ''}`}>
        <div className="cp-sidebar-header">
          <button
            className="cp-sidebar-toggle"
            onClick={() => setSidebarCollapsed(v => !v)}
            title={sidebarCollapsed ? 'Show chats' : 'Hide chats'}
          >
            {sidebarCollapsed ? '›' : '‹'}
          </button>
          {!sidebarCollapsed && (
            <>
              <span className="cp-sidebar-title">Chats</span>
              <button className="cp-new-btn" onClick={() => handleNewChat(() => setInput(''))} title="New chat">+ New</button>
            </>
          )}
        </div>

        <div className="cp-chat-list" style={{ display: sidebarCollapsed ? 'none' : undefined }}>
          {chatHistory.length === 0 && (
            <p className="cp-chat-empty">No saved chats yet.</p>
          )}
          {chatHistory.map(chat => (
            <button
              key={chat.id}
              className={`cp-chat-item${chat.id === activeChatId ? ' cp-chat-item--active' : ''}`}
              onClick={() => chat.id != null && handleLoadChat(chat.id)}
            >
              <span className="cp-chat-item-title">{chat.title}</span>
              <span className="cp-chat-item-meta">
                {chat.messageCount} {chat.messageCount === 1 ? 'exchange' : 'exchanges'} · {relativeDate(chat.created_at)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main chat area ── */}
      <div className="cp-main">
        <div className="cp-header">
          <span className="cp-title">Research Chat</span>
        </div>

        <div className="cp-messages" ref={messagesContainerRef}>
          {messages.length === 0 && (
            <div className="cp-empty">
              <p>
                Ask anything — nodes will be auto-created in your knowledge graph as you research.
                <br />
                Topic shifts automatically create new threads.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`cp-msg cp-msg--${msg.role}`}>
              {msg.role === 'user' && (
                <div className="cp-bubble cp-bubble--user">{msg.content}</div>
              )}

              {msg.role === 'assistant' && (
                <div className={`cp-bubble cp-bubble--assistant${msg.streaming && !msg.content ? ' cp-bubble--loading' : ''}`}>
                  {msg.streaming && !msg.content ? (
                    <>
                      <span className="cp-dot" />
                      <span className="cp-dot" />
                      <span className="cp-dot" />
                    </>
                  ) : (
                    <>
                      <div className="cp-markdown">
                        <ReactMarkdown components={mdComponents as Record<string, React.ComponentType>}>{msg.content}</ReactMarkdown>
                      </div>

                      {msg.processing && (
                        <div className="cp-processing">
                          <span className="cp-dot" />
                          <span className="cp-dot" />
                          <span className="cp-dot" />
                          <span className="cp-processing-label">Extracting knowledge…</span>
                        </div>
                      )}

                      {msg.citations && msg.citations.length > 0 && (
                        <div className="cp-citations">
                          <span className="cp-citations-label">Sources</span>
                          {msg.citations.map((c, ci) => (
                            <a key={ci} href={c.url} target="_blank" rel="noopener noreferrer"
                               className="cp-citation" title={c.url}>
                              [{ci + 1}] {(c.title || c.url).substring(0, 60)}
                            </a>
                          ))}
                        </div>
                      )}

                      {(msg.newThread || msg.nodesAccepted) && (
                        <div className="cp-nodes-created">
                          {msg.newThread && (
                            <span className="cp-new-thread">↗ New thread: {msg.newThread.title}</span>
                          )}
                          {msg.nodesAccepted && (
                            <span className="cp-nodes-saved">✓ Nodes saved</span>
                          )}
                          {msg.duplicateSkipped && msg.duplicateSkipped.length > 0 && (
                            <span className="cp-duplicates-skipped">
                              Skipped {msg.duplicateSkipped.length} duplicate{msg.duplicateSkipped.length !== 1 ? 's' : ''}: {msg.duplicateSkipped.join(', ')}
                            </span>
                          )}
                          {msg.proposedNodes?.map((n, ni) => (
                            <span key={ni} className="cp-node-chip"
                              style={{ borderColor: NODE_TYPE_COLORS[n.type as NodeTypeName] || '#555', color: NODE_TYPE_COLORS[n.type as NodeTypeName] || '#aaa' }}
                              title={n.title}>
                              {n.type}
                            </span>
                          ))}
                        </div>
                      )}

                      {msg.updateApplied && (
                        <div className="cp-update-applied">✓ Update applied</div>
                      )}

                      {msg.proposedUpdate && onProposedUpdate && !msg.updateApplied && (
                        <div className="cp-proposed-update">
                          <div className="cp-proposed-update-label">
                            ✦ Proposed update to <em>{msg.proposedUpdate.title}</em>
                          </div>
                          <div className="cp-proposed-update-preview">
                            {msg.proposedUpdate.description}
                          </div>
                          <div className="cp-proposed-update-actions">
                            <button
                              className="cp-accept-btn"
                              onClick={async () => {
                                try {
                                  await onProposedUpdate(msg.proposedUpdate!);
                                  setMessages(prev => prev.map((m, mi) =>
                                    mi === i ? { ...m, proposedUpdate: null, updateApplied: true } : m
                                  ));
                                } catch (e) {
                                  console.error('Failed to apply update:', e);
                                }
                              }}
                            >
                              Accept
                            </button>
                            <button
                              className="cp-dismiss-btn"
                              onClick={() => setMessages(prev => prev.map((m, mi) =>
                                mi === i ? { ...m, proposedUpdate: null } : m
                              ))}
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      )}

                      {msg.proposedNodes && !msg.nodesAccepted && (() => {
                        const excluded = excludedNodes[i] || new Set();
                        const acceptCount = msg.proposedNodes.length - excluded.size;
                        return (
                        <div className="cp-proposed-nodes">
                          <div className="cp-proposed-nodes-label">
                            ✦ {msg.proposedNodes.length} node{msg.proposedNodes.length !== 1 ? 's' : ''} ready to save
                          </div>
                          <div className="cp-proposed-nodes-list">
                            {msg.proposedNodes.map((n, ni) => (
                              <span key={ni}
                                className={`cp-node-chip${excluded.has(ni) ? ' cp-node-chip--excluded' : ''}`}
                                style={excluded.has(ni) ? {} : { borderColor: NODE_TYPE_COLORS[n.type as NodeTypeName] || '#555', color: NODE_TYPE_COLORS[n.type as NodeTypeName] || '#aaa' }}
                                onClick={() => toggleExcludedNode(i, ni)}
                                title={n.relationType ? `${n.relationType} → parent` : undefined}>
                                {ENTITY_TYPE_LABELS[n.type] || n.type}: {n.title}{n.relationType && n.type !== 'claim' ? ` [${n.relationType.toLowerCase().replace('_', ' ')}]` : ''}
                              </span>
                            ))}
                          </div>
                          {msg.newThread && (
                            <div className="cp-thread-type-select">
                              <label>Thread type:</label>
                              <select
                                value={threadTypeOverrides[i] || 'argument'}
                                onChange={(e) => setThreadTypeOverrides(prev => ({ ...prev, [i]: e.target.value }))}
                              >
                                {THREAD_TYPES.map(tt => (
                                  <option key={tt.key} value={tt.key}>{tt.label}</option>
                                ))}
                              </select>
                            </div>
                          )}
                          <div className="cp-proposed-update-actions">
                            <button
                              className="cp-accept-btn"
                              onClick={() => handleAcceptNodes(i, msg.proposedNodes!, msg.proposedThreadId!)}
                              disabled={acceptCount === 0 || acceptingIndex !== null}
                            >
                              {acceptingIndex === i ? 'Saving...' : `Accept${acceptCount < msg.proposedNodes.length ? ` (${acceptCount})` : ''}`}
                            </button>
                            <button
                              className="cp-dismiss-btn"
                              onClick={() => {
                                setMessages(prev => prev.map((m, mi) =>
                                  mi === i ? { ...m, proposedNodes: null } : m
                                ));
                                setExcludedNodes(prev => { const copy = { ...prev }; delete copy[i]; return copy; });
                              }}
                            >
                              Discard
                            </button>
                          </div>
                        </div>
                        );
                      })()}
                    </>
                  )}
                </div>
              )}

              {msg.role === 'error' && (
                <div className="cp-bubble cp-bubble--error">{msg.content}</div>
              )}
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>

        {currentUser === undefined || currentUser ? (
          <div className="cp-input-area">
            <textarea
              ref={textareaRef}
              className="cp-input"
              placeholder="Ask anything… (Shift+Enter for new line)"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={loading}
              rows={1}
              autoFocus
            />
            <button className="cp-send" onClick={handleSend}
              disabled={!input.trim() || loading} aria-label="Send">
              ▶
            </button>
          </div>
        ) : (
          <div className="cp-auth-gate">
            <p>Sign in to use AI chat</p>
            <button className="cp-auth-gate-btn" onClick={onAuthRequired}>Sign in</button>
          </div>
        )}
      </div>
    </div>
  );
}
