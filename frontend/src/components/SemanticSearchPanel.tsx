import React, { useState } from 'react';
import { api } from '../services/api';
import { NODE_TYPE_COLORS } from '../constants';
import type { NodeTypeName } from '../types';
import './SemanticSearchPanel.css';

interface SearchSource {
  nodeId: number;
  threadId: number;
  threadTitle: string;
  nodeTitle: string;
  relevance: number;
}

interface SearchAnswer {
  answer: string;
  sources?: SearchSource[];
}

interface SearchResultThread {
  id: number;
  title: string;
  relevance: number;
}

interface SearchResultNode {
  id: number;
  threadId: number;
  threadTitle: string;
  title: string;
  node_type: NodeTypeName;
  relevance: number;
}

interface SearchResults {
  threads?: SearchResultThread[];
  nodes?: SearchResultNode[];
}

interface SemanticSearchPanelProps {
  onSelectThread?: (threadId: number) => void;
  onSelectNode?: (nodeId: number, threadId: number) => void;
  onClose?: () => void;
}

const SemanticSearchPanel: React.FC<SemanticSearchPanelProps> = ({ onSelectThread, onSelectNode, onClose }) => {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'search' | 'ask'>('search');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
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
            {answer.sources && answer.sources.length > 0 && (
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
            {results.threads && results.threads.length > 0 && (
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
            {results.nodes && results.nodes.length > 0 && (
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
