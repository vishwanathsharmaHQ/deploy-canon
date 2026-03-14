import React from 'react';
import { NODE_TYPE_COLORS } from '../constants';
import { getNodeType, formatNodeContent, renderContent } from '../utils/articleContent';
import SourceVerifyBadge from './SourceVerifyBadge';
import type { ThreadNode, NodeTypeName } from '../types';

interface SecondaryNodePanelProps {
  nodes: ThreadNode[];
  selectedId: number | string | null;
  onSelect: (id: number | string) => void;
  onOpenNode?: (node: ThreadNode) => void;
  label?: string;
  onAccept?: () => void;
  onDiscard?: () => void;
  onClose?: () => void;
}

const SecondaryNodePanel: React.FC<SecondaryNodePanelProps> = ({ nodes, selectedId, onSelect, onOpenNode, label, onAccept, onDiscard, onClose }) => {
  if (!nodes || nodes.length === 0) {
    return (
      <div className="ar-snp">
        <div className="ar-snp-header">
          <span className="ar-snp-label">{label || 'Supporting Nodes'}</span>
          {onClose && <button className="ar-snp-close" onClick={onClose}>&times;</button>}
        </div>
        <div className="ar-snp-empty">
          <p>No supporting nodes for this page.</p>
        </div>
      </div>
    );
  }

  const selectedNode = nodes.find(n => n.id === selectedId) || nodes[0];
  const selectedType = getNodeType(selectedNode);
  const selectedColor = NODE_TYPE_COLORS[selectedType as NodeTypeName] || '#888';

  return (
    <div className="ar-snp">
      <div className="ar-snp-header">
        <span className="ar-snp-label" style={label?.startsWith('←') ? { cursor: 'pointer' } : undefined} onClick={label?.startsWith('←') ? onClose : undefined}>
          {label || 'Supporting Nodes'} <span className="ar-snp-count">{nodes.length}</span>
        </span>
        {onClose && <button className="ar-snp-close" onClick={onClose} title={label?.startsWith('←') ? 'Go back' : 'Close'}>{label?.startsWith('←') ? '←' : '×'}</button>}
      </div>

      <div className="ar-snp-tabs">
        {nodes.map((node) => {
          const nodeType = getNodeType(node);
          const color = NODE_TYPE_COLORS[nodeType as NodeTypeName] || '#888';
          const isActive = node.id === selectedId;
          return (
            <button
              key={node.id}
              className={`ar-snp-tab${isActive ? ' ar-snp-tab--active' : ''}`}
              onClick={() => onSelect(node.id)}
              onDoubleClick={() => onOpenNode?.(node)}
              style={isActive ? { borderColor: color } : {}}
              title="Double-click to open in full view"
            >
              <span
                className="ar-snp-tab-badge ar-node-badge"
                style={{ color, borderColor: color }}
              >
                {nodeType}
              </span>
              <span className="ar-snp-tab-title">{node.title || `Node ${node.id}`}</span>
            </button>
          );
        })}
      </div>

      {selectedNode && (
        <div className="ar-snp-content" onDoubleClick={() => onOpenNode?.(selectedNode)} style={{ cursor: onOpenNode ? 'pointer' : undefined }}>
          <div
            className="ar-node-badge"
            style={{ color: selectedColor, borderColor: selectedColor }}
          >
            {selectedType}
          </div>
          <h2 className="ar-snp-article-title">
            {selectedNode.title || `Node ${selectedNode.id}`}
          </h2>
          <hr className="ar-divider" />
          <div className="ar-content">
            {(() => {
              const rendered = formatNodeContent(selectedNode, SourceVerifyBadge);
              return React.isValidElement(rendered) ? rendered : renderContent(rendered);
            })()}
          </div>
        </div>
      )}

      {(onAccept || onDiscard) && (
        <div className="ar-snp-proposal-footer">
          <span className="ar-snp-proposal-hint">Review before saving</span>
          <div className="ar-snp-proposal-actions">
            {onDiscard && (
              <button className="ar-snp-discard" onClick={onDiscard}>✗ Discard</button>
            )}
            {onAccept && (
              <button className="ar-snp-accept" onClick={onAccept}>✓ Accept All</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SecondaryNodePanel;
