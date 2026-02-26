import { useState, useRef, useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { api } from '../services/api';
import './ChatPanel.css';

const YT_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/;

const mdComponents = {
  a: ({ href, children }) => {
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

const NODE_COLORS = {
  EVIDENCE: '#4ade80',
  EXAMPLE: '#60a5fa',
  CONTEXT: '#fbbf24',
  COUNTERPOINT: '#f87171',
  SYNTHESIS: '#a78bfa',
  REFERENCE: '#34d399',
};

function relativeDate(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ChatPanel({ selectedThreadId, initialThreadId, onNodesCreated, onThreadCreated, articleContext, onProposedUpdate, defaultSidebarCollapsed = false, currentUser, onAuthRequired }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(defaultSidebarCollapsed);

  // Use refs for values needed inside streaming callbacks (avoid stale closures)
  // initialThreadId pins the chat to a specific thread (e.g. when embedded in ArticleReader)
  const activeThreadIdRef = useRef(initialThreadId || null);
  const savedChatIdRef = useRef(null);
  const accReplyRef = useRef('');

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Load chat history whenever the active thread changes
  const loadChatHistory = useCallback(async (threadId) => {
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

  const handleLoadChat = async (chatId) => {
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
      await api.chatStream({
        message: userMsg,
        history: historySnapshot,
        threadId: activeThreadIdRef.current,
        nodeContext: articleContext || null,
        onProcessing: () => {
          flushSync(() => {
            setMessages(prev => {
              const updated = [...prev];
              const msg = updated[assistantIndex];
              if (msg?.role === 'assistant') {
                updated[assistantIndex] = { ...msg, streaming: false, processing: true };
              }
              return updated;
            });
          });
        },
        onToken: (token) => {
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
        onDone: async (data) => {
          // Finalize the assistant message in UI
          setMessages(prev => {
            const updated = [...prev];
            const msg = updated[assistantIndex];
            if (msg?.role === 'assistant') {
              updated[assistantIndex] = {
                ...msg,
                streaming: false,
                processing: false,
                citations: data.citations || [],
                createdNodes: data.createdNodes || [],
                newThread: data.newThread || null,
                proposedUpdate: data.proposedUpdate || null,
              };
            }
            return updated;
          });

          const resolvedThreadId = data.threadId || activeThreadIdRef.current;

          // Notify parent of thread/node changes
          if (data.newThread) {
            activeThreadIdRef.current = data.threadId;
            onThreadCreated?.(data.threadId);
          } else if (data.createdNodes?.length > 0) {
            activeThreadIdRef.current = data.threadId;
            onNodesCreated?.(data.threadId);
          }

          // Persist the conversation to the database
          if (resolvedThreadId) {
            const finalMessages = [
              ...historySnapshot,
              { role: 'user', content: userMsg },
              {
                role: 'assistant',
                content: accReplyRef.current,
                citations: data.citations || [],
                createdNodes: data.createdNodes || [],
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
              // Refresh sidebar
              await loadChatHistory(resolvedThreadId);
            } catch (err) {
              console.error('Failed to save chat:', err);
            }
          }

          setLoading(false);
        },
        onError: (err) => {
          setMessages(prev => {
            const updated = [...prev];
            updated[assistantIndex] = { role: 'error', content: `Error: ${err.message}` };
            return updated;
          });
          setLoading(false);
        },
      });
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIndex] = { role: 'error', content: `Error: ${err.message}` };
        return updated;
      });
      setLoading(false);
    }
  }, [input, loading, messages, loadChatHistory, onNodesCreated, onThreadCreated, articleContext, onProposedUpdate]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e) => {
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
                        <ReactMarkdown components={mdComponents}>{msg.content}</ReactMarkdown>
                      </div>

                      {msg.processing && (
                        <div className="cp-processing">
                          <span className="cp-dot" />
                          <span className="cp-dot" />
                          <span className="cp-dot" />
                          <span className="cp-processing-label">Extracting knowledge…</span>
                        </div>
                      )}

                      {msg.citations?.length > 0 && (
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

                      {(msg.createdNodes?.length > 0 || msg.newThread) && (
                        <div className="cp-nodes-created">
                          {msg.newThread && (
                            <span className="cp-new-thread">↗ New thread: {msg.newThread.title}</span>
                          )}
                          {msg.createdNodes?.map((n, ni) => (
                            <span key={ni} className="cp-node-chip"
                              style={{ borderColor: NODE_COLORS[n.type] || '#555', color: NODE_COLORS[n.type] || '#aaa' }}
                              title={n.title}>
                              {n.type}
                            </span>
                          ))}
                        </div>
                      )}

                      {msg.proposedUpdate && onProposedUpdate && (
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
                              onClick={() => onProposedUpdate(msg.proposedUpdate)}
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
