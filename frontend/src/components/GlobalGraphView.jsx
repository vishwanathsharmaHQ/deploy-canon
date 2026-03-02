import React, { useEffect, useState, useCallback } from 'react';
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  Background,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api } from '../services/api';
import './GlobalGraphView.css';

function ThreadNode({ data }) {
  const size = 30 + Math.min(data.nodeCount || 0, 20) * 2;
  return (
    <div className="gg-thread-node" style={{ width: size, height: size }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div className="gg-thread-circle" style={{
        width: size, height: size,
        background: data.crossLinkCount > 0 ? '#00ff9d' : '#4a4a6a',
        opacity: data.crossLinkCount > 0 ? 1 : 0.6,
      }} />
      <div className="gg-thread-label">{data.label}</div>
      {data.nodeCount > 0 && <div className="gg-thread-count">{data.nodeCount}</div>}
    </div>
  );
}

const nodeTypes = { threadNode: ThreadNode };

const GlobalGraphView = ({ onSelectThread }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);

  const loadGraph = useCallback(async () => {
    try {
      setLoading(true);
      const threads = await api.getGlobalGraphSummary();

      // Build nodes in a circle layout
      const rfNodes = [];
      const centerX = 400, centerY = 300;
      const radius = 150 + threads.length * 15;

      threads.forEach((t, i) => {
        const angle = (2 * Math.PI * i) / Math.max(threads.length, 1) - Math.PI / 2;
        const titleWords = (t.title || '').split(/\s+/);
        const shortTitle = titleWords.length > 3 ? titleWords.slice(0, 3).join(' ') + '...' : t.title;
        rfNodes.push({
          id: `t-${t.id}`,
          type: 'threadNode',
          position: { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) },
          data: { label: shortTitle, nodeCount: t.nodeCount, crossLinkCount: t.crossLinkCount, threadId: t.id },
          draggable: true,
        });
      });

      // Build edges for cross-thread links
      const rfEdges = [];
      const edgeSet = new Set();
      threads.forEach(t => {
        (t.linkedThreadIds || []).forEach(otherId => {
          const key = [Math.min(t.id, otherId), Math.max(t.id, otherId)].join('-');
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            rfEdges.push({
              id: `e-${key}`,
              source: `t-${t.id}`,
              target: `t-${otherId}`,
              style: { stroke: '#00ff9d44', strokeWidth: 2, strokeDasharray: '5,5' },
              animated: true,
            });
          }
        });
      });

      setNodes(rfNodes);
      setEdges(rfEdges);
    } catch (err) {
      console.error('Global graph error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  const onNodeDoubleClick = useCallback((_, rfNode) => {
    onSelectThread?.(rfNode.data.threadId);
  }, [onSelectThread]);

  return (
    <div className="global-graph-view">
      {loading && <div className="gg-loading">Loading global graph...</div>}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDoubleClick={onNodeDoubleClick}
        nodeTypes={nodeTypes}
        minZoom={0.2}
        maxZoom={2}
        fitView
        proOptions={{ hideAttribution: true }}
        style={{ background: '#1d1d1d' }}
      >
        <Background variant="dots" gap={40} size={1} color="rgba(255,255,255,0.05)" />
      </ReactFlow>
      <div className="gg-legend">
        <span className="gg-legend-item"><span className="gg-dot" style={{ background: '#00ff9d' }} /> Connected</span>
        <span className="gg-legend-item"><span className="gg-dot" style={{ background: '#4a4a6a' }} /> Isolated</span>
        <span className="gg-legend-item">Double-click to open</span>
      </div>
    </div>
  );
};

export default GlobalGraphView;
