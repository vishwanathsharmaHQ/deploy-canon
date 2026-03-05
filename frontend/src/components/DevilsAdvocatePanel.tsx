import React, { useState } from 'react';
import { api } from '../services/api';
import type { DevilsAdvocateChallenge } from '../types';

interface DevilsAdvocatePanelProps {
  threadId: number;
  onAcceptChallenge: (challenge: DevilsAdvocateChallenge) => void;
  onHighlightNode?: (nodeId: number) => void;
}

const severityColors: Record<string, string> = {
  high: '#ef5350',
  medium: '#fdd835',
  low: '#66bb6a',
};

const DevilsAdvocatePanel: React.FC<DevilsAdvocatePanelProps> = ({
  threadId,
  onAcceptChallenge,
  onHighlightNode,
}) => {
  const [challenges, setChallenges] = useState<DevilsAdvocateChallenge[]>([]);
  const [unchallengedCount, setUnchallengedCount] = useState<number | null>(null);
  const [totalNodes, setTotalNodes] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [acceptingId, setAcceptingId] = useState<number | null>(null);

  const runAnalysis = async () => {
    setLoading(true);
    try {
      const result = await api.getDevilsAdvocate(threadId);
      setChallenges(result.challenges);
      setUnchallengedCount(result.unchallengedCount);
      setTotalNodes(result.totalNodes);
      setHasRun(true);
    } catch {
      // error toast handled by api layer
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (challenge: DevilsAdvocateChallenge) => {
    setAcceptingId(challenge.targetNodeId);
    try {
      await api.createNode({
        threadId,
        title: challenge.counterargument.title,
        content: JSON.stringify({
          argument: challenge.counterargument.title,
          explanation: challenge.counterargument.content,
        }),
        nodeType: 'COUNTERPOINT',
        parentId: challenge.targetNodeId,
      });
      setChallenges(prev => prev.filter(c => c.targetNodeId !== challenge.targetNodeId));
      onAcceptChallenge(challenge);
    } catch {
      // error toast handled by api layer
    } finally {
      setAcceptingId(null);
    }
  };

  const handleDismiss = (targetNodeId: number) => {
    setChallenges(prev => prev.filter(c => c.targetNodeId !== targetNodeId));
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
          Devil's Advocate
        </h3>
        <button
          onClick={runAnalysis}
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
          }}
        >
          {loading ? 'Preparing counterarguments...' : 'Run Devil\'s Advocate'}
        </button>
      </div>

      {hasRun && unchallengedCount !== null && totalNodes !== null && (
        <div style={{
          color: '#aaa',
          fontSize: 12,
          marginBottom: 12,
          padding: '6px 10px',
          background: '#2a2a2a',
          borderRadius: 4,
        }}>
          <span style={{ color: unchallengedCount > 0 ? '#fdd835' : '#66bb6a', fontWeight: 600 }}>
            {unchallengedCount}
          </span>
          {' '}of{' '}
          <span style={{ fontWeight: 600 }}>{totalNodes}</span>
          {' '}nodes are unchallenged
        </div>
      )}

      {challenges.length === 0 && hasRun && !loading && (
        <div style={{ color: '#888', fontSize: 12, textAlign: 'center', padding: '8px 0' }}>
          All nodes have been challenged. Your argument is well stress-tested.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {challenges.map((challenge) => (
          <div
            key={challenge.targetNodeId}
            style={{
              background: '#2a2a2a',
              borderRadius: 6,
              padding: 12,
              border: `1px solid ${severityColors[challenge.severity]}33`,
            }}
          >
            {/* Header: target node + severity */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}>
              <button
                onClick={() => onHighlightNode?.(challenge.targetNodeId)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#00ff9d',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline',
                  textAlign: 'left',
                }}
                title="Highlight this node in the graph"
              >
                {challenge.targetNodeTitle}
              </button>
              <span style={{
                background: severityColors[challenge.severity],
                color: challenge.severity === 'medium' ? '#1a1a1a' : '#fff',
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 10,
                textTransform: 'uppercase',
              }}>
                {challenge.severity}
              </span>
            </div>

            {/* Challenging question */}
            <div style={{
              color: '#ccc',
              fontSize: 12,
              fontStyle: 'italic',
              marginBottom: 8,
              lineHeight: 1.4,
            }}>
              {challenge.challengeQuestion}
            </div>

            {/* Proposed counterargument preview */}
            <div style={{
              background: '#333',
              borderRadius: 4,
              padding: 8,
              marginBottom: 8,
            }}>
              <div style={{ color: '#e0e0e0', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Proposed: {challenge.counterargument.title}
              </div>
              <div
                style={{ color: '#aaa', fontSize: 11, lineHeight: 1.4, maxHeight: 60, overflow: 'hidden' }}
                dangerouslySetInnerHTML={{ __html: challenge.counterargument.content }}
              />
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => handleAccept(challenge)}
                disabled={acceptingId === challenge.targetNodeId}
                style={{
                  flex: 1,
                  background: acceptingId === challenge.targetNodeId ? '#333' : '#00ff9d',
                  color: '#1a1a1a',
                  border: 'none',
                  borderRadius: 4,
                  padding: '5px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: acceptingId === challenge.targetNodeId ? 'not-allowed' : 'pointer',
                }}
              >
                {acceptingId === challenge.targetNodeId ? 'Creating...' : 'Accept'}
              </button>
              <button
                onClick={() => handleDismiss(challenge.targetNodeId)}
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

export default DevilsAdvocatePanel;
