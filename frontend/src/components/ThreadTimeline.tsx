import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import ConfidenceChart from './ConfidenceChart';
import SnapshotDiffViewer from './SnapshotDiffViewer';
import ExportPanel from './ExportPanel';
import { NODE_TYPE_COLORS, EVENT_ICONS, EVENT_COLORS } from '../constants';
import type { TimelineEvent, Snapshot, ConfidenceRecord, NodeTypeName } from '../types';
import './ThreadTimeline.css';

interface TimelineEventItem {
  type: string;
  title?: string;
  nodeType?: NodeTypeName;
  timestamp: string;
  version?: number | null;
  trigger?: string;
  score?: unknown;
  verdict?: string;
  nodeId?: number | null;
}

interface ThreadTimelineProps {
  threadId: number;
  threadTitle: string;
}

const ThreadTimeline: React.FC<ThreadTimelineProps> = ({ threadId, threadTitle }) => {
  const [events, setEvents] = useState<TimelineEventItem[]>([]);
  const [confidenceHistory, setConfidenceHistory] = useState<ConfidenceRecord[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [showDiff, setShowDiff] = useState<{ v1: number; v2: number } | null>(null);
  const [showExport, setShowExport] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [timelineData, confData, snapData] = await Promise.all([
        api.getTimeline(threadId),
        api.getConfidenceHistory(threadId),
        api.getSnapshots(threadId),
      ]);
      setEvents(timelineData as TimelineEventItem[]);
      setConfidenceHistory(confData);
      setSnapshots(snapData);
    } catch (err) {
      console.error('Timeline load error:', err);
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSnapshot = async () => {
    try {
      await api.createSnapshot(threadId, 'manual', 'User-initiated snapshot');
      await loadData();
    } catch (err) {
      console.error('Snapshot error:', err);
    }
  };

  const filteredEvents = filter === 'all' ? events : events.filter(e => e.type === filter);

  const formatDate = (ts: string): string => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) return <div className="thread-timeline"><div className="tt-loading">Loading timeline...</div></div>;

  return (
    <div className="thread-timeline">
      {confidenceHistory.length > 0 && (
        <ConfidenceChart data={confidenceHistory} />
      )}

      <div className="tt-controls">
        <div className="tt-filters">
          {['all', 'node_added', 'snapshot', 'confidence'].map(f => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="tt-actions">
          <button className="tt-snapshot-btn" onClick={handleSnapshot}>Take Snapshot</button>
          <button className="tt-export-btn" onClick={() => setShowExport(!showExport)}>Export</button>
        </div>
      </div>

      {showExport && <ExportPanel threadId={threadId} threadTitle={threadTitle} onClose={() => setShowExport(false)} />}

      {showDiff && (
        <SnapshotDiffViewer
          threadId={threadId}
          v1={showDiff.v1}
          v2={showDiff.v2}
          onClose={() => setShowDiff(null)}
        />
      )}

      {snapshots.length >= 2 && !showDiff && (
        <div className="tt-diff-select">
          <span>Compare snapshots:</span>
          <select onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            const [v1, v2] = e.target.value.split('-').map(Number);
            if (v1 && v2) setShowDiff({ v1, v2 });
          }}>
            <option value="">Select versions...</option>
            {snapshots.slice(0, -1).map((s, i) => (
              <option key={s.version} value={`${s.version}-${snapshots[i + 1]?.version}`}>
                v{snapshots[i + 1]?.version} &rarr; v{s.version}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="tt-events">
        {filteredEvents.map((event, i) => (
          <div key={i} className="tt-event">
            <div className="tt-event-line">
              <div className="tt-event-dot" style={{ background: EVENT_COLORS[event.type] || '#888' }}>
                {EVENT_ICONS[event.type] || '?'}
              </div>
            </div>
            <div className="tt-event-content">
              <div className="tt-event-header">
                <span className="tt-event-type">{event.type.replace('_', ' ')}</span>
                <span className="tt-event-time">{formatDate(event.timestamp)}</span>
              </div>
              <div className="tt-event-body">
                {event.type === 'thread_created' && <span>Thread created: {event.title}</span>}
                {event.type === 'node_added' && (
                  <span>
                    <span style={{ color: NODE_TYPE_COLORS[event.nodeType!] }}>[{event.nodeType}]</span> {event.title}
                  </span>
                )}
                {event.type === 'snapshot' && <span>Snapshot v{event.version} ({event.trigger})</span>}
                {event.type === 'confidence' && (
                  <span>
                    Score: <strong style={{ color: (Number(event.score) || 0) >= 70 ? '#00ff9d' : (Number(event.score) || 0) >= 40 ? '#fdd835' : '#ef5350' }}>{String(event.score)}</strong>
                    {event.verdict && <span className="tt-verdict"> &mdash; {event.verdict}</span>}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        {filteredEvents.length === 0 && <p className="tt-empty">No events to show.</p>}
      </div>
    </div>
  );
};

export default ThreadTimeline;
