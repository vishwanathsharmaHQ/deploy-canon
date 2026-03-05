import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { CitationNetwork, CitationSource } from '../types';

interface CitationNetworkViewProps {
  onSelectThread: (threadId: number) => void;
}

export default function CitationNetworkView({ onSelectThread }: CitationNetworkViewProps) {
  const [network, setNetwork] = useState<CitationNetwork | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);

  useEffect(() => {
    api.getCitationNetwork()
      .then(data => { setNetwork(data); setLoading(false); })
      .catch(err => { setError(err.message || 'Failed to load citation network'); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <div style={styles.spinner} />
          <p style={{ color: '#aaa', marginTop: 12 }}>Loading citation network...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.errorBox}>{error}</div>
      </div>
    );
  }

  if (!network) return null;

  const { sources, stats } = network;
  const maxRefCount = Math.max(1, ...sources.map(s => s.referenceCount));
  const spofSources = sources.filter(s => s.isSinglePointOfFailure);

  return (
    <div style={styles.container}>
      {/* Stats bar */}
      <div style={styles.statsBar}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{stats.totalSources}</div>
          <div style={styles.statLabel}>Total Sources</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{stats.avgReferencesPerSource}</div>
          <div style={styles.statLabel}>Avg References</div>
        </div>
        <div style={styles.statCard}>
          <div style={{
            ...styles.statValue,
            color: stats.singlePointOfFailureCount > 0 ? '#ff4444' : '#00ff9d',
          }}>
            {stats.singlePointOfFailureCount}
          </div>
          <div style={styles.statLabel}>Single Points of Failure</div>
        </div>
      </div>

      {/* SPOF Warning Section */}
      {spofSources.length > 0 && (
        <div style={styles.spofSection}>
          <h3 style={styles.spofTitle}>Single Points of Failure</h3>
          <p style={styles.spofDescription}>
            These sources are the sole evidence backing at least one thread.
            Removing them would leave arguments unsupported.
          </p>
          <div style={styles.sourceList}>
            {spofSources.map(source => (
              <SourceCard
                key={source.id}
                source={source}
                maxRefCount={maxRefCount}
                isExpanded={expandedSource === source.id}
                onToggle={() => setExpandedSource(expandedSource === source.id ? null : source.id)}
                onSelectThread={onSelectThread}
                highlighted
              />
            ))}
          </div>
        </div>
      )}

      {/* All Sources */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>All Sources ({sources.length})</h3>
        <div style={styles.sourceList}>
          {sources.length === 0 ? (
            <p style={{ color: '#888', padding: '20px 0' }}>
              No reference or evidence nodes found. Add REFERENCE or EVIDENCE nodes to your threads to see citation analysis.
            </p>
          ) : (
            sources.map(source => (
              <SourceCard
                key={source.id}
                source={source}
                maxRefCount={maxRefCount}
                isExpanded={expandedSource === source.id}
                onToggle={() => setExpandedSource(expandedSource === source.id ? null : source.id)}
                onSelectThread={onSelectThread}
                highlighted={false}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SourceCard({
  source,
  maxRefCount,
  isExpanded,
  onToggle,
  onSelectThread,
  highlighted,
}: {
  source: CitationSource;
  maxRefCount: number;
  isExpanded: boolean;
  onToggle: () => void;
  onSelectThread: (threadId: number) => void;
  highlighted: boolean;
}) {
  const barWidth = Math.max(4, (source.referenceCount / maxRefCount) * 100);

  return (
    <div
      style={{
        ...styles.sourceCard,
        borderColor: highlighted ? '#ff4444' : source.isSinglePointOfFailure ? '#ff444466' : '#333',
      }}
      onClick={onToggle}
    >
      <div style={styles.sourceHeader}>
        <div style={styles.sourceInfo}>
          <div style={styles.sourceTitleRow}>
            <span style={styles.sourceTitle}>{source.title}</span>
            {source.isSinglePointOfFailure && (
              <span style={styles.spofBadge}>SPOF</span>
            )}
          </div>
          {source.url && (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.sourceUrl}
              onClick={e => e.stopPropagation()}
            >
              {source.url.length > 80 ? source.url.substring(0, 80) + '...' : source.url}
            </a>
          )}
        </div>
        <div style={styles.sourceMeta}>
          <span style={styles.metaItem}>
            {source.referenceCount} ref{source.referenceCount !== 1 ? 's' : ''}
          </span>
          <span style={styles.metaDivider}>|</span>
          <span style={styles.metaItem}>
            {source.threadCount} thread{source.threadCount !== 1 ? 's' : ''}
          </span>
          <span style={styles.expandIcon}>{isExpanded ? '\u25B2' : '\u25BC'}</span>
        </div>
      </div>

      {/* Reference count bar */}
      <div style={styles.barContainer}>
        <div
          style={{
            ...styles.bar,
            width: `${barWidth}%`,
            backgroundColor: source.isSinglePointOfFailure ? '#ff4444' : '#00ff9d',
          }}
        />
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div style={styles.expandedContent}>
          <div style={styles.detailSection}>
            <div style={styles.detailLabel}>Threads:</div>
            {source.threads.map(t => (
              <button
                key={t.id}
                style={styles.threadLink}
                onClick={e => { e.stopPropagation(); onSelectThread(t.id); }}
              >
                {t.title}
              </button>
            ))}
          </div>
          <div style={styles.detailSection}>
            <div style={styles.detailLabel}>Nodes:</div>
            {source.nodes.map((n, i) => (
              <div key={`${n.id}-${i}`} style={styles.nodeItem}>
                <span style={styles.nodeTitle}>{n.title}</span>
                <span style={styles.nodeThread}>(Thread #{n.threadId})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    overflow: 'auto',
    padding: '20px',
    backgroundColor: '#1a1a1a',
    color: '#e0e0e0',
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '300px',
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid #333',
    borderTop: '3px solid #00ff9d',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  errorBox: {
    padding: '16px',
    background: '#2a2a2a',
    border: '1px solid #ff4444',
    borderRadius: '8px',
    color: '#ff4444',
  },
  statsBar: {
    display: 'flex',
    gap: '16px',
    marginBottom: '24px',
  },
  statCard: {
    flex: 1,
    padding: '16px',
    background: '#242424',
    border: '1px solid #333',
    borderRadius: '8px',
    textAlign: 'center' as const,
  },
  statValue: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#00ff9d',
    lineHeight: 1.2,
  },
  statLabel: {
    fontSize: '12px',
    color: '#888',
    marginTop: '4px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  spofSection: {
    marginBottom: '24px',
    padding: '16px',
    background: '#2a2a2a',
    border: '1px solid #ff444444',
    borderRadius: '8px',
  },
  spofTitle: {
    margin: '0 0 4px',
    fontSize: '16px',
    fontWeight: 600,
    color: '#ff4444',
  },
  spofDescription: {
    margin: '0 0 12px',
    fontSize: '13px',
    color: '#888',
    lineHeight: 1.4,
  },
  section: {
    marginBottom: '24px',
  },
  sectionTitle: {
    margin: '0 0 12px',
    fontSize: '16px',
    fontWeight: 600,
    color: '#e0e0e0',
  },
  sourceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  sourceCard: {
    padding: '12px 16px',
    background: '#242424',
    border: '1px solid #333',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'border-color 0.2s',
  },
  sourceHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
  },
  sourceInfo: {
    flex: 1,
    minWidth: 0,
  },
  sourceTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap' as const,
  },
  sourceTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e0e0e0',
    wordBreak: 'break-word' as const,
  },
  spofBadge: {
    display: 'inline-block',
    padding: '2px 6px',
    fontSize: '10px',
    fontWeight: 700,
    color: '#ff4444',
    background: '#ff444422',
    border: '1px solid #ff444444',
    borderRadius: '4px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  sourceUrl: {
    display: 'block',
    fontSize: '12px',
    color: '#00ff9d',
    textDecoration: 'none',
    marginTop: '4px',
    wordBreak: 'break-all' as const,
  },
  sourceMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
    fontSize: '12px',
    color: '#aaa',
    whiteSpace: 'nowrap' as const,
  },
  metaItem: {
    color: '#aaa',
  },
  metaDivider: {
    color: '#666',
  },
  expandIcon: {
    fontSize: '10px',
    color: '#666',
    marginLeft: '4px',
  },
  barContainer: {
    marginTop: '8px',
    height: '4px',
    background: '#333',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: '2px',
    transition: 'width 0.3s ease',
  },
  expandedContent: {
    marginTop: '12px',
    paddingTop: '12px',
    borderTop: '1px solid #333',
  },
  detailSection: {
    marginBottom: '10px',
  },
  detailLabel: {
    fontSize: '11px',
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '6px',
  },
  threadLink: {
    display: 'inline-block',
    margin: '2px 4px 2px 0',
    padding: '4px 10px',
    fontSize: '12px',
    color: '#00ff9d',
    background: '#00ff9d11',
    border: '1px solid #00ff9d33',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  nodeItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '3px 0',
    fontSize: '12px',
  },
  nodeTitle: {
    color: '#e0e0e0',
  },
  nodeThread: {
    color: '#666',
    fontSize: '11px',
  },
};
