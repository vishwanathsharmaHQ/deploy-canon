import { useState, useRef, useEffect } from 'react';
import { api } from '../services/api';
import './ChatPanel.css';

const NODE_COLORS = {
  EVIDENCE: '#4ade80',
  EXAMPLE: '#60a5fa',
  CONTEXT: '#fbbf24',
  COUNTERPOINT: '#f87171',
  SYNTHESIS: '#a78bfa',
  REFERENCE: '#34d399',
};

export default function ChatPanel({ selectedThreadId, onNodesCreated, onThreadCreated }) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('openai_api_key') || '');
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(() => !localStorage.getItem('openai_api_key'));
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState(selectedThreadId);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    setActiveThreadId(selectedThreadId);
  }, [selectedThreadId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSaveKey = () => {
    const key = apiKeyDraft.trim();
    if (!key) return;
    localStorage.setItem('openai_api_key', key);
    setApiKey(key);
    setShowKeyInput(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleSend = async () => {
    if (!input.trim() || loading || !apiKey) return;
    const userMsg = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const history = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: m.content }));

      const result = await api.chat({
        message: userMsg,
        history,
        threadId: activeThreadId,
        apiKey,
      });

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: result.reply,
          citations: result.citations || [],
          createdNodes: result.createdNodes || [],
          newThread: result.newThread || null,
        },
      ]);

      if (result.newThread) {
        setActiveThreadId(result.threadId);
        onThreadCreated?.(result.threadId);
      } else if (result.createdNodes?.length > 0) {
        setActiveThreadId(result.threadId);
        onNodesCreated?.(result.threadId);
      }
    } catch (err) {
      setMessages(prev => [
        ...prev,
        { role: 'error', content: `Error: ${err.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

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
      {/* Header */}
      <div className="cp-header">
        <span className="cp-title">Research Chat</span>
        <div className="cp-key-area">
          {showKeyInput ? (
            <div className="cp-key-form">
              <input
                className="cp-key-input"
                type="password"
                placeholder="sk-..."
                value={apiKeyDraft}
                onChange={e => setApiKeyDraft(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveKey()}
                autoFocus
              />
              <button className="cp-key-save" onClick={handleSaveKey}>Save</button>
              {apiKey && (
                <button
                  className="cp-key-cancel"
                  onClick={() => setShowKeyInput(false)}
                >
                  Cancel
                </button>
              )}
            </div>
          ) : (
            <button
              className="cp-key-btn"
              onClick={() => { setApiKeyDraft(apiKey); setShowKeyInput(true); }}
              title="Change OpenAI API key"
            >
              API Key ●●●●
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="cp-messages">
        {messages.length === 0 && (
          <div className="cp-empty">
            {!apiKey ? (
              <p>
                Add your OpenAI API key above to start chatting.
                <br />
                Nodes will be auto-created in your knowledge graph as you research.
              </p>
            ) : (
              <p>
                Ask anything — relevant nodes will be created in your knowledge graph as you research.
                <br />
                Topic shifts automatically create new threads.
              </p>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`cp-msg cp-msg--${msg.role}`}>
            {msg.role === 'user' && (
              <div className="cp-bubble cp-bubble--user">{msg.content}</div>
            )}

            {msg.role === 'assistant' && (
              <div className="cp-bubble cp-bubble--assistant">
                <div className="cp-text">{msg.content}</div>

                {msg.citations?.length > 0 && (
                  <div className="cp-citations">
                    <span className="cp-citations-label">Sources</span>
                    {msg.citations.map((c, ci) => (
                      <a
                        key={ci}
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cp-citation"
                        title={c.url}
                      >
                        [{ci + 1}] {(c.title || c.url).substring(0, 60)}
                      </a>
                    ))}
                  </div>
                )}

                {(msg.createdNodes?.length > 0 || msg.newThread) && (
                  <div className="cp-nodes-created">
                    {msg.newThread && (
                      <span className="cp-new-thread">
                        ↗ New thread: {msg.newThread.title}
                      </span>
                    )}
                    {msg.createdNodes?.map((n, ni) => (
                      <span
                        key={ni}
                        className="cp-node-chip"
                        style={{
                          borderColor: NODE_COLORS[n.type] || '#555',
                          color: NODE_COLORS[n.type] || '#aaa',
                        }}
                        title={n.title}
                      >
                        {n.type}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {msg.role === 'error' && (
              <div className="cp-bubble cp-bubble--error">{msg.content}</div>
            )}
          </div>
        ))}

        {loading && (
          <div className="cp-msg cp-msg--assistant">
            <div className="cp-bubble cp-bubble--assistant cp-bubble--loading">
              <span className="cp-dot" />
              <span className="cp-dot" />
              <span className="cp-dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="cp-input-area">
        <textarea
          ref={el => { textareaRef.current = el; inputRef.current = el; }}
          className="cp-input"
          placeholder={apiKey ? 'Ask anything… (Shift+Enter for new line)' : 'Set your OpenAI API key first'}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={!apiKey || loading}
          rows={1}
        />
        <button
          className="cp-send"
          onClick={handleSend}
          disabled={!apiKey || !input.trim() || loading}
          aria-label="Send"
        >
          ▶
        </button>
      </div>
    </div>
  );
}
