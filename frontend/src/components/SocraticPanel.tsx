import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import type { Thread, ThreadNode, User } from '../types';
import './SocraticPanel.css';

interface SocraticExchange {
  question: string;
  answer: string;
}

interface CapturedNode {
  type: string;
  title: string;
  content: string;
  saved: boolean;
}

interface SocraticPanelProps {
  thread: Thread;
  currentUser: User | null | undefined;
  onAuthRequired?: () => void;
  onNodesCreated?: (nodes: ThreadNode[]) => void;
  nodeContext?: { nodeId: number; nodeType: string; title: string; content: string } | null;
}

const SocraticPanel: React.FC<SocraticPanelProps> = ({ thread, currentUser, onAuthRequired, onNodesCreated, nodeContext }) => {
  const [history, setHistory] = useState<SocraticExchange[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [loading, setLoading] = useState(true);
  const [captures, setCaptures] = useState<CapturedNode[]>([]);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load persisted history on mount, then fetch next question
  useEffect(() => {
    const init = async () => {
      try {
        const { history: stored } = await api.getSocraticHistory(thread.id);
        if (stored && stored.length > 0) {
          setHistory(stored);
          fetchNextQuestion('', stored);
        } else {
          fetchNextQuestion('', []);
        }
      } catch {
        fetchNextQuestion('', []);
      }
    };
    init();
  }, [thread.id]);

  // Scroll history to bottom when it grows
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const fetchNextQuestion = async (answer: string, currentHistory: SocraticExchange[]) => {
    setLoading(true);
    try {
      const result = await api.socraticQuestion({
        threadId: thread.id,
        history: currentHistory,
        currentAnswer: answer,
        nodeContext,
      });
      setCurrentQuestion(result.question);
      if (result.nodeFromAnswer && answer.trim()) {
        setCaptures(prev => [...prev, { ...result.nodeFromAnswer, saved: false }]);
      }
    } catch (err) {
      console.error('Socratic fetch error:', err);
      setCurrentQuestion('Could not load question. Please try again.');
    } finally {
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  const handleSubmit = async () => {
    if (!currentAnswer.trim() || loading) return;
    const answer = currentAnswer.trim();
    const newHistory = [...history, { question: currentQuestion, answer }];
    setHistory(newHistory);
    setCurrentAnswer('');
    // Persist history after each exchange (fire-and-forget)
    api.saveSocraticHistory(thread.id, newHistory).catch(console.error);
    await fetchNextQuestion(answer, newHistory);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit();
  };

  const handleSaveNode = async (capture: CapturedNode, idx: number) => {
    if (!currentUser) { onAuthRequired?.(); return; }
    try {
      const node = await api.createNode({
        threadId: thread.id,
        title: capture.title,
        content: capture.content,
        nodeType: capture.type,
        parentId: null,
      });
      onNodesCreated?.([node]);
      setCaptures(prev => prev.map((c, i) => i === idx ? { ...c, saved: true } : c));
    } catch (err) {
      console.error('Failed to save node:', err);
    }
  };

  const handleReset = () => {
    setHistory([]);
    setCaptures([]);
    setCurrentAnswer('');
    api.saveSocraticHistory(thread.id, []).catch(console.error);
    fetchNextQuestion('', []);
  };

  return (
    <div className="sp-panel">
      {/* Header */}
      <div className="sp-header">
        <div className="sp-header-left">
          <span className="sp-title">Socratic Dialogue</span>
          {history.length > 0 && (
            <span className="sp-exchanges">{history.length} exchange{history.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        <button className="sp-reset" onClick={handleReset} title="Start over">{'\u21BA'}</button>
      </div>

      {/* Scrollable body: history + current question */}
      <div className="sp-body">
        {/* Past exchanges */}
        {history.map((h, i) => (
          <div key={i} className="sp-exchange">
            <div className="sp-exchange-q">{h.question}</div>
            <div className="sp-exchange-a">{h.answer}</div>
          </div>
        ))}

        {/* Current question */}
        <div className={`sp-question-block${loading ? ' sp-question-block--loading' : ''}`}>
          {loading ? (
            <div className="sp-thinking">
              <span className="sp-dot" />
              <span className="sp-dot" />
              <span className="sp-dot" />
            </div>
          ) : (
            <p className="sp-question">{currentQuestion}</p>
          )}
        </div>

        <div ref={historyEndRef} />
      </div>

      {/* Answer input */}
      <div className="sp-input-row">
        <textarea
          ref={textareaRef}
          className="sp-textarea"
          value={currentAnswer}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCurrentAnswer(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Your answer\u2026 (\u2318\u21B5 to send)"
          disabled={loading}
          rows={3}
        />
        <button
          className="sp-send"
          onClick={handleSubmit}
          disabled={loading || !currentAnswer.trim()}
          title="Send answer"
        >
          {'\u2192'}
        </button>
      </div>

      {/* Captured nodes */}
      {captures.length > 0 && (
        <div className="sp-captures">
          <div className="sp-captures-label">Insights captured</div>
          {captures.map((c, i) => (
            <div key={i} className={`sp-capture${c.saved ? ' sp-capture--saved' : ''}`}>
              <span className="sp-capture-type">{c.type}</span>
              <span className="sp-capture-title">{c.title}</span>
              {c.saved ? (
                <span className="sp-capture-done">{'\u2713'}</span>
              ) : (
                <button className="sp-capture-add" onClick={() => handleSaveNode(c, i)}>+ Add</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SocraticPanel;
