import React from 'react';
import './ViewTabBar.css';

const TABS = [
  { key: 'graph', label: 'Graph' },
  { key: 'article', label: 'Article' },
  { key: 'sequence', label: 'Sequence' },
  { key: 'canvas', label: 'Canvas' },
  { key: 'chat', label: 'Chat' },
];

const ViewTabBar = ({
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
