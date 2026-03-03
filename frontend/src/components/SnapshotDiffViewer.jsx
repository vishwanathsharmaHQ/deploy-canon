import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { NODE_TYPE_COLORS } from '../constants';
import './SnapshotDiffViewer.css';

const SnapshotDiffViewer = ({ threadId, v1, v2, onClose }) => {
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getSnapshotDiff(threadId, v1, v2);
        setDiff(data);
      } catch (err) {
        console.error('Diff error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [threadId, v1, v2]);

  if (loading) return <div className="snapshot-diff-viewer"><p className="sdv-loading">Computing diff...</p></div>;
  if (!diff) return null;

  const truncateContent = (content) => {
    if (!content) return '';
    let text = content;
    try { const p = JSON.parse(text); text = p.description || p.point || p.explanation || text; } catch (e) {}
    return text.replace(/<[^>]+>/g, '').substring(0, 120);
  };

  return (
    <div className="snapshot-diff-viewer">
      <div className="sdv-header">
        <h4>Diff: v{v1} &rarr; v{v2}</h4>
        <span className="sdv-summary">
          {diff.v1NodeCount} &rarr; {diff.v2NodeCount} nodes
        </span>
        <button className="sdv-close" onClick={onClose}>&times;</button>
      </div>

      {diff.added?.length > 0 && (
        <div className="sdv-section sdv-added">
          <h5>Added ({diff.added.length})</h5>
          {diff.added.map(n => (
            <div key={n.id} className="sdv-node">
              <span className="sdv-type" style={{ color: NODE_TYPE_COLORS[n.node_type] }}>{n.node_type}</span>
              <span className="sdv-title">{n.title}</span>
            </div>
          ))}
        </div>
      )}

      {diff.removed?.length > 0 && (
        <div className="sdv-section sdv-removed">
          <h5>Removed ({diff.removed.length})</h5>
          {diff.removed.map(n => (
            <div key={n.id} className="sdv-node">
              <span className="sdv-type" style={{ color: NODE_TYPE_COLORS[n.node_type] }}>{n.node_type}</span>
              <span className="sdv-title">{n.title}</span>
            </div>
          ))}
        </div>
      )}

      {diff.modified?.length > 0 && (
        <div className="sdv-section sdv-modified">
          <h5>Modified ({diff.modified.length})</h5>
          {diff.modified.map(n => (
            <div key={n.id} className="sdv-node">
              <span className="sdv-type" style={{ color: NODE_TYPE_COLORS[n.node_type] }}>{n.node_type}</span>
              <span className="sdv-title">{n.title}</span>
              <span className="sdv-content">{truncateContent(n.content)}</span>
            </div>
          ))}
        </div>
      )}

      {!diff.added?.length && !diff.removed?.length && !diff.modified?.length && (
        <p className="sdv-no-changes">No changes between these versions.</p>
      )}
    </div>
  );
};

export default SnapshotDiffViewer;
