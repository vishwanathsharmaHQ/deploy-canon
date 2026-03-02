import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import './QuizMode.css';

const QuizMode = ({ node, onBack, onRate }) => {
  const [quiz, setQuiz] = useState(null);
  const [answer, setAnswer] = useState('');
  const [showAnswer, setShowAnswer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [quizType, setQuizType] = useState(node.node_type === 'COUNTERPOINT' ? 'steelman' : 'recall');

  useEffect(() => {
    loadQuiz();
  }, [node.id, quizType]);

  const loadQuiz = async () => {
    setLoading(true);
    setShowAnswer(false);
    setAnswer('');
    try {
      const data = await api.generateQuiz(node.id, quizType);
      setQuiz(data);
    } catch (err) {
      console.error('Quiz load error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="quiz-mode"><div className="qm-loading">Generating quiz...</div></div>;
  if (!quiz) return <div className="quiz-mode"><p>Failed to generate quiz.</p><button onClick={onBack}>Back</button></div>;

  return (
    <div className="quiz-mode">
      <div className="qm-header">
        <button className="qm-back" onClick={onBack}>&larr; Back to Review</button>
        <div className="qm-type-toggle">
          <button className={quizType === 'recall' ? 'active' : ''} onClick={() => setQuizType('recall')}>Recall</button>
          {node.node_type === 'COUNTERPOINT' && (
            <button className={quizType === 'steelman' ? 'active' : ''} onClick={() => setQuizType('steelman')}>Steelman</button>
          )}
        </div>
      </div>

      <div className="qm-question">
        <h3>{quiz.question}</h3>
        {quiz.hint && <p className="qm-hint">Hint: {quiz.hint}</p>}
      </div>

      <div className="qm-answer-area">
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Type your answer..."
          rows={4}
          disabled={showAnswer}
        />
      </div>

      {!showAnswer ? (
        <button className="qm-reveal" onClick={() => setShowAnswer(true)} disabled={!answer.trim()}>
          Check Answer
        </button>
      ) : (
        <div className="qm-ideal">
          <h4>Ideal Answer</h4>
          <p>{quiz.idealAnswer}</p>
          <div className="qm-self-rate">
            <p>How well did you do?</p>
            <div className="qm-rate-buttons">
              <button onClick={() => onRate(1)} style={{ color: '#ef5350' }}>Poor</button>
              <button onClick={() => onRate(3)} style={{ color: '#fdd835' }}>Okay</button>
              <button onClick={() => onRate(5)} style={{ color: '#00ff9d' }}>Great</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuizMode;
