import { useState, useRef, useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { api } from '../services/api';
import { NODE_TYPE_COLORS } from '../constants';
import type { User, NodeTypeName } from '../types';
import './ChatPanel.css';

const YT_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/;

const mdComponents = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    const yt = href?.match(YT_REGEX);
    if (yt) {
      return (
        <div className="cp-youtube">
          <iframe
            src={`https://www.youtube.com/embed/${yt[1]}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={`yt-${yt[1]}`}
          />
        </div>
      );
    }
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  },
};

function relativeDate(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface ChatMessage {
  role: string;
  content: string;
  citations?: any[];
  extractedNodes?: any[];
  createdNodes?: any[];
  newThread?: any;
  proposedUpdate?: any;
  proposedNodes?: any[] | null;
  proposedThreadId?: number;
  streaming?: boolean;
  processing?: boolean;
  nodesAccepted?: boolean;
  duplicateSkipped?: string[] | null;
  updateApplied?: boolean;
}

interface ChatHistoryItem {
  id: number;
  title: string;
  messageCount: number;
  created_at: string;
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
  articleContext?: any;
  onProposedUpdate?: (update: ProposedUpdate) => Promise<void>;
  defaultSidebarCollapsed?: boolean;
  currentUser: User | null | undefined;
  onAuthRequired?: () => void;
}

export default function ChatPanel({ selectedThreadId, initialThreadId, onNodesCreated, onThreadCreated, articleContext, onProposedUpdate, defaultSidebarCollapsed = false, currentUser, onAuthRequired }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(defaultSidebarCollapsed);
  const [excludedNodes, setExcludedNodes] = useState<Record<number, Set<number>>>({}); // { [msgIndex]: Set<nodeIndex> }

  // Use refs for values needed inside streaming callbacks (avoid stale closures)
  // initialThreadId pins the chat to a specific thread (e.g. when embedded in ArticleReader)
  const activeThreadIdRef = useRef<number | null>(initialThreadId || null);
  const savedChatIdRef = useRef<number | null>(null);
  const accReplyRef = useRef('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Load chat history whenever the active thread changes
  const loadChatHistory = useCallback(async (threadId: number | null) => {
    if (!threadId) { setChatHistory([]); return; }
    try {
      const chats = await api.getThreadChats(threadId);
      setChatHistory(chats);
    } catch (err) {
      console.error('Failed to load chat history:', err);
    }
  }, []);

  // When the selected thread changes from the sidebar, refresh the chat list
  // (but don't set activeThreadIdRef — new messages start fresh)
  useEffect(() => {
    loadChatHistory(selectedThreadId);
  }, [selectedThreadId, loadChatHistory]);

  const handleNewChat = () => {
    setMessages([]);
    setInput('');
    // Pin to initialThreadId (article context) or selectedThreadId (chat tab).
    // Backend's topicShift detection creates a new thread only if the topic truly changes.
    activeThreadIdRef.current = initialThreadId || selectedThreadId || null;
    savedChatIdRef.current = null;
    setActiveChatId(null);
  };

  const handleLoadChat = async (chatId: number) => {
    try {
      const chat = await api.getChat(chatId);
      setMessages(chat.messages || []);
      savedChatIdRef.current = chatId;
      setActiveChatId(chatId);
      if (chat.threadId && chat.threadId !== activeThreadIdRef.current) {
        activeThreadIdRef.current = chat.threadId;
        await loadChatHistory(chat.threadId);
      }
    } catch (err) {
      console.error('Failed to load chat:', err);
    }
  };

  const handleSend = useCallback(async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // Capture history snapshot — only role + content go to the LLM
    const historySnapshot = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(({ role, content }) => ({ role, content }));

    const assistantIndex = messages.length + 1;
    setMessages(prev => [
      ...prev,
      { role: 'user', content: userMsg },
      { role: 'assistant', content: '', citations: [], createdNodes: [], newThread: null, proposedUpdate: null, streaming: true, processing: false },
    ]);
    setLoading(true);
    accReplyRef.current = '';

    try {
      // Phase 1: stream the LLM reply
      await api.chatStream({
        message: userMsg,
        history: historySnapshot,
        threadId: activeThreadIdRef.current,
        nodeContext: articleContext || null,
        onToken: (token: string) => {
          accReplyRef.current += token;
          setMessages(prev => {
            const updated = [...prev];
            const msg = updated[assistantIndex];
            if (msg?.role === 'assistant') {
              updated[assistantIndex] = { ...msg, content: msg.content + token };
            }
            return updated;
          });
        },
        onDone: async (data: any) => {
          // Streaming finished — show "extracting" spinner while we call /api/chat/extract
          flushSync(() => {
            setMessages(prev => {
              const updated = [...prev];
              const msg = updated[assistantIndex];
              if (msg?.role === 'assistant') {
                updated[assistantIndex] = { ...msg, streaming: false, processing: true, citations: data.citations || [] };
              }
              return updated;
            });
          });

          const streamedReply = data.reply || accReplyRef.current;
          const streamedCitations = data.citations || [];

          // Phase 2: extraction — returns proposed nodes (not yet saved)
          let extractData: any = { citations: streamedCitations, proposedNodes: [], threadId: activeThreadIdRef.current, newThread: null, proposedUpdate: null };
          try {
            extractData = await api.chatExtract({
              message: userMsg,
              reply: streamedReply,
              threadId: activeThreadIdRef.current,
              nodeContext: articleContext || null,
              citations: streamedCitations,
            });
          } catch (extractErr) {
            console.error('Extraction failed:', extractErr);
          }

          // Finalize the assistant message with proposed nodes (not yet saved)
          setMessages(prev => {
            const updated = [...prev];
            const msg = updated[assistantIndex];
            if (msg?.role === 'assistant') {
              updated[assistantIndex] = {
                ...msg,
                streaming: false,
                processing: false,
                citations: extractData.citations || streamedCitations,
                proposedNodes: extractData.proposedNodes?.length > 0 ? extractData.proposedNodes : null,
                proposedThreadId: extractData.threadId,
                newThread: extractData.newThread || null,
                proposedUpdate: extractData.proposedUpdate || null,
              };
            }
            return updated;
          });

          const resolvedThreadId = extractData.threadId || activeThreadIdRef.current;

          // Auto-notify for new thread (thread is created immediately, nodes need accept)
          if (extractData.newThread) {
            activeThreadIdRef.current = extractData.threadId;
            onThreadCreated?.(extractData.threadId);
          }

          // Persist the conversation to the database
          if (resolvedThreadId) {
            const finalMessages = [
              ...historySnapshot,
              { role: 'user', content: userMsg },
              {
                role: 'assistant',
                content: accReplyRef.current,
                citations: extractData.citations || streamedCitations,
                createdNodes: [],
              },
            ];
            const chatTitle = userMsg.substring(0, 80);
            try {
              if (savedChatIdRef.current) {
                await api.updateChat(savedChatIdRef.current, { messages: finalMessages });
              } else {
                const saved = await api.createChat({ threadId: resolvedThreadId, title: chatTitle, messages: finalMessages });
                savedChatIdRef.current = saved.id;
                setActiveChatId(saved.id);
              }
              await loadChatHistory(resolvedThreadId);
            } catch (err) {
              console.error('Failed to save chat:', err);
            }
          }

          setLoading(false);
        },
        onError: (err: any) => {
          setMessages(prev => {
            const updated = [...prev];
            updated[assistantIndex] = { role: 'error', content: `Error: ${err.message}` };
            return updated;
          });
          setLoading(false);
        },
      });
    } catch (err: any) {
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIndex] = { role: 'error', content: `Error: ${err.message}` };
        return updated;
      });
      setLoading(false);
    }
  }, [input, loading, messages, loadChatHistory, onNodesCreated, onThreadCreated, articleContext, onProposedUpdate]);

  const toggleExcludedNode = useCallback((msgIndex: number, nodeIndex: number) => {
    setExcludedNodes(prev => {
      const set = new Set(prev[msgIndex] || []);
      if (set.has(nodeIndex)) set.delete(nodeIndex);
      else set.add(nodeIndex);
      return { ...prev, [msgIndex]: set };
    });
  }, []);

  const handleAcceptNodes = useCallback(async (msgIndex: number, proposedNodes: any[], threadId: number) => {
    try {
      const excluded = excludedNodes[msgIndex] || new Set();
      const filteredNodes = proposedNodes.filter((_: any, idx: number) => !excluded.has(idx));
      if (filteredNodes.length === 0) return;

      const rootNode = filteredNodes.find((n: any) => n.type === 'ROOT');
      const secondaryNodes = filteredNodes.filter((n: any) => n.type !== 'ROOT');
      let rootNodeId: number | null = null;
      let allDuplicateSkipped: string[] = [];

      if (rootNode) {
        const created = await api.createNode({ threadId, title: rootNode.title, content: rootNode.content, nodeType: 'ROOT', parentId: null });
        rootNodeId = created.id;
      }
      if (secondaryNodes.length > 0) {
        const batchResult = await api.createNodesBatch(threadId, secondaryNodes.map((n: any) => ({
          title: n.title, content: n.content, nodeType: n.type, parentId: rootNodeId,
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
    }
  }, [onNodesCreated, excludedNodes]);

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
              <button className="cp-new-btn" onClick={handleNewChat} title="New chat">+ New</button>
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
              onClick={() => handleLoadChat(chat.id)}
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

        <div className="cp-messages">
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
                        <ReactMarkdown components={mdComponents as any}>{msg.content}</ReactMarkdown>
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
                          {msg.citations.map((c: any, ci: number) => (
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
                          {msg.proposedNodes?.map((n: any, ni: number) => (
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
                                  await onProposedUpdate(msg.proposedUpdate);
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
                            {msg.proposedNodes.map((n: any, ni: number) => (
                              <span key={ni}
                                className={`cp-node-chip${excluded.has(ni) ? ' cp-node-chip--excluded' : ''}`}
                                style={excluded.has(ni) ? {} : { borderColor: NODE_TYPE_COLORS[n.type as NodeTypeName] || '#555', color: NODE_TYPE_COLORS[n.type as NodeTypeName] || '#aaa' }}
                                onClick={() => toggleExcludedNode(i, ni)}>
                                {n.type}: {n.title}
                              </span>
                            ))}
                          </div>
                          <div className="cp-proposed-update-actions">
                            <button
                              className="cp-accept-btn"
                              onClick={() => handleAcceptNodes(i, msg.proposedNodes!, msg.proposedThreadId!)}
                              disabled={acceptCount === 0}
                            >
                              Accept{acceptCount < msg.proposedNodes.length ? ` (${acceptCount})` : ''}
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
