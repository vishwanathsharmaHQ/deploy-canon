import React, { useState } from 'react';
import { api } from '../services/api';
import type { ThreadComparison, ComparisonNode } from '../types';

interface ThreadComparisonViewProps {
  threads: Array<{ id: number; title: string }>;
  currentThreadId?: number;
  onSelectThread: (threadId: number) => void;
}

const NODE_TYPE_COLORS: Record<string, string> = {
  ROOT: '#00ff9d',
  EVIDENCE: '#4fc3f7',
  REFERENCE: '#ce93d8',
  CONTEXT: '#ffb74d',
  EXAMPLE: '#81c784',
  COUNTERPOINT: '#ef5350',
  SYNTHESIS: '#ffd54f',
};

function NodeCard({ node, borderColor }: { node: ComparisonNode; borderColor?: string }) {
  const typeColor = NODE_TYPE_COLORS[node.node_type] || '#888';
  return (
    <div style={{
      background: '#242424',
      border: `1px solid ${borderColor || '#333'}`,
      borderRadius: '8px',
      padding: '12px',
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{
          fontSize: '10px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: typeColor,
          background: `${typeColor}18`,
          padding: '2px 6px',
          borderRadius: '4px',
          border: `1px solid ${typeColor}33`,
        }}>
          {node.node_type}
        </span>
      </div>
      <div style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '13px', marginBottom: '6px' }}>
        {node.title}
      </div>
      <div style={{ color: '#aaa', fontSize: '12px', lineHeight: '1.4', wordBreak: 'break-word' }}>
        {node.content_preview || 'No content'}
      </div>
    </div>
  );
}

