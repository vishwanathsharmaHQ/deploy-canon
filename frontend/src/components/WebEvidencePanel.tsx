import React, { useState } from 'react';
import { api } from '../services/api';
import type { WebEvidence } from '../types';

interface WebEvidencePanelProps {
  threadId: number;
  onAcceptEvidence: (finding: WebEvidence) => void;
}

const relationshipColors: Record<string, string> = {
  supports: '#00ff9d',
  contradicts: '#ef5350',
  extends: '#4dd0e1',
};

const relationshipLabels: Record<string, string> = {
  supports: 'Supports',
  contradicts: 'Contradicts',
  extends: 'Extends',
};

const relevanceColors: Record<string, string> = {
  high: '#00ff9d',
  medium: '#fdd835',
  low: '#888',
};

const WebEvidencePanel: React.FC<WebEvidencePanelProps> = ({
  threadId,
  onAcceptEvidence,
}) => {
  const [findings, setFindings] = useState<WebEvidence[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [usedQuery, setUsedQuery] = useState('');
  const [addingIndex, setAddingIndex] = useState<number | null>(null);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const result = await api.watchThread(threadId, searchQuery || undefined);
      setFindings(result.findings);
      setUsedQuery(result.query);
      setHasSearched(true);
    } catch {
      // error toast handled by api layer
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (finding: WebEvidence, index: number) => {
    setAddingIndex(index);
    try {
      await api.createNode({
        threadId,
        title: finding.title,
        content: JSON.stringify({
          argument: finding.title,
          explanation: finding.content,
          source_url: finding.source_url,
          relationship: finding.relationship,
        }),
        nodeType: finding.proposedNodeType,
        parentId: finding.relatedNodeId || null,
      });
      setFindings(prev => prev.filter((_, i) => i !== index));
      onAcceptEvidence(finding);
    } catch {
      // error toast handled by api layer
    } finally {
      setAddingIndex(null);
    }
  };

  const handleDismiss = (index: number) => {
    setFindings(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div style={{
      background: '#1a1a1a',
      borderRadius: 8,
      padding: 16,
      marginTop: 16,
      border: '1px solid #333',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <h3 style={{ margin: 0, color: '#e0e0e0', fontSize: 14, fontWeight: 600 }}>
          Web Evidence Monitor
        </h3>
      </div>

      {/* Search input */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Custom search query (auto-generates if empty)"
          onKeyDown={(e) => { if (e.key === 'Enter' && !loading) handleSearch(); }}
          style={{
            flex: 1,
            background: '#242424',
            border: '1px solid #333',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 12,
            color: '#e0e0e0',
            outline: 'none',
          }}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          style={{
            background: loading ? '#333' : '#00ff9d',
            color: '#1a1a1a',
            border: 'none',
            borderRadius: 4,
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {loading ? 'Searching...' : 'Search Web'}
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{
          color: '#aaa',
          fontSize: 12,
          textAlign: 'center',
          padding: '12px 0',
          fontStyle: 'italic',
        }}>
          Searching the web for relevant evidence...
        </div>
      )}

      {/* Used query display */}
      {hasSearched && !loading && usedQuery && (
        <div style={{
          color: '#888',
          fontSize: 11,
          marginBottom: 10,
          padding: '4px 8px',
          background: '#242424',
          borderRadius: 4,
        }}>
          Searched: &ldquo;{usedQuery}&rdquo;
        </div>
      )}

      {/* No results */}
      {hasSearched && !loading && findings.length === 0 && (
        <div style={{ color: '#888', fontSize: 12, textAlign: 'center', padding: '8px 0' }}>
          No new web evidence found. Try a different search query.
        </div>
      )}

      {/* Results */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {findings.map((finding, index) => (
          <div
            key={`${finding.title}-${index}`}
            style={{
              background: '#2a2a2a',
              borderRadius: 6,
              padding: 12,
              border: `1px solid ${relationshipColors[finding.relationship] || '#333'}33`,
            }}
          >
            {/* Header: title + badges */}
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              marginBottom: 8,
              gap: 8,
            }}>
              <div style={{ flex: 1 }}>
                {finding.source_url ? (
                  <a
                    href={finding.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: '#e0e0e0',
                      fontSize: 12,
                      fontWeight: 600,
                      textDecoration: 'none',
                      lineHeight: 1.3,
                    }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.color = '#00ff9d'; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.color = '#e0e0e0'; }}
                  >
                    {finding.title}
                  </a>
                ) : (
                  <div style={{ color: '#e0e0e0', fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>
                    {finding.title}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {/* Relationship badge */}
                <span style={{
                  background: relationshipColors[finding.relationship] || '#666',
                  color: finding.relationship === 'supports' ? '#1a1a1a' : '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 10,
                  textTransform: 'uppercase',
                }}>
                  {relationshipLabels[finding.relationship] || finding.relationship}
                </span>
                {/* Relevance indicator */}
                <span style={{
                  background: 'transparent',
                  color: relevanceColors[finding.relevance] || '#888',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: 10,
                  border: `1px solid ${relevanceColors[finding.relevance] || '#444'}`,
                  textTransform: 'uppercase',
                }}>
                  {finding.relevance}
                </span>
              </div>
            </div>

            {/* Content preview */}
            <div style={{
              color: '#aaa',
              fontSize: 11,
              lineHeight: 1.5,
              marginBottom: 8,
              maxHeight: 60,
              overflow: 'hidden',
            }}>
              {finding.content}
            </div>

            {/* Source URL */}
            {finding.source_url && (
              <div style={{
                fontSize: 10,
                color: '#666',
                marginBottom: 8,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {finding.source_url}
              </div>
            )}

            {/* Related node reference */}
            {finding.relatedNodeTitle && (
              <div style={{
                fontSize: 10,
                color: '#888',
                marginBottom: 8,
                padding: '3px 6px',
                background: '#333',
                borderRadius: 3,
                display: 'inline-block',
              }}>
                Related to: {finding.relatedNodeTitle}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => handleAccept(finding, index)}
                disabled={addingIndex === index}
                style={{
                  flex: 1,
                  background: addingIndex === index ? '#333' : '#00ff9d',
                  color: '#1a1a1a',
                  border: 'none',
                  borderRadius: 4,
                  padding: '5px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: addingIndex === index ? 'not-allowed' : 'pointer',
                }}
              >
                {addingIndex === index ? 'Adding...' : 'Add as Node'}
              </button>
              <button
                onClick={() => handleDismiss(index)}
                style={{
                  flex: 1,
                  background: 'transparent',
                  color: '#888',
                  border: '1px solid #444',
                  borderRadius: 4,
                  padding: '5px 10px',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WebEvidencePanel;
