import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '../services/api';
import type { Thread } from '../types';

interface PerspectiveThread extends Thread {
  nodeCount?: number;
  perspectiveName?: string;
}

interface PerspectivesPanelProps {
  threadId: number;
  onSelectThread?: (threadId: number) => void;
}

const PerspectivesPanel: React.FC<PerspectivesPanelProps> = ({ threadId, onSelectThread }) => {
  const [perspectives, setPerspectives] = useState<PerspectiveThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [showCompare, setShowCompare] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getPerspectives(threadId).then(data => {
      if (!cancelled) {
        setPerspectives(data.perspectives || []);
        setFetched(true);
      }
    });
    return () => { cancelled = true; };
  }, [threadId]);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const data = await api.generatePerspectives(threadId);
      const newPerspectives = data.perspectives || [];
      setPerspectives(prev => [...prev, ...newPerspectives]);
      toast.success(`Generated ${newPerspectives.length} perspective${newPerspectives.length !== 1 ? 's' : ''}`);
    } catch {
      /* toast shown by api layer */
    } finally {
      setLoading(false);
    }
  };

  // Extract ROOT claim content from a perspective thread
  const getRootClaim = (p: PerspectiveThread): string => {
    if (p.nodes && p.nodes.length > 0) {
      const root = p.nodes.find(n => n.node_type === 'claim' || n.entity_type === 'claim' || n.type === 0);
      if (root) {
        let content = String(root.content || '');
        try {
          const parsed = JSON.parse(content);
          content = parsed.description || parsed.content || parsed.point || content;
        } catch {
          /* raw content */
        }
        return content.replace(/<[^>]+>/g, ' ').substring(0, 200);
      }
    }
    return p.content?.replace(/<[^>]+>/g, ' ').substring(0, 200) || p.description || '';
  };

  const PERSPECTIVE_COLORS = ['#4fc3f7', '#ab47bc', '#ff7043', '#66bb6a', '#fdd835'];

  return (
    <div style={{
      background: '#111', border: '1px solid #333', borderRadius: 8,
      padding: 12, marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h4 style={{ margin: 0, fontSize: 13, color: '#aaa' }}>Multi-Perspective Mode</h4>
        <button
          onClick={handleGenerate}
          disabled={loading}
          style={{
            background: loading ? '#333' : '#1a1a1a',
            border: '1px solid #444', borderRadius: 4,
            color: loading ? '#666' : '#00ff9d', padding: '4px 10px',
            fontSize: 11, cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Generating...' : perspectives.length > 0 ? 'Add More' : 'Generate Perspectives'}
        </button>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', color: '#666', fontSize: 11, padding: '8px 0' }}>
          Generating perspectives (this may take a moment)...
        </div>
      )}

      {fetched && perspectives.length === 0 && !loading && (
        <p style={{ fontSize: 12, color: '#666', margin: '4px 0 0', textAlign: 'center' }}>
          No perspectives generated yet
        </p>
      )}

      {perspectives.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {perspectives.map((p, idx) => (
            <div
              key={p.id}
              onClick={() => onSelectThread?.(p.id)}
              style={{
                background: '#1a1a1a',
                border: '1px solid #2a2a2a',
                borderLeft: `3px solid ${PERSPECTIVE_COLORS[idx % PERSPECTIVE_COLORS.length]}`,
                borderRadius: 6,
                padding: '8px 10px',
                cursor: 'pointer',
                transition: 'border-color 0.2s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#444'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#2a2a2a'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  color: PERSPECTIVE_COLORS[idx % PERSPECTIVE_COLORS.length],
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  {p.perspectiveName || 'Perspective'}
                </span>
                {p.nodeCount != null && (
                  <span style={{ fontSize: 10, color: '#555' }}>
                    {p.nodeCount} node{p.nodeCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#ddd', lineHeight: 1.4 }}>
                {p.title}
              </div>
              {p.description && (
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  {p.description.substring(0, 120)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {perspectives.length >= 2 && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowCompare(v => !v)}
            style={{
              background: 'none', border: '1px solid #333', borderRadius: 4,
              color: '#aaa', padding: '4px 10px', fontSize: 11,
              cursor: 'pointer', width: '100%',
            }}
          >
            {showCompare ? 'Hide Comparison' : 'Compare All'}
          </button>

          {showCompare && (
            <div style={{
              marginTop: 8, background: '#0a0a0a', border: '1px solid #222',
              borderRadius: 6, padding: 10,
            }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 8, fontWeight: 600 }}>
                Side-by-Side Root Nodes
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {perspectives.map((p, idx) => {
                  const claim = getRootClaim(p);
                  return (
                    <div key={p.id} style={{
                      padding: '6px 8px', background: '#111',
                      borderLeft: `3px solid ${PERSPECTIVE_COLORS[idx % PERSPECTIVE_COLORS.length]}`,
                      borderRadius: 4,
                    }}>
                      <div style={{
                        fontSize: 10, fontWeight: 600, marginBottom: 2,
                        color: PERSPECTIVE_COLORS[idx % PERSPECTIVE_COLORS.length],
                      }}>
                        {p.perspectiveName || 'Perspective'}
                      </div>
                      <div style={{ fontSize: 11, color: '#ccc', lineHeight: 1.4 }}>
                        {claim || p.title}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PerspectivesPanel;
