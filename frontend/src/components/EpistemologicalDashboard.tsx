import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { NODE_TYPE_COLORS } from '../constants';
import type { DashboardStats } from '../types';

interface Props {
  onSelectThread: (threadId: number) => void;
}

const EpistemologicalDashboard: React.FC<Props> = ({ onSelectThread }) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getDashboardStats()
      .then(data => { if (!cancelled) setStats(data); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load dashboard'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <p style={{ color: '#888', marginTop: 16 }}>Loading dashboard stats...</p>
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingContainer}>
          <p style={{ color: '#ff6b6b' }}>{error || 'No data available'}</p>
        </div>
      </div>
    );
  }

  const maxTypeCount = Math.max(...Object.values(stats.nodeTypeDistribution), 1);

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>Epistemological Dashboard</h2>

      {/* Summary Cards */}
      <div style={styles.cardsRow}>
        <div style={styles.card}>
          <div style={styles.cardValue}>{stats.totalThreads}</div>
          <div style={styles.cardLabel}>Total Threads</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardValue}>{stats.totalNodes}</div>
          <div style={styles.cardLabel}>Total Nodes</div>
        </div>
        <div style={styles.card}>
          <div style={{ ...styles.cardValue, color: stats.averageConfidence != null && stats.averageConfidence >= 70 ? '#00ff9d' : '#ff9f43' }}>
            {stats.averageConfidence != null ? `${stats.averageConfidence}%` : 'N/A'}
          </div>
          <div style={styles.cardLabel}>Avg Confidence</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardValue}>{stats.totalEvidence}</div>
          <div style={styles.cardLabel}>Evidence Nodes</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardValue}>{stats.totalCounterpoints}</div>
          <div style={styles.cardLabel}>Counterpoints</div>
        </div>
      </div>

      <div style={styles.columnsRow}>
        {/* Left column */}
        <div style={styles.column}>
          {/* Node Type Distribution */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Node Type Distribution</h3>
            {Object.keys(stats.nodeTypeDistribution).length === 0 ? (
              <p style={styles.emptyText}>No nodes yet</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(stats.nodeTypeDistribution).map(([type, count]) => (
                  <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 100, fontSize: 12, color: NODE_TYPE_COLORS[type] || '#888', fontWeight: 600, textAlign: 'right', flexShrink: 0 }}>
                      {type}
                    </div>
                    <div style={{ flex: 1, background: '#1e1e1e', borderRadius: 4, height: 22, overflow: 'hidden' }}>
                      <div style={{
                        width: `${(count / maxTypeCount) * 100}%`,
                        height: '100%',
                        background: NODE_TYPE_COLORS[type] || '#555',
                        opacity: 0.7,
                        borderRadius: 4,
                        minWidth: 2,
                        transition: 'width 0.4s ease',
                      }} />
                    </div>
                    <div style={{ width: 36, fontSize: 12, color: '#aaa', textAlign: 'right', flexShrink: 0 }}>
                      {count}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Low Confidence Threads */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Threads Needing Attention</h3>
            {stats.lowConfidenceThreads.length === 0 ? (
              <p style={styles.emptyText}>No confidence records yet</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stats.lowConfidenceThreads.map(thread => (
                  <div
                    key={thread.id}
                    onClick={() => onSelectThread(thread.id)}
                    style={styles.listItem}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#00ff9d'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#333'; }}
                  >
                    <div style={{ flex: 1, fontSize: 13, color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {thread.title || `Thread ${thread.id}`}
                    </div>
                    <div style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: thread.confidence < 40 ? '#ff6b6b' : thread.confidence < 70 ? '#ff9f43' : '#00ff9d',
                      flexShrink: 0,
                    }}>
                      {thread.confidence}%
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div style={styles.column}>
          {/* Recent Activity */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Recent Activity</h3>
            {stats.recentNodes.length === 0 ? (
              <p style={styles.emptyText}>No recent activity</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {stats.recentNodes.map((node, i) => (
                  <div
                    key={node.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '10px 0',
                      borderBottom: i < stats.recentNodes.length - 1 ? '1px solid #333' : 'none',
                    }}
                  >
                    <div style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: NODE_TYPE_COLORS[node.nodeType] || '#555',
                      marginTop: 5,
                      flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {node.title}
                      </div>
                      <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                        <span style={{ color: NODE_TYPE_COLORS[node.nodeType] || '#888', fontWeight: 600 }}>{node.nodeType}</span>
                        {' in '}
                        <span
                          style={{ color: '#4ecdc4', cursor: 'pointer' }}
                          onClick={() => onSelectThread(node.threadId)}
                        >
                          {node.threadTitle || `Thread ${node.threadId}`}
                        </span>
                      </div>
                      {node.created_at && (
                        <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>
                          {formatTimeAgo(node.created_at)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function formatTimeAgo(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return dateStr;
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    overflow: 'auto',
    padding: '24px 32px',
    background: '#1a1a1a',
    color: '#e0e0e0',
    minHeight: 0,
  },
  heading: {
    fontSize: 22,
    fontWeight: 700,
    color: '#e0e0e0',
    marginBottom: 24,
    letterSpacing: '0.5px',
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minHeight: 300,
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid #333',
    borderTopColor: '#00ff9d',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  cardsRow: {
    display: 'flex',
    gap: 16,
    marginBottom: 28,
    flexWrap: 'wrap' as const,
  },
  card: {
    flex: '1 1 140px',
    background: '#2a2a2a',
    borderRadius: 10,
    padding: '20px 16px',
    textAlign: 'center' as const,
    border: '1px solid #333',
  },
  cardValue: {
    fontSize: 28,
    fontWeight: 700,
    color: '#00ff9d',
    marginBottom: 6,
  },
  cardLabel: {
    fontSize: 12,
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  columnsRow: {
    display: 'flex',
    gap: 24,
    flexWrap: 'wrap' as const,
  },
  column: {
    flex: '1 1 340px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 20,
    minWidth: 0,
  },
  section: {
    background: '#2a2a2a',
    borderRadius: 10,
    padding: '20px',
    border: '1px solid #333',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#aaa',
    marginBottom: 16,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  emptyText: {
    color: '#555',
    fontSize: 13,
    fontStyle: 'italic',
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    background: '#1e1e1e',
    borderRadius: 6,
    border: '1px solid #333',
    cursor: 'pointer',
    transition: 'border-color 0.2s',
  },
};

export default EpistemologicalDashboard;
