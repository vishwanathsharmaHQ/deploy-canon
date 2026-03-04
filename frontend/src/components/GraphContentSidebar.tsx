import React, { useState } from 'react';
import { NODE_TYPES, NODE_TYPE_COLORS, EXPANDABLE_NODE_TYPES } from '../constants';
import type { Thread, NodeTypeName, ThreadType } from '../types';
import CrossThreadLinkPanel from './CrossThreadLinkPanel';

// Flexible type for selected node data — can be a thread or a knowledge node
interface SelectedNodeData {
  id: number;
  type: string | number;
  title?: string;
  content?: unknown;
  parent_id?: number | null;
  metadata?: Record<string, unknown>;
  originalData?: Record<string, unknown>;
  [key: string]: unknown;
}

interface GraphContentSidebarProps {
  selectedNode: SelectedNodeData | null;
  threads: Thread[];
  onClose: () => void;
  onNodeClick: (node: SelectedNodeData) => void;
  onOpenEditor?: (node: SelectedNodeData) => void;
  onOpenInArticle?: (nodeId: number) => void;
  onNavigateToThread?: (threadId: number) => void;
  formatContent: (content: unknown, nodeType: string) => React.ReactNode;
  threadType?: ThreadType;
  onReparentNode?: (nodeId: number, newParentId: number | null) => void;
  onReorderNode?: (nodeId: number, direction: 'earlier' | 'later') => void;
}

function getChildNodes(threads: Thread[], nodeId: string) {
  if (!threads.length) return [];
  const thread = threads[0];
  if (nodeId.startsWith('thread-')) {
    return (thread.nodes || []).filter(node => !node.parent_id);
  } else {
    const nodeIdNumber = parseInt(nodeId.replace('node-', ''));
    return (thread.nodes || []).filter(node => node.parent_id === nodeIdNumber);
  }
}

function getNodeTypeBadgeColor(type: string | number) {
  if (type === 'thread') return NODE_TYPE_COLORS.thread;
  return NODE_TYPE_COLORS[NODE_TYPES[type as number] as NodeTypeName] || '#666';
}

