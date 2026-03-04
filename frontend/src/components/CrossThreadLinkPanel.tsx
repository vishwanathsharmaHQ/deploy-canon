import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { NODE_TYPE_COLORS } from '../constants';
import type { NodeTypeName } from '../types';
import './CrossThreadLinkPanel.css';

interface LinkOtherNode {
  id: number | null;
  title: string;
  node_type: string;
}

interface LinkItem {
  id: number | null;
  direction: string;
  threadId: number | null;
  threadTitle: string;
  otherNode: LinkOtherNode;
}

interface LinkSuggestion {
  sourceNodeId: number | null;
  targetNodeId: number | null;
  sourceNodeTitle: string;
  targetNodeTitle: string;
  targetNodeType: string;
  threadId?: number | null;
  threadTitle: string;
  similarity: number;
}

interface CrossThreadLinkPanelProps {
  nodeId: number | null;
  threadId: number | null;
  onNavigateToThread?: (threadId: number) => void;
}

const CrossThreadLinkPanel: React.FC<CrossThreadLinkPanelProps> = ({ nodeId, threadId, onNavigateToThread }) => {
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const loadLinks = useCallback(async () => {
    if (!nodeId) return;
    setLoading(true);
    try {
      const data = await api.getNodeLinks(nodeId);
      setLinks(data);
    } catch (err) {
      console.error('Load links error:', err);
    } finally {
      setLoading(false);
    }
  }, [nodeId]);

  useEffect(() => { loadLinks(); }, [loadLinks]);

  const handleSuggest = async () => {
    if (!threadId) return;
    setSuggestLoading(true);
    try {
      const data = await api.suggestLinks(threadId);
      setSuggestions(data.suggestions || []);
    } catch (err) {
      console.error('Suggest error:', err);
    } finally {
      setSuggestLoading(false);
    }
  };

  const handleAcceptSuggestion = async (suggestion: LinkSuggestion) => {
    try {
      await api.createLink({
        sourceNodeId: suggestion.sourceNodeId!,
        targetNodeId: suggestion.targetNodeId!,
        type: 'ai_suggested',
        description: `Linked: "${suggestion.sourceNodeTitle}" <-> "${suggestion.targetNodeTitle}"`,
        confidence: suggestion.similarity,
        status: 'accepted',
      });
      setSuggestions(prev => prev.filter(s => s.targetNodeId !== suggestion.targetNodeId || s.sourceNodeId !== suggestion.sourceNodeId));
      await loadLinks();
    } catch (err) {
      console.error('Accept link error:', err);
    }
  };

  const handleDeleteLink = async (linkId: number) => {
    try {
      await api.deleteLink(linkId);
      setLinks(prev => prev.filter(l => l.id !== linkId));
    } catch (err) {
      console.error('Delete link error:', err);
    }
  };

  if (!nodeId) return null;

  return (
    <div className="cross-thread-link-panel">
      <div className="ctlp-header">
        <h4>Cross-Thread Links</h4>
        <button className="ctlp-suggest-btn" onClick={handleSuggest} disabled={suggestLoading}>
          {suggestLoading ? '...' : 'Find Links'}
        </button>
      </div>

      {loading ? (
        <p className="ctlp-loading">Loading links...</p>
      ) : links.length > 0 ? (
        <div className="ctlp-links">
          {links.map(link => (
            <div key={link.id} className="ctlp-link">
              <div className="ctlp-link-info">
                <span className="ctlp-link-direction">{link.direction === 'outgoing' ? '\u2192' : '\u2190'}</span>
                <span
                  className="ctlp-link-node"
                  style={{ color: NODE_TYPE_COLORS[link.otherNode.node_type as NodeTypeName] }}
                  onClick={() => onNavigateToThread?.(link.threadId!)}
                >
                  {link.otherNode.title}
                </span>
                <span className="ctlp-link-thread">{link.threadTitle}</span>
              </div>
              <button className="ctlp-delete" onClick={() => handleDeleteLink(link.id!)}>&times;</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="ctlp-empty">No cross-thread links yet</p>
      )}

      {suggestions.length > 0 && (
        <div className="ctlp-suggestions">
          <h5>AI Suggestions</h5>
          {suggestions.map((s, i) => (
            <div key={i} className="ctlp-suggestion">
              <div className="ctlp-suggestion-info">
                <span style={{ color: NODE_TYPE_COLORS[s.targetNodeType as NodeTypeName] }}>[{s.targetNodeType}]</span>
                <span className="ctlp-suggestion-title">{s.targetNodeTitle}</span>
                <span className="ctlp-suggestion-thread">{s.threadTitle}</span>
                <span className="ctlp-similarity">{Math.round(s.similarity * 100)}%</span>
              </div>
              <button className="ctlp-accept" onClick={() => handleAcceptSuggestion(s)}>Link</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CrossThreadLinkPanel;
