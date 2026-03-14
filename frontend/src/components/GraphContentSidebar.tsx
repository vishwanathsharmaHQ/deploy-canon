import React, { useState } from 'react';
import { NODE_TYPES, NODE_TYPE_COLORS, ENTITY_TYPE_LABELS } from '../constants';
import type { Thread, NodeTypeName, ThreadType, Relationship } from '../types';
import CrossThreadLinkPanel from './CrossThreadLinkPanel';
import ReasoningValidator from './ReasoningValidator';
import PerspectivesPanel from './PerspectivesPanel';
import DevilsAdvocatePanel from './DevilsAdvocatePanel';
import WebEvidencePanel from './WebEvidencePanel';

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
  onHighlightNodes?: (nodeIds: number[]) => void;
  onStartDebate?: () => void;
  onRefresh?: () => void;
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

const REL_COLORS: Record<string, string> = {
  SUPPORTS: '#00ff9d', CONTRADICTS: '#ef5350', QUALIFIES: '#fdd835',
  DERIVES_FROM: '#4fc3f7', ILLUSTRATES: '#ab47bc', CITES: '#ffa726',
  ADDRESSES: '#66bb6a', REFERENCES: '#90a4ae',
};

function getNodeRelationships(threads: Thread[], nodeId: number): Relationship[] {
  const thread = threads[0];
  if (!thread?.relationships) return [];
  return thread.relationships.filter(r => r.source_id === nodeId || r.target_id === nodeId);
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
  onHighlightNodes,
  onStartDebate,
  onRefresh,
}) => {
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
          {selectedNode.type === 'thread' && onStartDebate && (
            <button
              className="add-node-button"
              onClick={onStartDebate}
              title="Debate a Clone - stress-test this thread's position"
            >
              Debate
            </button>
          )}
          <button
            className="add-node-button"
            onClick={() => onOpenEditor && onOpenEditor(selectedNode)}
          >
            Add Node
          </button>
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
                    {ENTITY_TYPE_LABELS[(NODE_TYPES[node.type] || '').toLowerCase()] || NODE_TYPES[node.type]}
                  </div>
                  <div className="node-card-title">
                    {node.title || node.metadata?.title || `Node ${node.id}`}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="no-nodes-message">No nodes connected yet</p>
          )}
        </div>

        {/* Typed relationships */}
        {selectedNode.type !== 'thread' && (() => {
          const rels = getNodeRelationships(threads, selectedNode.id);
          if (rels.length === 0) return null;
          const allNodes = threads[0]?.nodes || [];
          return (
            <div className="child-nodes-list" style={{ marginTop: 8 }}>
              <h3>Relationships</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {rels.map(rel => {
                  const isOutgoing = rel.source_id === selectedNode.id;
                  const otherId = isOutgoing ? rel.target_id : rel.source_id;
                  const otherNode = allNodes.find(n => n.id === otherId);
                  const color = REL_COLORS[rel.relation_type] || '#888';
                  return (
                    <div
                      key={rel.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '4px 8px', background: '#1a1a1a', borderRadius: 4,
                        borderLeft: `3px solid ${color}`, cursor: 'pointer',
                        fontSize: 12,
                      }}
                      onClick={() => {
                        if (otherNode) onNodeClick(otherNode as unknown as SelectedNodeData);
                      }}
                    >
                      <span style={{ color, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', minWidth: 70 }}>
                        {rel.relation_type.replace('_', ' ')}
                      </span>
                      <span style={{ color: '#999', fontSize: 11 }}>{isOutgoing ? '→' : '←'}</span>
                      <span style={{ color: '#ddd', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {otherNode?.title || `Node ${otherId}`}
                      </span>
                      {rel.properties?.strength != null && (
                        <span style={{ color: '#666', fontSize: 10 }}>str:{rel.properties.strength}</span>
                      )}
                      {rel.properties?.confidence != null && (
                        <span style={{ color: '#666', fontSize: 10 }}>conf:{rel.properties.confidence}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}


        {selectedNode.type === 'thread' && threads.length > 0 && (
          <ReasoningValidator
            threadId={threads[0].id}
            onHighlightNodes={onHighlightNodes}
          />
        )}

        {selectedNode.type === 'thread' && threads.length > 0 && (
          <DevilsAdvocatePanel
            threadId={threads[0].id}
            onAcceptChallenge={() => onRefresh?.()}
            onHighlightNode={(nodeId) => onHighlightNodes?.([nodeId])}
          />
        )}

        {selectedNode.type === 'thread' && threads.length > 0 && (
          <WebEvidencePanel
            threadId={threads[0].id}
            onAcceptEvidence={() => onRefresh?.()}
          />
        )}

        {selectedNode.type === 'thread' && threads.length > 0 && (
          <PerspectivesPanel
            threadId={threads[0].id}
            onSelectThread={onNavigateToThread}
          />
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