const ThreadComparisonView: React.FC<ThreadComparisonViewProps> = ({
  threads,
  currentThreadId,
  onSelectThread,
}) => {
  const [threadIdA, setThreadIdA] = useState<number | ''>(currentThreadId || '');
  const [threadIdB, setThreadIdB] = useState<number | ''>('');
  const [comparison, setComparison] = useState<ThreadComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCompare = async () => {
    if (!threadIdA || !threadIdB) return;
    setLoading(true);
    setError(null);
    setComparison(null);
    try {
      const result = await api.compareThreads(Number(threadIdA), Number(threadIdB));
      setComparison(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Comparison failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px', background: '#1a1a1a' }}>
      {/* Thread selectors */}
      <div style={{
        display: 'flex',
        gap: '12px',
        alignItems: 'flex-end',
        marginBottom: '24px',
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <label style={{ display: 'block', color: '#aaa', fontSize: '12px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Thread A
          </label>
          <select
            value={threadIdA}
            onChange={(e) => setThreadIdA(e.target.value ? Number(e.target.value) : '')}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: '#2a2a2a',
              color: '#e0e0e0',
              border: '1px solid #333',
              borderRadius: '6px',
              fontSize: '13px',
            }}
          >
            <option value="">Select thread...</option>
            {threads.map(t => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
        </div>

        <div style={{ color: '#666', fontSize: '18px', padding: '0 4px 8px', fontWeight: 700 }}>vs</div>

        <div style={{ flex: 1, minWidth: '200px' }}>
          <label style={{ display: 'block', color: '#aaa', fontSize: '12px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Thread B
          </label>
          <select
            value={threadIdB}
            onChange={(e) => setThreadIdB(e.target.value ? Number(e.target.value) : '')}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: '#2a2a2a',
              color: '#e0e0e0',
              border: '1px solid #333',
              borderRadius: '6px',
              fontSize: '13px',
            }}
          >
            <option value="">Select thread...</option>
            {threads.map(t => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
        </div>

        <button
          onClick={handleCompare}
          disabled={!threadIdA || !threadIdB || threadIdA === threadIdB || loading}
          style={{
            padding: '8px 20px',
            background: (!threadIdA || !threadIdB || threadIdA === threadIdB || loading) ? '#333' : '#00ff9d',
            color: (!threadIdA || !threadIdB || threadIdA === threadIdB || loading) ? '#666' : '#1a1a1a',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 700,
            fontSize: '13px',
            cursor: (!threadIdA || !threadIdB || threadIdA === threadIdB || loading) ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {loading ? 'Comparing...' : 'Compare'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: '#ef535018',
          border: '1px solid #ef535066',
          borderRadius: '8px',
          padding: '12px',
          color: '#ef5350',
          marginBottom: '16px',
          fontSize: '13px',
        }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#888' }}>
          <div style={{
            width: '32px',
            height: '32px',
            border: '3px solid #333',
            borderTopColor: '#00ff9d',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px',
          }} />
          <div style={{ fontSize: '14px' }}>Analyzing thread similarities and contradictions...</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Results */}
      {comparison && !loading && (
        <div>
          {/* Summary bar */}
          <div style={{
            display: 'flex',
            gap: '16px',
            marginBottom: '24px',
            flexWrap: 'wrap',
          }}>
            {[
              { label: comparison.threadA.title, value: `${comparison.threadA.nodeCount} nodes`, color: '#00ff9d' },
              { label: comparison.threadB.title, value: `${comparison.threadB.nodeCount} nodes`, color: '#4fc3f7' },
              { label: 'Shared', value: String(comparison.shared.length), color: '#00ff9d' },
              { label: 'Contradictions', value: String(comparison.contradictions.length), color: '#ef5350' },
              { label: 'Unique to A', value: String(comparison.uniqueToA.length), color: '#ffb74d' },
              { label: 'Unique to B', value: String(comparison.uniqueToB.length), color: '#ce93d8' },
            ].map((stat, i) => (
              <div key={i} style={{
                background: '#242424',
                border: '1px solid #333',
                borderRadius: '8px',
                padding: '10px 14px',
                flex: '1 1 120px',
                minWidth: '100px',
              }}>
                <div style={{ color: '#888', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                  {stat.label}
                </div>
                <div style={{ color: stat.color, fontSize: '18px', fontWeight: 700 }}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>

          {/* Contradictions section */}
          {comparison.contradictions.length > 0 && (
            <div style={{ marginBottom: '28px' }}>
              <h3 style={{ color: '#ef5350', fontSize: '15px', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef5350', display: 'inline-block' }} />
                Contradictions
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {comparison.contradictions.map((c, i) => (
                  <div key={i} style={{
                    background: '#242424',
                    border: '1px solid #ef535055',
                    borderRadius: '8px',
                    padding: '16px',
                  }}>
                    <div style={{
                      color: '#ef5350',
                      fontSize: '12px',
                      fontWeight: 600,
                      marginBottom: '12px',
                      padding: '4px 8px',
                      background: '#ef535018',
                      borderRadius: '4px',
                      display: 'inline-block',
                    }}>
                      {c.reason}
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <NodeCard node={c.nodeA} borderColor="#ef535044" />
                      <NodeCard node={c.nodeB} borderColor="#ef535044" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Shared nodes section */}
          {comparison.shared.length > 0 && (
            <div style={{ marginBottom: '28px' }}>
              <h3 style={{ color: '#00ff9d', fontSize: '15px', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00ff9d', display: 'inline-block' }} />
                Shared Nodes ({comparison.shared.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {comparison.shared.map((pair, i) => (
                  <div key={i} style={{
                    background: '#242424',
                    border: '1px solid #00ff9d33',
                    borderRadius: '8px',
                    padding: '14px',
                  }}>
                    <div style={{
                      fontSize: '11px',
                      color: '#888',
                      marginBottom: '10px',
                      textAlign: 'right',
                    }}>
                      Similarity: <span style={{ color: pair.similarity > 0.85 ? '#00ff9d' : '#ffb74d', fontWeight: 600 }}>{Math.round(pair.similarity * 100)}%</span>
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <NodeCard node={pair.nodeA} borderColor="#00ff9d33" />
                      <NodeCard node={pair.nodeB} borderColor="#00ff9d33" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unique nodes — side by side */}
          {(comparison.uniqueToA.length > 0 || comparison.uniqueToB.length > 0) && (
            <div style={{ display: 'flex', gap: '20px', marginBottom: '28px' }}>
              {/* Unique to A */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ color: '#ffb74d', fontSize: '15px', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ffb74d', display: 'inline-block' }} />
                  Unique to {comparison.threadA.title} ({comparison.uniqueToA.length})
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {comparison.uniqueToA.length > 0 ? (
                    comparison.uniqueToA.map((node, i) => (
                      <NodeCard key={i} node={node} borderColor="#ffb74d33" />
                    ))
                  ) : (
                    <div style={{ color: '#666', fontSize: '13px', padding: '16px', textAlign: 'center' }}>
                      No unique nodes
                    </div>
                  )}
                </div>
              </div>

              {/* Unique to B */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ color: '#ce93d8', fontSize: '15px', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ce93d8', display: 'inline-block' }} />
                  Unique to {comparison.threadB.title} ({comparison.uniqueToB.length})
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {comparison.uniqueToB.length > 0 ? (
                    comparison.uniqueToB.map((node, i) => (
                      <NodeCard key={i} node={node} borderColor="#ce93d833" />
                    ))
                  ) : (
                    <div style={{ color: '#666', fontSize: '13px', padding: '16px', textAlign: 'center' }}>
                      No unique nodes
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Empty state */}
          {comparison.shared.length === 0 && comparison.contradictions.length === 0 &&
           comparison.uniqueToA.length === 0 && comparison.uniqueToB.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#888' }}>
              <div style={{ fontSize: '14px' }}>No nodes found to compare. Make sure both threads have nodes with embeddings.</div>
            </div>
          )}
        </div>
      )}

      {/* Initial empty state */}
      {!comparison && !loading && !error && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#666' }}>
          <div style={{ fontSize: '36px', marginBottom: '12px', opacity: 0.4 }}>&#8644;</div>
          <div style={{ fontSize: '15px', color: '#888', marginBottom: '8px' }}>Thread Comparison</div>
          <div style={{ fontSize: '13px', maxWidth: '400px', margin: '0 auto', lineHeight: '1.5' }}>
            Select two threads and compare them to find shared evidence, contradictions, and unique insights.
          </div>
        </div>
      )}
    </div>
  );
};

export default ThreadComparisonView;
