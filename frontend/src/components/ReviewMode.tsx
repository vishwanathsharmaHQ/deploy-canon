import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { QUALITY_BUTTONS } from '../constants';
import type { VocabWord, VocabStats } from '../types';
import './ReviewMode.css';

interface SessionStats {
  reviewed: number;
  avgQuality: number;
  totalQuality: number;
}

const ReviewMode: React.FC<{ onClose?: () => void; threadId?: number | null }> = ({ onClose, threadId }) => {
  const [dueWords, setDueWords] = useState<VocabWord[]>([]);
  const [allWords, setAllWords] = useState<VocabWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState<VocabStats | null>(null);
  const [sessionStats, setSessionStats] = useState<SessionStats>({ reviewed: 0, avgQuality: 0, totalQuality: 0 });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'review' | 'list'>('review');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [due, vocabStats, words] = await Promise.all([
        api.vocabDue(threadId),
        api.vocabStats(threadId),
        api.vocabList(threadId),
      ]);
      setDueWords(due);
      setStats(vocabStats);
      setAllWords(words);
      setCurrentIndex(0);
      setRevealed(false);
    } catch (err) {
      console.error('Review load error:', err);
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRate = async (quality: number) => {
    const word = dueWords[currentIndex];
    if (!word?.id) return;
    try {
      await api.vocabReview(word.id, quality);
      const newSessionStats: SessionStats = {
        reviewed: sessionStats.reviewed + 1,
        totalQuality: sessionStats.totalQuality + quality,
        avgQuality: Math.round(((sessionStats.totalQuality + quality) / (sessionStats.reviewed + 1)) * 10) / 10,
      };
      setSessionStats(newSessionStats);

      if (currentIndex < dueWords.length - 1) {
        setCurrentIndex(prev => prev + 1);
        setRevealed(false);
      } else {
        await loadData();
      }
    } catch (err) {
      console.error('Rate error:', err);
    }
  };

  const handleDelete = async (wordId: number) => {
    try {
      await api.vocabDelete(wordId);
      setAllWords(prev => prev.filter(w => w.id !== wordId));
      setDueWords(prev => prev.filter(w => w.id !== wordId));
      if (stats) setStats({ ...stats, total: (stats.total || 0) - 1 });
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const currentWord = dueWords[currentIndex];

  if (loading) return <div className="review-mode"><div className="rm-loading">Loading vocabulary...</div></div>;

  return (
    <div className="review-mode">
      {/* Tab switcher */}
      <div className="rm-tabs">
        <button className={`rm-tab ${tab === 'review' ? 'active' : ''}`} onClick={() => setTab('review')}>
          Review {stats?.due ? `(${stats.due})` : ''}
        </button>
        <button className={`rm-tab ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>
          All Words {stats?.total ? `(${stats.total})` : ''}
        </button>
      </div>

      {tab === 'list' ? (
        /* ── Word list ── */
        <div className="rm-word-list">
          {allWords.length === 0 ? (
            <div className="rm-empty">
              <h3>No words yet</h3>
              <p>Select any text on the site and click "Define" to start building your vocabulary.</p>
            </div>
          ) : (
            allWords.map(word => (
              <div key={word.id} className="rm-word-item">
                <div className="rm-word-top">
                  <div className="rm-word-term">
                    <span className="rm-word-text">{word.word}</span>
                    {word.partOfSpeech && <span className="rm-word-pos">{word.partOfSpeech}</span>}
                  </div>
                  <div className="rm-word-meta">
                    <span className="rm-word-reps">
                      {(word.reviewRepetitions || 0) >= 5 ? 'mastered' : `${word.reviewRepetitions || 0} reps`}
                    </span>
                    <button className="rm-word-delete" onClick={() => word.id && handleDelete(word.id)} title="Remove">&times;</button>
                  </div>
                </div>
                <p className="rm-word-def">{word.definition}</p>
                {word.exampleSentence && <p className="rm-word-example">"{word.exampleSentence}"</p>}
              </div>
            ))
          )}
        </div>
      ) : (
        /* ── Review mode ── */
        <>
          {!dueWords.length ? (
            <div className="rm-complete">
              <h3>
                {(stats?.total || 0) === 0 ? 'No words yet' : 'All caught up!'}
              </h3>
              <p>
                {(stats?.total || 0) === 0
                  ? 'Select any text on the site and click "Define" to look up words and add them to your vocabulary.'
                  : 'No words are due for review right now.'}
              </p>
              {stats && (stats.total || 0) > 0 && (
                <div className="rm-stats-grid">
                  <div className="rm-stat"><span className="rm-stat-num">{stats.total}</span><span className="rm-stat-label">Total</span></div>
                  <div className="rm-stat"><span className="rm-stat-num">{stats.mastered}</span><span className="rm-stat-label">Mastered</span></div>
                  <div className="rm-stat"><span className="rm-stat-num">{stats.reviewed}</span><span className="rm-stat-label">Reviewed</span></div>
                </div>
              )}
              {sessionStats.reviewed > 0 && (
                <p className="rm-session">This session: {sessionStats.reviewed} reviewed, avg quality {sessionStats.avgQuality}</p>
              )}
            </div>
          ) : (
            <>
              <div className="rm-header">
                <div className="rm-progress">
                  <div className="rm-progress-bar" style={{ width: `${((currentIndex) / dueWords.length) * 100}%` }} />
                </div>
                <span className="rm-counter">{currentIndex + 1} / {dueWords.length}</span>
              </div>

              <div className="rm-card" onClick={() => !revealed && setRevealed(true)}>
                <div className="rm-card-front">
                  {currentWord?.partOfSpeech && (
                    <span className="rm-card-type">{currentWord.partOfSpeech}</span>
                  )}
                  <h3 className="rm-card-title">{currentWord?.word}</h3>
                  {currentWord?.pronunciation && (
                    <span className="rm-card-pronunciation">{currentWord.pronunciation}</span>
                  )}
                  {!revealed && <p className="rm-card-hint">Click to reveal definition</p>}
                </div>
                {revealed && (
                  <div className="rm-card-back">
                    <p className="rm-card-definition">{currentWord?.definition}</p>
                    {currentWord?.exampleSentence && (
                      <p className="rm-card-example">"{currentWord.exampleSentence}"</p>
                    )}
                    {currentWord?.etymology && (
                      <p className="rm-card-etymology">{currentWord.etymology}</p>
                    )}
                  </div>
                )}
              </div>

              {revealed && (
                <div className="rm-rating">
                  <p className="rm-rating-prompt">How well did you know this?</p>
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
            </>
          )}
        </>
      )}
    </div>
  );
};

export default ReviewMode;
