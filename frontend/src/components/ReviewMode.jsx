import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import QuizMode from './QuizMode';
import { NODE_TYPES, QUALITY_BUTTONS } from '../constants';
import './ReviewMode.css';

const ReviewMode = ({ threadId, onClose }) => {
  const [dueNodes, setDueNodes] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState(null);
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, avgQuality: 0, totalQuality: 0 });
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('review'); // 'review' | 'quiz'
  const [initialized, setInitialized] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [due, reviewStats] = await Promise.all([
        api.getDueReviews(threadId),
        api.getReviewStats(threadId),
      ]);
      setDueNodes(due);
      setStats(reviewStats);
      setCurrentIndex(0);
      setRevealed(false);
    } catch (err) {
      console.error('Review load error:', err);
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleInit = async () => {
    try {
      await api.initReview(threadId);
      setInitialized(true);
      await loadData();
    } catch (err) {
      console.error('Init error:', err);
    }
  };

  const handleRate = async (quality) => {
    const node = dueNodes[currentIndex];
    if (!node) return;
    try {
      await api.submitReview(node.id, quality);
      const newSessionStats = {
        reviewed: sessionStats.reviewed + 1,
        totalQuality: sessionStats.totalQuality + quality,
        avgQuality: Math.round(((sessionStats.totalQuality + quality) / (sessionStats.reviewed + 1)) * 10) / 10,
      };
      setSessionStats(newSessionStats);

      if (currentIndex < dueNodes.length - 1) {
        setCurrentIndex(prev => prev + 1);
        setRevealed(false);
      } else {
        // Session complete - reload
        await loadData();
      }
    } catch (err) {
      console.error('Rate error:', err);
    }
  };

  const currentNode = dueNodes[currentIndex];

  const parseContent = (node) => {
    if (!node) return { title: '', body: '' };
    let body = node.content || '';
    try {
      const parsed = JSON.parse(body);
      body = parsed.description || parsed.point || parsed.explanation || parsed.argument || body;
    } catch (e) {}
    body = body.replace(/<[^>]+>/g, '');
    return { title: node.title, body, nodeType: node.node_type };
  };

  if (loading) return <div className="review-mode"><div className="rm-loading">Loading review data...</div></div>;

  if (!stats?.reviewable && !initialized) {
    return (
      <div className="review-mode">
        <div className="rm-empty">
          <h3>No Review Data</h3>
          <p>Initialize spaced repetition for this thread to start reviewing nodes.</p>
          <button className="rm-init-btn" onClick={handleInit}>Initialize Review</button>
        </div>
      </div>
    );
  }

  if (!dueNodes.length) {
    return (
      <div className="review-mode">
        <div className="rm-complete">
          <h3>All caught up!</h3>
          <p>No nodes are due for review right now.</p>
          {stats && (
            <div className="rm-stats-grid">
              <div className="rm-stat"><span className="rm-stat-num">{stats.reviewable}</span><span className="rm-stat-label">Total</span></div>
              <div className="rm-stat"><span className="rm-stat-num">{stats.mastered}</span><span className="rm-stat-label">Mastered</span></div>
              <div className="rm-stat"><span className="rm-stat-num">{stats.due}</span><span className="rm-stat-label">Due</span></div>
            </div>
          )}
          {sessionStats.reviewed > 0 && (
            <p className="rm-session">This session: {sessionStats.reviewed} reviewed, avg quality {sessionStats.avgQuality}</p>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'quiz' && currentNode) {
    return <QuizMode node={currentNode} onBack={() => setMode('review')} onRate={handleRate} />;
  }

  const { title, body, nodeType } = parseContent(currentNode);

  return (
    <div className="review-mode">
      <div className="rm-header">
        <div className="rm-progress">
          <div className="rm-progress-bar" style={{ width: `${((currentIndex) / dueNodes.length) * 100}%` }} />
        </div>
        <span className="rm-counter">{currentIndex + 1} / {dueNodes.length}</span>
        <button className="rm-quiz-btn" onClick={() => setMode('quiz')}>Quiz</button>
      </div>

      <div className="rm-card" onClick={() => !revealed && setRevealed(true)}>
        <div className="rm-card-front">
          <span className="rm-card-type" style={{ color: nodeType === 'ROOT' ? '#ffd700' : '#aaa' }}>{nodeType}</span>
          <h3 className="rm-card-title">{title}</h3>
          {!revealed && <p className="rm-card-hint">Click to reveal</p>}
        </div>
        {revealed && (
          <div className="rm-card-back">
            <p>{body}</p>
          </div>
        )}
      </div>

      {revealed && (
        <div className="rm-rating">
          <p className="rm-rating-prompt">How well did you remember?</p>
          <div className="rm-rating-buttons">
            {QUALITY_BUTTONS.map(({ quality, label, color }) => (
              <button
                key={quality}
                className="rm-rate-btn"
                style={{ borderColor: color, color }}
                onClick={() => handleRate(quality)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {stats && (
        <div className="rm-footer-stats">
          <span>Due: {stats.due}</span>
          <span>Mastered: {stats.mastered}</span>
          <span>Session: {sessionStats.reviewed}</span>
        </div>
      )}
    </div>
  );
};

export default ReviewMode;
