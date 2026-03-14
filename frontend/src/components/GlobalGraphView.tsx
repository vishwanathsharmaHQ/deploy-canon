import React, { useEffect, useState, useCallback } from 'react';
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  Background,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api } from '../services/api';
import type { GlobalGraphThread } from '../types';
import './GlobalGraphView.css';

interface ThreadNodeData {
  label: string;
  nodeCount: number;
  crossLinkCount: number;
  threadId: number;
}

function ThreadNode({ data }: { data: ThreadNodeData }) {
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

interface GlobalGraphViewProps {
  onSelectThread?: (threadId: number) => void;
}

const GlobalGraphView: React.FC<GlobalGraphViewProps> = ({ onSelectThread }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @xyflow/react generics require explicit any for initial state
  const [nodes, setNodes, onNodesChange] = useNodesState([] as any[]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as any[]);
  const [loading, setLoading] = useState(true);

  const loadGraph = useCallback(async () => {
    try {
      setLoading(true);
      const threads = await api.getGlobalGraphSummary();

      // Build nodes in a circle layout
      const rfNodes: { id: string; type: string; position: { x: number; y: number }; data: ThreadNodeData; draggable: boolean }[] = [];
      const centerX = 400, centerY = 300;
      const radius = 150 + threads.length * 15;

      threads.forEach((t: GlobalGraphThread, i: number) => {
        const angle = (2 * Math.PI * i) / Math.max(threads.length, 1) - Math.PI / 2;
        const titleWords = (t.title || '').split(/\s+/);
        const shortTitle = titleWords.length > 3 ? titleWords.slice(0, 3).join(' ') + '...' : t.title;
        rfNodes.push({
          id: `t-${t.id}`,
          type: 'threadNode',
          position: { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) },
          data: { label: shortTitle, nodeCount: t.nodeCount ?? 0, crossLinkCount: t.crossLinkCount ?? 0, threadId: t.id ?? 0 },
          draggable: true,
        });
      });

      // Build edges for cross-thread links
      const rfEdges: { id: string; source: string; target: string; style: Record<string, unknown>; animated: boolean }[] = [];
      const edgeSet = new Set<string>();
      threads.forEach((t: GlobalGraphThread) => {
        (t.linkedThreadIds || []).forEach((otherId) => {
          if (t.id == null || otherId == null) return;
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

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, rfNode: { data: ThreadNodeData }) => {
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
        <Background variant={BackgroundVariant.Dots} gap={40} size={1} color="rgba(255,255,255,0.05)" />
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
