import React from 'react';
import type { ViewName } from '../types';
import './ViewTabBar.css';

const TABS: { key: ViewName; label: string }[] = [
  { key: 'graph', label: 'Graph' },
  { key: 'global', label: 'Global' },
  { key: 'article', label: 'Article' },
  { key: 'sequence', label: 'Sequence' },
  { key: 'canvas', label: 'Canvas' },
  { key: 'chat', label: 'Chat' },
  { key: 'review', label: 'Review' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'ingest', label: 'Ingest' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'summary', label: 'Summary' },
  { key: 'compare', label: 'Compare' },
  { key: 'citations', label: 'Citations' },
  { key: 'dashboard', label: 'Dashboard' },
];

interface ViewTabBarProps {
  view: ViewName;
  onChangeView: (view: ViewName) => void;
  threadTitle: string;
  onPrevThread: () => void;
  onNextThread: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}

const ViewTabBar: React.FC<ViewTabBarProps> = ({
  view,
  onChangeView,
  threadTitle,
  onPrevThread,
  onNextThread,
  hasPrev,
  hasNext,
}) => (
  <div className="view-tab-bar">
    <div className="vtb-thread-nav">
      <button
        className="vtb-arrow"
        disabled={!hasPrev}
        onClick={onPrevThread}
        aria-label="Previous thread"
      >
        &#8249;
      </button>
      <span className="vtb-thread-title" title={threadTitle}>
        {threadTitle}
      </span>
      <button
        className="vtb-arrow"
        disabled={!hasNext}
        onClick={onNextThread}
        aria-label="Next thread"
      >
        &#8250;
      </button>
    </div>

    <div className="vtb-tabs">
      {TABS.map(({ key, label }) => (
        <button
          key={key}
          className={`vtb-tab ${view === key ? 'vtb-tab--active' : ''}`}
          onClick={() => onChangeView(key)}
        >
          {label}
        </button>
      ))}
    </div>
  </div>
);

export default ViewTabBar;
