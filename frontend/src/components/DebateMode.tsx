import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import { api } from '../services/api';

interface Weakness {
  description: string;
  severity: 'high' | 'medium' | 'low';
}

interface DebateMessage {
  role: 'user' | 'assistant' | 'error';
  content: string;
  streaming?: boolean;
}

interface DebateModeProps {
  threadId: number;
  threadTitle: string;
  onClose: () => void;
}

const severityColors: Record<string, string> = {
  high: '#ef5350',
  medium: '#fdd835',
  low: '#66bb6a',
};

export default function DebateMode({ threadId, threadTitle, onClose }: DebateModeProps) {
  const [mode, setMode] = useState<'defend' | 'attack'>('defend');
  const [messages, setMessages] = useState<DebateMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [weaknesses, setWeaknesses] = useState<Weakness[]>([]);
  const [showSummary, setShowSummary] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const accReplyRef = useRef('');

  // Track scroll position
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

  // Auto-scroll
  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    isNearBottomRef.current = true;

    const historySnapshot = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(({ role, content }) => ({ role, content }));

    const assistantIndex = messages.length + 1;
    setMessages(prev => [
      ...prev,
      { role: 'user', content: userMsg },
      { role: 'assistant', content: '', streaming: true },
    ]);
    setLoading(true);
    accReplyRef.current = '';

    try {
      await api.debateStream({
        message: userMsg,
        threadId,
        mode,
        history: historySnapshot,
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
        onDone: (data) => {
          setMessages(prev => {
            const updated = [...prev];
            const msg = updated[assistantIndex];
            if (msg?.role === 'assistant') {
              updated[assistantIndex] = { ...msg, streaming: false };
            }
            return updated;
          });

          if (data.weaknesses_found && data.weaknesses_found.length > 0) {
            setWeaknesses(prev => [...prev, ...data.weaknesses_found]);
          }

          setLoading(false);
        },
        onError: (err: Error) => {
          setMessages(prev => {
            const updated = [...prev];
            updated[assistantIndex] = { role: 'error', content: `Error: ${err.message}` };
            return updated;
          });
          toast.error(err.message);
          setLoading(false);
        },
      });
    } catch (err: unknown) {
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIndex] = { role: 'error', content: `Error: ${(err as Error).message}` };
        return updated;
      });
      setLoading(false);
    }
  }, [input, loading, messages, threadId, mode]);

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

  const handleModeSwitch = (newMode: 'defend' | 'attack') => {
    if (newMode === mode) return;
    setMode(newMode);
    setMessages([]);
    setWeaknesses([]);
    setShowSummary(false);
  };

  const handleEndDebate = () => {
    setShowSummary(true);
  };

  const styles = {
    overlay: {
      position: 'fixed' as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column' as const,
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 20px',
      borderBottom: '1px solid #333',
      backgroundColor: '#1a1a1a',
      flexShrink: 0,
    },
    headerLeft: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
    },
    title: {
      color: '#00ff9d',
      fontSize: '16px',
      fontWeight: 600,
      margin: 0,
    },
    claim: {
      color: '#aaa',
      fontSize: '13px',
      maxWidth: '400px',
      overflow: 'hidden' as const,
      textOverflow: 'ellipsis' as const,
      whiteSpace: 'nowrap' as const,
    },
    modeToggle: {
      display: 'flex',
      gap: '4px',
      backgroundColor: '#222',
      borderRadius: '6px',
      padding: '3px',
    },
    modeBtn: (active: boolean) => ({
      padding: '6px 16px',
      borderRadius: '4px',
      border: 'none',
      cursor: 'pointer' as const,
      fontSize: '13px',
      fontWeight: 500,
      backgroundColor: active ? '#00ff9d' : 'transparent',
      color: active ? '#1a1a1a' : '#888',
      transition: 'all 0.2s',
    }),
    headerRight: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
    },
    endBtn: {
      padding: '6px 14px',
      borderRadius: '4px',
      border: '1px solid #555',
      backgroundColor: 'transparent',
      color: '#fff',
      cursor: 'pointer' as const,
      fontSize: '13px',
    },
    closeBtn: {
      padding: '6px 12px',
      borderRadius: '4px',
      border: 'none',
      backgroundColor: '#333',
      color: '#fff',
      cursor: 'pointer' as const,
      fontSize: '16px',
    },
    body: {
      display: 'flex',
      flex: 1,
      overflow: 'hidden' as const,
    },
    chatArea: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column' as const,
      backgroundColor: '#1a1a1a',
    },
    messagesContainer: {
      flex: 1,
      overflowY: 'auto' as const,
      padding: '16px 20px',
    },
    emptyState: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      color: '#666',
      fontSize: '14px',
      textAlign: 'center' as const,
    },
    msgRow: (role: string) => ({
      display: 'flex',
      justifyContent: role === 'user' ? 'flex-end' : 'flex-start',
      marginBottom: '12px',
    }),
    bubble: (role: string) => ({
      maxWidth: '70%',
      padding: '10px 14px',
      borderRadius: '12px',
      fontSize: '14px',
      lineHeight: '1.5',
      ...(role === 'user'
        ? { backgroundColor: '#00ff9d22', color: '#e0e0e0', borderBottomRightRadius: '4px' }
        : role === 'error'
        ? { backgroundColor: '#ef535022', color: '#ef5350' }
        : { backgroundColor: '#2a2a2a', color: '#e0e0e0', borderBottomLeftRadius: '4px' }),
    }),
    inputArea: {
      display: 'flex',
      gap: '8px',
      padding: '12px 20px',
      borderTop: '1px solid #333',
      backgroundColor: '#1a1a1a',
    },
    textarea: {
      flex: 1,
      padding: '10px 14px',
      borderRadius: '8px',
      border: '1px solid #333',
      backgroundColor: '#222',
      color: '#e0e0e0',
      fontSize: '14px',
      resize: 'none' as const,
      outline: 'none',
      fontFamily: 'inherit',
    },
    sendBtn: {
      padding: '10px 16px',
      borderRadius: '8px',
      border: 'none',
      backgroundColor: '#00ff9d',
      color: '#1a1a1a',
      fontWeight: 600,
      cursor: 'pointer' as const,
      fontSize: '14px',
      alignSelf: 'flex-end' as const,
    },
    weaknessesSidebar: {
      width: '280px',
      borderLeft: '1px solid #333',
      backgroundColor: '#1a1a1a',
      overflowY: 'auto' as const,
      padding: '16px',
      flexShrink: 0,
    },
    weaknessTitle: {
      color: '#fff',
      fontSize: '14px',
      fontWeight: 600,
      marginBottom: '12px',
    },
    weaknessItem: {
      padding: '8px 10px',
      borderRadius: '6px',
      backgroundColor: '#222',
      marginBottom: '8px',
      fontSize: '12px',
      lineHeight: '1.4',
      color: '#ccc',
    },
    weaknessSeverity: (severity: string) => ({
      display: 'inline-block',
      padding: '2px 6px',
      borderRadius: '3px',
      fontSize: '10px',
      fontWeight: 600,
      textTransform: 'uppercase' as const,
      backgroundColor: (severityColors[severity] || '#666') + '22',
      color: severityColors[severity] || '#666',
      marginBottom: '4px',
    }),
    summaryOverlay: {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10,
    },
    summaryCard: {
      backgroundColor: '#1a1a1a',
      border: '1px solid #333',
      borderRadius: '12px',
      padding: '24px 32px',
      maxWidth: '500px',
      width: '100%',
      maxHeight: '70vh',
      overflowY: 'auto' as const,
    },
    summaryTitle: {
      color: '#00ff9d',
      fontSize: '18px',
      fontWeight: 600,
      marginBottom: '16px',
    },
    summaryStats: {
      color: '#aaa',
      fontSize: '13px',
      marginBottom: '16px',
    },
    summaryCloseBtn: {
      padding: '8px 20px',
      borderRadius: '6px',
      border: 'none',
      backgroundColor: '#00ff9d',
      color: '#1a1a1a',
      fontWeight: 600,
      cursor: 'pointer' as const,
      fontSize: '14px',
      marginTop: '16px',
    },
    loadingDots: {
      display: 'inline-flex',
      gap: '4px',
      alignItems: 'center',
      padding: '4px 0',
    },
    dot: {
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      backgroundColor: '#00ff9d',
      animation: 'debate-dot-pulse 1.2s ease-in-out infinite',
    },
  };

  const modeDescription = mode === 'defend'
    ? 'AI defends the position. You play devil\'s advocate.'
    : 'AI attacks the position. You defend it.';

  return (
    <div style={styles.overlay}>
      <style>{`
        @keyframes debate-dot-pulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
        .debate-markdown h1, .debate-markdown h2, .debate-markdown h3 { color: #fff; margin: 8px 0 4px; }
        .debate-markdown p { margin: 4px 0; }
        .debate-markdown ul, .debate-markdown ol { padding-left: 20px; margin: 4px 0; }
        .debate-markdown code { background: #333; padding: 1px 4px; border-radius: 3px; font-size: 13px; }
        .debate-markdown blockquote { border-left: 3px solid #00ff9d; padding-left: 12px; color: #aaa; margin: 8px 0; }
        .debate-markdown strong { color: #fff; }
      `}</style>

      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h3 style={styles.title}>Debate a Clone</h3>
          <div style={styles.claim} title={threadTitle}>{threadTitle}</div>
          <div style={styles.modeToggle}>
            <button
              style={styles.modeBtn(mode === 'defend')}
              onClick={() => handleModeSwitch('defend')}
              disabled={loading}
            >
              Defend
            </button>
            <button
              style={styles.modeBtn(mode === 'attack')}
              onClick={() => handleModeSwitch('attack')}
              disabled={loading}
            >
              Attack
            </button>
          </div>
          <span style={{ color: '#666', fontSize: '12px' }}>{modeDescription}</span>
        </div>
        <div style={styles.headerRight}>
          {messages.length > 0 && (
            <button style={styles.endBtn} onClick={handleEndDebate}>
              End Debate
            </button>
          )}
          <button style={styles.closeBtn} onClick={onClose} title="Close debate">
            &times;
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ ...styles.body, position: 'relative' as const }}>
        {/* Chat area */}
        <div style={styles.chatArea}>
          <div style={styles.messagesContainer} ref={messagesContainerRef}>
            {messages.length === 0 && (
              <div style={styles.emptyState}>
                <div>
                  <p style={{ fontSize: '16px', color: '#888', marginBottom: '8px' }}>
                    {mode === 'defend'
                      ? 'Challenge the AI\'s defense of this position.'
                      : 'Defend this position against the AI\'s attacks.'}
                  </p>
                  <p style={{ color: '#555' }}>
                    Start by making your opening argument.
                  </p>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={styles.msgRow(msg.role)}>
                <div style={styles.bubble(msg.role)}>
                  {msg.streaming && !msg.content ? (
                    <div style={styles.loadingDots}>
                      <div style={{ ...styles.dot, animationDelay: '0s' }} />
                      <div style={{ ...styles.dot, animationDelay: '0.2s' }} />
                      <div style={{ ...styles.dot, animationDelay: '0.4s' }} />
                    </div>
                  ) : msg.role === 'user' ? (
                    msg.content
                  ) : (
                    <div className="debate-markdown">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            ))}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={styles.inputArea}>
            <textarea
              ref={textareaRef}
              style={styles.textarea}
              placeholder={mode === 'defend' ? 'Challenge the defense...' : 'Defend the position...'}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={loading}
              rows={1}
              autoFocus
            />
            <button
              style={{ ...styles.sendBtn, opacity: !input.trim() || loading ? 0.5 : 1 }}
              onClick={handleSend}
              disabled={!input.trim() || loading}
            >
              Send
            </button>
          </div>
        </div>

        {/* Weaknesses sidebar */}
        <div style={styles.weaknessesSidebar}>
          <div style={styles.weaknessTitle}>
            Weaknesses Found ({weaknesses.length})
          </div>
          {weaknesses.length === 0 ? (
            <div style={{ color: '#555', fontSize: '12px' }}>
              No weaknesses discovered yet. Keep debating to uncover gaps in the argument.
            </div>
          ) : (
            weaknesses.map((w, i) => (
              <div key={i} style={styles.weaknessItem}>
                <div style={styles.weaknessSeverity(w.severity)}>{w.severity}</div>
                <div>{w.description}</div>
              </div>
            ))
          )}
        </div>

        {/* Summary overlay */}
        {showSummary && (
          <div style={styles.summaryOverlay}>
            <div style={styles.summaryCard}>
              <div style={styles.summaryTitle}>Debate Summary</div>
              <div style={styles.summaryStats}>
                Mode: {mode === 'defend' ? 'Defense' : 'Attack'} | Exchanges: {Math.floor(messages.filter(m => m.role === 'user').length)} | Weaknesses: {weaknesses.length}
              </div>

              {weaknesses.length === 0 ? (
                <div style={{ color: '#888', fontSize: '14px' }}>
                  No weaknesses were identified during this debate. The position appears solid based on the exchanges.
                </div>
              ) : (
                <>
                  <div style={{ color: '#aaa', fontSize: '13px', marginBottom: '12px' }}>
                    The following weaknesses were identified:
                  </div>
                  {weaknesses.map((w, i) => (
                    <div key={i} style={{ ...styles.weaknessItem, backgroundColor: '#252525' }}>
                      <div style={styles.weaknessSeverity(w.severity)}>{w.severity}</div>
                      <div>{w.description}</div>
                    </div>
                  ))}
                  <div style={{ marginTop: '12px', color: '#666', fontSize: '12px' }}>
                    High: {weaknesses.filter(w => w.severity === 'high').length} |
                    Medium: {weaknesses.filter(w => w.severity === 'medium').length} |
                    Low: {weaknesses.filter(w => w.severity === 'low').length}
                  </div>
                </>
              )}

              <button style={styles.summaryCloseBtn} onClick={() => setShowSummary(false)}>
                Continue Debating
              </button>
              <button
                style={{ ...styles.endBtn, marginTop: '16px', marginLeft: '10px' }}
                onClick={onClose}
              >
                Close Debate
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
