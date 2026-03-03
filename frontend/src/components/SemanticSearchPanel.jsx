import React, { useState } from 'react';
import { api } from '../services/api';
import { NODE_TYPE_COLORS } from '../constants';
import './SemanticSearchPanel.css';

const SemanticSearchPanel = ({ onSelectThread, onSelectNode, onClose }) => {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('search'); // 'search' | 'ask'
  const [results, setResults] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setAnswer(null);
    try {
      if (mode === 'ask') {
        const data = await api.searchAnswer(query);
        setAnswer(data);
        setResults(null);
      } else {
        const data = await api.semanticSearch(query);
        setResults(data);
        setAnswer(null);
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div className="semantic-search-panel">
      <div className="ssp-header">
        <h3>Semantic Search</h3>
        {onClose && <button className="ssp-close" onClick={onClose}>&times;</button>}
      </div>

      <div className="ssp-controls">
        <div className="ssp-mode-toggle">
          <button className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>Search</button>
          <button className={mode === 'ask' ? 'active' : ''} onClick={() => setMode('ask')}>Ask</button>
        </div>
        <div className="ssp-input-row">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={mode === 'ask' ? 'Ask a question about your knowledge...' : 'Search across all threads and nodes...'}
          />
          <button onClick={handleSearch} disabled={loading}>
            {loading ? '...' : mode === 'ask' ? 'Ask' : 'Search'}
          </button>
        </div>
      </div>

      <div className="ssp-results">
        {answer && (
          <div className="ssp-answer">
            <h4>Answer</h4>
            <p>{answer.answer}</p>
            {answer.sources?.length > 0 && (
              <div className="ssp-sources">
                <h5>Sources</h5>
                {answer.sources.map((s, i) => (
                  <div key={i} className="ssp-source" onClick={() => onSelectNode?.(s.nodeId, s.threadId)}>
                    <span className="ssp-source-thread">{s.threadTitle}</span>
                    <span className="ssp-source-node">{s.nodeTitle}</span>
                    <span className="ssp-relevance">{Math.round(s.relevance * 100)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {results && (
          <>
            {results.threads?.length > 0 && (
              <div className="ssp-section">
                <h4>Threads</h4>
                {results.threads.map(t => (
                  <div key={t.id} className="ssp-result-item" onClick={() => onSelectThread?.(t.id)}>
                    <span className="ssp-result-title">{t.title}</span>
                    <span className="ssp-relevance">{Math.round(t.relevance * 100)}%</span>
                  </div>
                ))}
              </div>
            )}
            {results.nodes?.length > 0 && (
              <div className="ssp-section">
                <h4>Nodes</h4>
                {results.nodes.map(n => (
                  <div key={n.id} className="ssp-result-item" onClick={() => onSelectNode?.(n.id, n.threadId)}>
                    <span className="ssp-node-type" style={{ color: NODE_TYPE_COLORS[n.node_type] }}>{n.node_type}</span>
                    <span className="ssp-result-title">{n.title}</span>
                    <span className="ssp-result-thread">{n.threadTitle}</span>
                    <span className="ssp-relevance">{Math.round(n.relevance * 100)}%</span>
                  </div>
                ))}
              </div>
            )}
            {!results.threads?.length && !results.nodes?.length && (
              <p className="ssp-empty">No results found. Try a different query.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SemanticSearchPanel;