const GraphContentSidebar: React.FC<GraphContentSidebarProps> = ({
  selectedNode,
  threads,
  onClose,
  onNodeClick,
  onOpenEditor,
  onOpenInArticle,
  onNavigateToThread,
  formatContent,
  threadType,
  onReparentNode,
  onReorderNode,
}) => {
  const [showChangeParent, setShowChangeParent] = useState(false);

  if (!selectedNode) return null;

  const rfIdPrefix = selectedNode.type === 'thread' ? 'thread-' : 'node-';
  const children = getChildNodes(threads, `${rfIdPrefix}${selectedNode.id}`);

  return (
    <>
      <div className="content-sidebar-header">
        {selectedNode.type !== 'thread' && (
          <button
            className="back-button"
            onClick={() => {
              if (selectedNode.parent_id) {
                const parentNode = threads[0].nodes.find(n => n.id === selectedNode.parent_id);
                if (parentNode) { onNodeClick(parentNode as unknown as SelectedNodeData); return; }
              }
              const thread = threads[0];
              onNodeClick({
                ...thread,
                type: 'thread',
                metadata: {
                  ...thread.metadata,
                  title: thread.metadata?.title || thread.title || `Thread ${thread.id}`
                }
              });
            }}
            aria-label="Back to parent"
          >
            &larr;
          </button>
        )}
        <h2>
          {selectedNode.type === 'thread'
            ? (String((selectedNode.originalData?.metadata as Record<string, unknown>)?.title || selectedNode.originalData?.title || selectedNode.title || `Thread ${selectedNode.id}`))
            : (String(selectedNode.metadata?.title || selectedNode.title || `Node ${selectedNode.id}`))}
        </h2>
        <div className="header-actions">
          {selectedNode.type !== 'thread' && onOpenInArticle && (
            <button
              className="open-in-article-button"
              onClick={() => onOpenInArticle(selectedNode.id)}
              title="Read this node in Article view"
            >
              Read →
            </button>
          )}
          {(selectedNode.type === 'thread' || EXPANDABLE_NODE_TYPES.includes(NODE_TYPES[selectedNode.type as number] as NodeTypeName)) && (
            <button
              className="add-node-button"
              onClick={() => onOpenEditor && onOpenEditor(selectedNode)}
            >
              Add Node
            </button>
          )}
          <button className="content-sidebar-close" onClick={onClose}>&times;</button>
        </div>
      </div>
      <div className="content-sidebar-body">
        <div className="child-nodes-list">
          <h3>Connected Nodes</h3>
          {children.length > 0 ? (
            <div className="nodes-grid">
              {children.map((node) => (
                <div
                  key={node.id}
                  className="node-card"
                  onClick={() => onNodeClick(node as unknown as SelectedNodeData)}
                >
                  <div
                    className="node-card-type"
                    style={{ backgroundColor: NODE_TYPE_COLORS[NODE_TYPES[node.type] as NodeTypeName] }}
                  >
                    {NODE_TYPES[node.type]}
                  </div>
                  <div className="node-card-title">
                    {node.metadata?.title || `Node ${node.id}`}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="no-nodes-message">No nodes connected yet</p>
          )}
        </div>

        {/* Reorder controls for ROOT nodes in historical threads */}
        {selectedNode.type !== 'thread' &&
         NODE_TYPES[selectedNode.type as number] === 'ROOT' &&
         threadType === 'historical' &&
         onReorderNode && (
          <div className="reorder-controls">
            <button
              className="reorder-btn"
              onClick={() => onReorderNode(selectedNode.id as number, 'earlier')}
              title="Move earlier in timeline"
            >
              &larr; Earlier
            </button>
            <button
              className="reorder-btn"
              onClick={() => onReorderNode(selectedNode.id as number, 'later')}
              title="Move later in timeline"
            >
              Later &rarr;
            </button>
          </div>
        )}

        {/* Reparent controls for non-ROOT nodes */}
        {selectedNode.type !== 'thread' && onReparentNode && (
          <div className="reparent-controls">
            {!!selectedNode.parent_id && (
              <button
                className="detach-btn"
                onClick={() => {
                  onReparentNode(selectedNode.id as number, null);
                  setShowChangeParent(false);
                }}
              >
                Detach (make ROOT)
              </button>
            )}
            <button
              className="change-parent-btn"
              onClick={() => setShowChangeParent(v => !v)}
            >
              {showChangeParent ? 'Cancel' : 'Change Parent'}
            </button>
            {showChangeParent && (
              <div className="parent-list">
                {(threads[0]?.nodes || [])
                  .filter(n => {
                    const nt = n.node_type || NODE_TYPES[n.type];
                    return EXPANDABLE_NODE_TYPES.includes(nt as NodeTypeName) && n.id !== (selectedNode.id as number);
                  })
                  .map(n => (
                    <button
                      key={n.id}
                      className="parent-option"
                      onClick={() => {
                        onReparentNode(selectedNode.id as number, n.id);
                        setShowChangeParent(false);
                      }}
                    >
                      <span
                        className="parent-option-type"
                        style={{ backgroundColor: NODE_TYPE_COLORS[n.node_type as NodeTypeName] || '#666' }}
                      >
                        {n.node_type || NODE_TYPES[n.type]}
                      </span>
                      {n.title || `Node ${n.id}`}
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}

        <div className="content-sidebar-metadata">
          <div
            className="type-badge"
            style={{ backgroundColor: getNodeTypeBadgeColor(selectedNode.type) }}
          >
            {selectedNode.type === 'thread' ? 'THREAD' : NODE_TYPES[selectedNode.type as number]}
          </div>
        </div>

        <div className="content-sidebar-content">
          {formatContent(selectedNode.content, selectedNode.type === 'thread' ? 'thread' : NODE_TYPES[selectedNode.type as number])}
        </div>

        {selectedNode.type !== 'thread' && threads.length > 0 && (
          <CrossThreadLinkPanel
            nodeId={selectedNode.id}
            threadId={threads[0].id}
            onNavigateToThread={onNavigateToThread}
          />
        )}
      </div>
    </>
  );
};

export default GraphContentSidebar;
