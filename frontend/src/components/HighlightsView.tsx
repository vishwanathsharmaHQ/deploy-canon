import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { Thread } from '../types';
import './HighlightsView.css';

interface HighlightsViewProps {
  threads: Thread[];
  onNavigate: (threadId: number, nodeId: number) => void;
}

interface HighlightEntry {
  threadId: number;
  threadTitle: string;
  nodeId: number;
  nodeTitle: string;
  text: string;
}

const HighlightsView: React.FC<HighlightsViewProps> = ({ threads, onNavigate }) => {
  const [entries, setEntries] = useState<HighlightEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAllHighlights();
  }, [threads]);

  const loadAllHighlights = async () => {
    setLoading(true);
    const all: HighlightEntry[] = [];

    for (const thread of threads) {
      try {
        const highlights = await api.loadHighlights(thread.id);
        if (!highlights || Object.keys(highlights).length === 0) continue;

        const threadTitle = thread.title || thread.metadata?.title || `Thread ${thread.id}`;
        const nodeMap = new Map((thread.nodes || []).map(n => [n.id, n]));

        for (const [nodeIdStr, texts] of Object.entries(highlights)) {
          const nodeId = Number(nodeIdStr);
          const node = nodeMap.get(nodeId);
          const nodeTitle = node?.title || `Node ${nodeId}`;
          for (const text of texts) {
            all.push({ threadId: thread.id, threadTitle: threadTitle as string, nodeId, nodeTitle, text });
          }
        }
      } catch {
        // skip thread
      }
    }

    setEntries(all);
    setLoading(false);
  };

  // Group by thread
  const grouped = entries.reduce<Record<number, { title: string; items: HighlightEntry[] }>>((acc, e) => {
    if (!acc[e.threadId]) acc[e.threadId] = { title: e.threadTitle, items: [] };
    acc[e.threadId].items.push(e);
    return acc;
  }, {});

  return (
    <div className="hl-view">
      <div className="hl-header">
        <h2 className="hl-title">Highlights</h2>
        <span className="hl-count">{entries.length} highlight{entries.length !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <div className="hl-loading">Loading highlights...</div>
      ) : entries.length === 0 ? (
        <div className="hl-empty">
          <p>No highlights yet.</p>
          <p className="hl-empty-hint">Select text in an article and click "Highlight" to save key passages.</p>
        </div>
      ) : (
        <div className="hl-list">
          {Object.entries(grouped).map(([threadId, { title, items }]) => (
            <div key={threadId} className="hl-thread-group">
              <h3 className="hl-thread-title">{title}</h3>
              {items.map((item, i) => (
                <button
                  key={i}
                  className="hl-card"
                  onClick={() => onNavigate(item.threadId, item.nodeId)}
                >
                  <span className="hl-card-node">{item.nodeTitle}</span>
                  <p className="hl-card-text">{item.text}</p>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default HighlightsView;
