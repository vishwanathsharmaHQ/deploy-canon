import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import './SocraticPanel.css';

const SocraticPanel = ({ thread, currentUser, onAuthRequired, onNodesCreated, nodeContext }) => {
  const [history, setHistory] = useState([]);          // [{question, answer}]
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [loading, setLoading] = useState(true);        // true while fetching first question
  const [captures, setCaptures] = useState([]);        // [{type,title,content,saved}]
  const historyEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Fetch the opening question on mount
  useEffect(() => {
    fetchNextQuestion('', []);
  }, []);

  // Scroll history to bottom when it grows
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const fetchNextQuestion = async (answer, currentHistory) => {
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
    await fetchNextQuestion(answer, newHistory);
  };

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit();
  };

  const handleSaveNode = async (capture, idx) => {
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
        <button className="sp-reset" onClick={handleReset} title="Start over">↺</button>
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
          onChange={e => setCurrentAnswer(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Your answer… (⌘↵ to send)"
          disabled={loading}
          rows={3}
        />
        <button
          className="sp-send"
          onClick={handleSubmit}
          disabled={loading || !currentAnswer.trim()}
          title="Send answer"
        >
          →
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
                <span className="sp-capture-done">✓</span>
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
