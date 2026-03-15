import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  Background,
  BackgroundVariant,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './ThreadGraph.css';
import { api } from '../services/api';
import { NODE_TYPES, NODE_TYPE_COLORS, ENTITY_TYPE_LABELS } from '../constants';
import { formatContent } from '../utils/graphContent';
import type { Thread, ThreadNode, NodeTypeName, LayoutData, DecayDataPoint, ThreadType } from '../types';
import GraphContentSidebar from './GraphContentSidebar';
import DebateMode from './DebateMode';

interface GraphNodeData {
  label: string;
  isThread: boolean;
  isRoot?: boolean;
  parentRfId?: string | null;
  nodeColor: string;
  isMatteMode: boolean;
  decayPercent?: number | null;
  confidenceScore?: number | null;
  showHeatmap?: boolean;
  highlighted?: boolean;
  crossLinkCount?: number;
  originalData: Record<string, unknown>;
}

interface RFNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: GraphNodeData;
  draggable: boolean;
  hidden?: boolean;
}

interface RFEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  style: Record<string, unknown>;
  animated?: boolean;
  hidden?: boolean;
  label?: string;
  labelStyle?: Record<string, unknown>;
  labelBgStyle?: Record<string, unknown>;
  labelBgPadding?: [number, number];
  data?: Record<string, unknown>;
}

// Relationship type colors and short labels for graph edges
const REL_TYPE_COLORS: Record<string, string> = {
  SUPPORTS: 'rgba(0, 255, 157, 0.6)',
  CONTRADICTS: 'rgba(239, 83, 80, 0.7)',
  QUALIFIES: 'rgba(253, 216, 53, 0.6)',
  DERIVES_FROM: 'rgba(79, 195, 247, 0.6)',
  ILLUSTRATES: 'rgba(0, 255, 157, 0.6)',
  CITES: 'rgba(255, 167, 38, 0.6)',
  ADDRESSES: 'rgba(102, 187, 106, 0.6)',
  REFERENCES: 'rgba(144, 164, 174, 0.5)',
};

const REL_TYPE_LABELS: Record<string, string> = {
  SUPPORTS: 'supports',
  CONTRADICTS: 'contradicts',
  QUALIFIES: 'qualifies',
  DERIVES_FROM: 'derives',
  ILLUSTRATES: 'illustrates',
  CITES: 'cites',
  ADDRESSES: 'addresses',
  REFERENCES: 'refs',
};

function confidenceColor(score: number): string {
  if (score >= 70) return '#66bb6a';
  if (score >= 45) return '#fdd835';
  return '#ef5350';
}

// Custom node component with decay and confidence visualization
function GraphNode({ data }: { data: GraphNodeData }) {
  const isThread = data.isThread;
  const radius = isThread ? 25 : 15;
  const matteClass = data.isMatteMode ? 'matte' : '';
  const decay: number | null = data.decayPercent ?? null;
  const confidence: number | null = data.confidenceScore ?? null;
  const showHeatmap = data.showHeatmap ?? false;
  const highlighted = data.highlighted ?? false;
  const hasLinks = (data.crossLinkCount ?? 0) > 0;

  // In heatmap mode, override the node fill color based on confidence
  const baseColor = data.nodeColor || '#666';
  const fillColor = showHeatmap && confidence != null ? confidenceColor(confidence) : baseColor;

  // Decay: reduce opacity, add colored ring
  const decayOpacity = decay != null ? Math.max(0.3, 1 - (decay / 150)) : 1;
  const ringColor = decay == null ? 'transparent' : decay > 80 ? '#ef5350' : decay > 40 ? '#fdd835' : '#00ff9d';

  return (
    <div
      className={`graph-node ${matteClass} ${isThread ? 'thread-node' : ''}`}
      style={{ position: 'relative', width: radius * 2, height: radius * 2, opacity: decayOpacity }}
    >
      <Handle type="target" position={Position.Top} id="t-top" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Bottom} id="t-bottom" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Left} id="t-left" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Right} id="t-right" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Top} id="s-top" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Bottom} id="s-bottom" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Left} id="s-left" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Right} id="s-right" style={{ opacity: 0, pointerEvents: 'none' }} />
      {decay != null && (
        <div style={{
          position: 'absolute', top: -3, left: -3, width: radius * 2 + 6, height: radius * 2 + 6,
          borderRadius: '50%', border: `2px solid ${ringColor}`, pointerEvents: 'none',
        }} />
      )}
      {showHeatmap && confidence != null && (
        <div style={{
          position: 'absolute', top: -5, left: -5, width: radius * 2 + 10, height: radius * 2 + 10,
          borderRadius: '50%', border: `3px solid ${confidenceColor(confidence)}`,
          boxShadow: `0 0 8px ${confidenceColor(confidence)}40`,
          pointerEvents: 'none',
        }} />
      )}
      {highlighted && (
        <div
          className="highlight-pulse"
          style={{
            position: 'absolute', top: -7, left: -7, width: radius * 2 + 14, height: radius * 2 + 14,
            borderRadius: '50%', border: '2px solid #ff6b6b',
            boxShadow: '0 0 12px rgba(255, 107, 107, 0.6)',
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        className="graph-node-circle"
        style={{
          width: radius * 2,
          height: radius * 2,
          borderRadius: '50%',
          background: fillColor,
          border: '2px solid #fff',
          cursor: 'pointer',
        }}
      />
      {hasLinks && (
        <div style={{
          position: 'absolute', top: -6, right: -6, width: 12, height: 12,
          borderRadius: '50%', background: '#555', border: '1px solid #1d1d1d',
          fontSize: '7px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          L
        </div>
      )}
      {showHeatmap && confidence != null && (
        <div style={{
          position: 'absolute', bottom: -14, left: '50%', transform: 'translateX(-50%)',
          fontSize: '9px', color: confidenceColor(confidence), fontWeight: 600,
          textShadow: '0 0 3px #000',
          whiteSpace: 'nowrap',
        }}>
          {confidence}
        </div>
      )}
      <div className="graph-node-label">
        {data.label}
      </div>
    </div>
  );
}

const nodeTypes = { graphNode: GraphNode };

// ── Layout algorithms for thread types ──────────────────────────────────────

import dagre from '@dagrejs/dagre';

interface LayoutNode {
  id: number;
  node_type: string;
  parent_id: number | null;
  created_at: string;
  metadata?: Record<string, unknown>;
}

type PositionMap = Record<string, { x: number; y: number }>;

function sortRootsChronologically(roots: LayoutNode[]): LayoutNode[] {
  return [...roots].sort((a, b) => {
    const aOrder = a.metadata?.chronological_order as number | undefined;
    const bOrder = b.metadata?.chronological_order as number | undefined;
    if (aOrder != null && bOrder != null) return aOrder - bOrder;
    if (aOrder != null) return -1;
    if (bOrder != null) return 1;
    return a.created_at.localeCompare(b.created_at);
  });
}

function getHistoricalLayout(nodes: LayoutNode[], yOffset: number, relationships?: RelInfo[]): PositionMap {
  const positions: PositionMap = {};

  // Build relationship parent map to identify child claims (created by enrich)
  const relParent: Record<number, number> = {};
  for (const rel of (relationships || [])) {
    if (!relParent[rel.source_id]) relParent[rel.source_id] = rel.target_id;
  }

  // Only treat claims as roots if they don't have a relationship parent
  const isClaim = (n: LayoutNode) => n.node_type === 'CLAIM' || n.node_type === 'claim';
  const isRoot = (n: LayoutNode) => isClaim(n) && !n.parent_id && !relParent[n.id];
  const roots = sortRootsChronologically(nodes.filter(isRoot));
  const nonRoots = nodes.filter(n => !isRoot(n));

  // Thread node at far left
  positions['thread'] = { x: 50, y: 300 + yOffset };

  // ROOT nodes left-to-right
  roots.forEach((root, i) => {
    positions[`node-${root.id}`] = { x: 200 + i * 250, y: 300 + yOffset };
  });

  // Children stacked below their parent (using parent_id OR relationship)
  const childrenByParent: Record<number, LayoutNode[]> = {};
  nonRoots.forEach(n => {
    const pid = n.parent_id || relParent[n.id] || 0;
    if (!childrenByParent[pid]) childrenByParent[pid] = [];
    childrenByParent[pid].push(n);
  });

  for (const [parentId, children] of Object.entries(childrenByParent)) {
    const parentPos = positions[`node-${parentId}`];
    if (!parentPos) {
      // Orphan non-roots — place after last root
      children.forEach((child, ci) => {
        positions[`node-${child.id}`] = { x: 200 + roots.length * 250 + ci * 120, y: 450 + yOffset };
      });
      continue;
    }
    children.forEach((child, ci) => {
      positions[`node-${child.id}`] = { x: parentPos.x + (ci - (children.length - 1) / 2) * 120, y: parentPos.y + 150 };
    });
  }

  return positions;
}

interface RelInfo { source_id: number; target_id: number; }

function getDefaultLayout(nodes: LayoutNode[], relationships: RelInfo[], yOffset: number): PositionMap {
  const positions: PositionMap = {};
  if (!nodes.length) return positions;

  // Build parent map: for each node, find its parent via parent_id or typed relationship
  // In relationships, source→target means source SUPPORTS/etc target, so source is the child
  const relParent: Record<number, number> = {};
  for (const rel of relationships) {
    // source is child, target is parent (e.g., evidence SUPPORTS claim)
    if (!relParent[rel.source_id]) relParent[rel.source_id] = rel.target_id;
  }

  const parentOf = (n: LayoutNode): number | null => {
    if (n.parent_id) return n.parent_id;
    return relParent[n.id] ?? null;
  };

  const roots = nodes.filter(n => {
    const nt = (n.node_type || '').toLowerCase();
    return nt === 'claim' && !parentOf(n);
  });
  const nonRoots = nodes.filter(n => !roots.some(r => r.id === n.id));

  // Thread node
  positions['thread'] = { x: 50, y: 300 + yOffset };

  // Claims in a row
  const claimSpacing = 300;
  roots.forEach((root, i) => {
    positions[`node-${root.id}`] = { x: 250 + i * claimSpacing, y: 300 + yOffset };
  });

  // Group non-roots by their parent
  const childrenByParent: Record<number, LayoutNode[]> = {};
  const orphans: LayoutNode[] = [];
  nonRoots.forEach(n => {
    const pid = parentOf(n);
    if (pid != null && positions[`node-${pid}`]) {
      if (!childrenByParent[pid]) childrenByParent[pid] = [];
      childrenByParent[pid].push(n);
    } else if (pid != null) {
      // Parent exists but isn't a root — might be a secondary's child
      if (!childrenByParent[pid]) childrenByParent[pid] = [];
      childrenByParent[pid].push(n);
    } else {
      orphans.push(n);
    }
  });

  // Position children fanned below their parent
  for (const [pidStr, children] of Object.entries(childrenByParent)) {
    const pid = Number(pidStr);
    const parentPos = positions[`node-${pid}`];
    if (parentPos) {
      children.forEach((child, ci) => {
        const offsetX = (ci - (children.length - 1) / 2) * 140;
        positions[`node-${child.id}`] = { x: parentPos.x + offsetX, y: parentPos.y + 160 };
      });
    }
  }

  // Second pass: position children of secondary nodes (depth 2+)
  for (const [pidStr, children] of Object.entries(childrenByParent)) {
    const pid = Number(pidStr);
    if (!positions[`node-${pid}`]) {
      // Find the grandparent position
      const gpId = parentOf({ id: pid, node_type: '', parent_id: null, created_at: '' });
      const gpPos = gpId ? positions[`node-${gpId}`] : null;
      if (gpPos) {
        positions[`node-${pid}`] = positions[`node-${pid}`] || { x: gpPos.x, y: gpPos.y + 160 };
      }
      children.forEach((child, ci) => {
        const pPos = positions[`node-${pid}`] || { x: 400, y: 500 + yOffset };
        positions[`node-${child.id}`] = { x: pPos.x + (ci - (children.length - 1) / 2) * 120, y: pPos.y + 150 };
      });
    }
  }

  // Orphans in a row at the bottom
  orphans.forEach((n, i) => {
    positions[`node-${n.id}`] = { x: 200 + i * 140, y: 550 + yOffset };
  });

  return positions;
}

function getDebateLayout(nodes: LayoutNode[], yOffset: number): PositionMap {
  const positions: PositionMap = {};
  const roots = nodes.filter(n => n.node_type === 'CLAIM' || n.node_type === 'claim');
  const evidence = nodes.filter(n => n.node_type === 'EVIDENCE' || n.node_type === 'EXAMPLE' || n.node_type === 'CONTEXT');
  const counterpoints = nodes.filter(n => n.node_type === 'COUNTERPOINT');
  const synthesis = nodes.filter(n => n.node_type === 'SYNTHESIS');
  const references = nodes.filter(n => n.node_type === 'SOURCE' || n.node_type === 'source');

  // Thread node top-left
  positions['thread'] = { x: 100, y: 100 + yOffset };

  // First ROOT = central claim top-center
  if (roots.length > 0) {
    positions[`node-${roots[0].id}`] = { x: 400, y: 150 + yOffset };
    // Additional roots below
    roots.slice(1).forEach((r, i) => {
      positions[`node-${r.id}`] = { x: 400, y: 300 + i * 120 + yOffset };
    });
  }

  // Evidence/examples fanned left
  evidence.forEach((n, i) => {
    positions[`node-${n.id}`] = { x: 100 + (i % 2) * 120, y: 300 + Math.floor(i / 2) * 120 + yOffset };
  });

  // Counterpoints fanned right
  counterpoints.forEach((n, i) => {
    positions[`node-${n.id}`] = { x: 600 + (i % 2) * 120, y: 300 + Math.floor(i / 2) * 120 + yOffset };
  });

  // Synthesis at bottom-center
  synthesis.forEach((n, i) => {
    positions[`node-${n.id}`] = { x: 350 + i * 120, y: 550 + yOffset };
  });

  // References below synthesis
  references.forEach((n, i) => {
    positions[`node-${n.id}`] = { x: 300 + i * 120, y: 680 + yOffset };
  });

  return positions;
}

function getComparisonLayout(nodes: LayoutNode[], yOffset: number): PositionMap {
  const positions: PositionMap = {};
  const roots = nodes.filter(n => n.node_type === 'CLAIM' || n.node_type === 'claim');
  const nonRoots = nodes.filter(n => n.node_type !== 'CLAIM' && n.node_type !== 'claim');

  // Thread node top-left
  positions['thread'] = { x: 50, y: 150 + yOffset };

  // ROOT nodes evenly spaced as column headers
  const colWidth = 250;
  const startX = 200;
  roots.forEach((root, i) => {
    positions[`node-${root.id}`] = { x: startX + i * colWidth, y: 200 + yOffset };
  });

  // Children stacked below their ROOT column
  const childrenByParent: Record<number, LayoutNode[]> = {};
  nonRoots.forEach(n => {
    const pid = n.parent_id || 0;
    if (!childrenByParent[pid]) childrenByParent[pid] = [];
    childrenByParent[pid].push(n);
  });

  for (const [parentId, children] of Object.entries(childrenByParent)) {
    const parentPos = positions[`node-${parentId}`];
    if (!parentPos) {
      // Orphan nodes — place at end
      children.forEach((child, ci) => {
        positions[`node-${child.id}`] = { x: startX + roots.length * colWidth, y: 350 + ci * 100 + yOffset };
      });
      continue;
    }
    children.forEach((child, ci) => {
      positions[`node-${child.id}`] = { x: parentPos.x, y: parentPos.y + 150 + ci * 100 };
    });
  }

  return positions;
}

/** Dagre-based auto layout — works for any thread type */
function getDagreLayout(
  nodes: LayoutNode[],
  relationships: RelInfo[],
  threadType: string,
  _yOffset: number
): PositionMap {
  const positions: PositionMap = {};
  if (!nodes.length) return positions;

  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));

  // Choose direction based on thread type
  const rankdir = threadType === 'timeline' ? 'LR' : 'TB';
  g.setGraph({
    rankdir,
    nodesep: 80,
    ranksep: 120,
    edgesep: 40,
    marginx: 40,
    marginy: 40,
  });

  const nodeWidth = 160;
  const nodeHeight = 60;

  // Add thread node
  g.setNode('thread', { width: nodeWidth, height: nodeHeight });

  // Build parent map from relationships
  const relParent: Record<number, number> = {};
  for (const rel of relationships) {
    if (!relParent[rel.source_id]) relParent[rel.source_id] = rel.target_id;
  }

  const parentOf = (n: LayoutNode): number | null => {
    if (n.parent_id) return n.parent_id;
    return relParent[n.id] ?? null;
  };

  // Identify roots (no parent)
  const roots = nodes.filter(n => !parentOf(n));
  const nodesWithRelParent = new Set(Object.keys(relParent).map(Number));

  // Add all nodes to dagre
  nodes.forEach(n => {
    g.setNode(`node-${n.id}`, { width: nodeWidth, height: nodeHeight });
  });

  // For timeline, chain roots sequentially
  if (threadType === 'timeline') {
    const sortedRoots = sortRootsChronologically(roots);
    // thread → first root
    if (sortedRoots.length > 0) {
      g.setEdge('thread', `node-${sortedRoots[0].id}`);
    }
    // chain roots
    for (let i = 1; i < sortedRoots.length; i++) {
      g.setEdge(`node-${sortedRoots[i - 1].id}`, `node-${sortedRoots[i].id}`);
    }
    // Non-root nodes connect to their parent
    nodes.forEach(n => {
      if (roots.some(r => r.id === n.id)) return;
      const pid = parentOf(n);
      if (pid != null) {
        g.setEdge(`node-${n.id}`, `node-${pid}`);
      } else {
        g.setEdge('thread', `node-${n.id}`);
      }
    });
  } else {
    // Standard: thread → roots, parent → children
    nodes.forEach(n => {
      const pid = parentOf(n);
      if (pid != null) {
        // child → parent edge (source supports target)
        g.setEdge(`node-${n.id}`, `node-${pid}`);
      } else if (!nodesWithRelParent.has(n.id)) {
        // root node — connect from thread
        g.setEdge('thread', `node-${n.id}`);
      }
    });
  }

  dagre.layout(g);

  // Extract positions (dagre uses center coords, convert to top-left)
  const threadPos = g.node('thread');
  if (threadPos) {
    positions['thread'] = { x: threadPos.x - nodeWidth / 2, y: threadPos.y - nodeHeight / 2 };
  }

  nodes.forEach(n => {
    const pos = g.node(`node-${n.id}`);
    if (pos) {
      positions[`node-${n.id}`] = { x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 };
    }
  });

  return positions;
}

interface ThreadGraphProps {
  threads: Thread[];
  onNodeClick?: (node: ThreadNode) => void;
  onAddNode?: (data: { newNode: { title?: string; content?: string; type?: number | string; threadId: number; parentId?: number | null } }) => void;
  onOpenEditor?: (node: ThreadNode) => void;
  onSelectedNodeChange?: (nodeId: number | null) => void;
  onOpenInArticle?: (nodeId: number) => void;
  onNavigateToThread?: (threadId: number) => void;
  onRefresh?: () => void;
  loading?: boolean;
}

const ThreadGraph: React.FC<ThreadGraphProps> = ({ threads, onNodeClick: _onNodeClick, onAddNode, onOpenEditor, onSelectedNodeChange, onOpenInArticle, onNavigateToThread, onRefresh, loading: parentLoading }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @xyflow/react generics require explicit any for initial state
  const [nodes, setNodes, onNodesChange] = useNodesState([] as any[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as RFEdge[]);
  const [selectedNode, setSelectedNode] = useState<{ id: number; type: string | number; title?: string; content?: unknown; parent_id?: number | null; metadata?: Record<string, unknown>; originalData?: Record<string, unknown>; [key: string]: unknown } | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMatteMode, setIsMatteMode] = useState(true);
  const [isDottedBackground, setIsDottedBackground] = useState(true);
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [showAllSecondary, setShowAllSecondary] = useState(false);
  const [hoveredRootId, setHoveredRootId] = useState<string | null>(null);
  const [decayMap, setDecayMap] = useState<Record<number, number>>({});
  const [linkCountMap, setLinkCountMap] = useState<Record<number, number>>({});
  const [confidenceMap, setConfidenceMap] = useState<Record<number, number>>({});
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<number>>(new Set());
  const [showDebate, setShowDebate] = useState(false);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const sidebarResizingRef = useRef(false);
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow();

  // Prevent horizontal swipe from triggering browser back gesture
  useEffect(() => {
    const el = graphContainerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  useEffect(() => {
    if (parentLoading !== undefined) {
      setLoading(parentLoading);
    }
  }, [parentLoading]);

  // Load decay data and cross-thread link counts
  useEffect(() => {
    if (!threads || threads.length === 0) return;
    const threadId = threads[0].id;
    api.getDecayData(threadId).then((data: DecayDataPoint[]) => {
      const map: Record<number, number> = {};
      (data || []).forEach((d) => { if (d.nodeId != null) map[d.nodeId] = d.decayPercent; });
      setDecayMap(map);
    }).catch(() => {});
    // Load cross-thread link counts for all nodes
    const nodeIds = (threads[0].nodes || []).map(n => n.id);
    const counts: Record<number, number> = {};
    Promise.all(nodeIds.slice(0, 30).map(async (nid) => {
      try {
        const links = await api.getNodeLinks(nid);
        if (links.length > 0) counts[nid] = links.length;
      } catch (e) {}
    })).then(() => setLinkCountMap(counts));
  }, [threads]);

  // Pick best handle pair based on relative positions of source & target
  function getBestHandles(srcPos: { x: number; y: number }, tgtPos: { x: number; y: number }) {
    const dx = tgtPos.x - srcPos.x;
    const dy = tgtPos.y - srcPos.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      // horizontal dominant
      return dx > 0
        ? { sourceHandle: 's-right', targetHandle: 't-left' }
        : { sourceHandle: 's-left', targetHandle: 't-right' };
    } else {
      return dy > 0
        ? { sourceHandle: 's-bottom', targetHandle: 't-top' }
        : { sourceHandle: 's-top', targetHandle: 't-bottom' };
    }
  }

  // Track saved layout data
  const savedLayoutRef = useRef<LayoutData | null>(null);
  const lastThreadIdRef = useRef<number | null>(null);
  const hasFitRef = useRef(false);

  // Load saved layout when thread changes
  useEffect(() => {
    if (!threads || threads.length === 0) return;
    const threadId = threads[0].id;
    // Only run for new thread IDs — same-thread refreshes are handled incrementally
    if (lastThreadIdRef.current === threadId) return;
    lastThreadIdRef.current = threadId;

    hasFitRef.current = false;
    (async () => {
      try {
        const savedData = await api.loadThreadLayout(threadId);
        savedLayoutRef.current = savedData;
        if (savedData?.settings?.isMatteMode !== undefined) {
          setIsMatteMode(savedData.settings.isMatteMode);
        }
        // Re-trigger node build now that we have the layout
        buildGraph(threads, savedData);
      } catch (e) {
        savedLayoutRef.current = null;
        buildGraph(threads, null);
      }
      // Fit view once after initial layout is ready
      if (!hasFitRef.current) {
        hasFitRef.current = true;
        setTimeout(() => fitView({ padding: 0.2 }), 50);
      }
    })();
  }, [threads]);

  // Build React Flow nodes/edges from thread data, merging saved positions
  const buildGraph = useCallback((threadList: Thread[], savedData: LayoutData | null) => {
    if (!threadList || threadList.length === 0) return;

    // Also preserve current positions of existing nodes (for when data refreshes after adding a node)
    const currentPosMap: Record<string, { x: number; y: number }> = {};
    nodes.forEach(n => { currentPosMap[n.id] = n.position; });

    const rfNodes: RFNode[] = [];
    const rfEdges: RFEdge[] = [];
    let yOffset = 0;

    threadList.forEach(thread => {
      const threadTitle = thread.metadata?.title || thread.title || `Thread ${thread.id}`;
      const titleWords = (threadTitle || '').split(/\s+/);
      const shortTitle = titleWords.length > 2 ? titleWords.slice(0, 2).join(' ') + '...' : threadTitle;

      // Determine thread type for layout
      const threadType = (thread.thread_type || thread.metadata?.thread_type || 'argument') as ThreadType;

      // Pre-compute type-specific default positions for all nodes (when no saved layout)
      let typeLayoutPositions: PositionMap | null = null;
      if (thread.nodes?.length) {
        const layoutNodes: LayoutNode[] = thread.nodes.map(n => ({
          id: n.id,
          node_type: n.node_type || (NODE_TYPES[n.type] || 'claim').toUpperCase(),
          parent_id: n.parent_id,
          created_at: n.created_at,
          metadata: n.metadata,
        }));
        const rels = (thread.relationships || []).map(r => ({ source_id: r.source_id, target_id: r.target_id }));
        typeLayoutPositions = getDagreLayout(layoutNodes, rels, threadType, yOffset);
      }

      const threadNodeId = `thread-${thread.id}`;
      const savedThreadPos = savedData?.nodes?.[threadNodeId];
      const currentThreadPos = currentPosMap[threadNodeId];

      rfNodes.push({
        id: threadNodeId,
        type: 'graphNode',
        position: savedThreadPos
          ? { x: savedThreadPos.x, y: savedThreadPos.y }
          : typeLayoutPositions?.['thread'] || currentThreadPos || { x: 400, y: 300 + yOffset },
        data: {
          label: shortTitle,
          isThread: true,
          nodeColor: NODE_TYPE_COLORS.thread,
          isMatteMode,
          originalData: {
            ...thread,
            type: 'thread',
            title: threadTitle,
            metadata: { ...thread.metadata, title: threadTitle }
          }
        },
        draggable: true,
      });

      const nodeCount = thread.nodes?.length || 0;
      thread.nodes?.forEach((node, idx) => {
        const nodeType = typeof node.type === 'number' ? node.type :
          NODE_TYPES.indexOf((node.node_type?.toLowerCase() || '') as NodeTypeName);
        const typeLabel = NODE_TYPES[nodeType] || '';
        const color = NODE_TYPE_COLORS[typeLabel] || '#666';

        // Parse content
        let parsedContent: unknown = node.content;
        try {
          if (typeof node.content === 'string' &&
            (node.content.startsWith('{') || node.content.startsWith('['))) {
            parsedContent = JSON.parse(node.content);
          }
        } catch (e) { /* keep as string */ }

        // Use saved position > current position > type-specific layout > default circular layout
        const nodeId = `node-${node.id}`;
        const savedPos = savedData?.nodes?.[nodeId];

        let position: { x: number; y: number };
        if (savedPos) {
          position = { x: savedPos.x, y: savedPos.y };
        } else if (typeLayoutPositions?.[nodeId]) {
          // Computed relationship-aware layout for nodes without saved positions
          position = typeLayoutPositions[nodeId];
        } else {
          const angle = (2 * Math.PI * idx) / Math.max(nodeCount, 1) - Math.PI / 2;
          const radius = 180;
          position = {
            x: 400 + radius * Math.cos(angle),
            y: 300 + yOffset + radius * Math.sin(angle),
          };
        }

        const isRoot = typeLabel === 'claim';
        const parentRfId = node.parent_id ? `node-${node.parent_id}` : null;

        const displayType = ENTITY_TYPE_LABELS[typeLabel] || typeLabel;
        const truncTitle = node.title
          ? (node.title.split(/\s+/).slice(0, 3).join(' ') + (node.title.split(/\s+/).length > 3 ? '…' : ''))
          : displayType;
        const rawLabel = truncTitle;

        rfNodes.push({
          id: nodeId,
          type: 'graphNode',
          position,
          data: {
            label: rawLabel,
            isThread: false,
            isRoot,
            parentRfId,
            nodeColor: color,
            isMatteMode,
            decayPercent: decayMap[node.id] ?? null,
            confidenceScore: confidenceMap[node.id] ?? null,
            showHeatmap,
            crossLinkCount: linkCountMap[node.id] || 0,
            originalData: { ...node, type: nodeType, content: parsedContent }
          },
          draggable: true,
        });
      });

      // Build edges with best handle pairs based on positions
      const posMap: Record<string, { x: number; y: number }> = {};
      rfNodes.forEach(n => { posMap[n.id] = n.position; });

      // For timeline threads, chain claim nodes sequentially instead of star pattern
      const isHistorical = threadType === 'timeline';
      // Build relationship parent map to identify child claims (created by enrich)
      const relParentMap: Record<number, number> = {};
      for (const rel of (thread.relationships || [])) {
        if (!relParentMap[rel.source_id]) relParentMap[rel.source_id] = rel.target_id;
      }

      const rootNodesOrdered = isHistorical
        ? sortRootsChronologically(
            (thread.nodes || [])
              .filter(n => {
                const nt = n.node_type || (NODE_TYPES[n.type] || '');
                const isClaim = nt === 'CLAIM' || nt === 'claim';
                // Exclude claims that are children via typed relationships (e.g. created by enrich)
                return isClaim && !n.parent_id && !relParentMap[n.id];
              })
              .map(n => ({
                id: n.id,
                node_type: n.node_type || (NODE_TYPES[n.type] || 'claim').toUpperCase(),
                parent_id: n.parent_id,
                created_at: n.created_at,
                metadata: n.metadata,
              }))
          )
        : [];
      const rootIdSet = new Set(rootNodesOrdered.map(n => n.id));

      // Build a set of edges already covered by typed relationships
      const relEdgeKeys = new Set<string>();
      // Track which nodes are targets of typed relationships (they have a "parent" via relationship)
      const nodesWithRelParent = new Set<number>();
      const relationships = thread.relationships || [];

      // Add typed relationship edges with labels and colors
      relationships.forEach(rel => {
        const sourceId = `node-${rel.source_id}`;
        const targetId = `node-${rel.target_id}`;
        const key = `${sourceId}-${targetId}`;
        relEdgeKeys.add(key);
        // Only the source (child) has a relationship parent — the target (parent) still needs thread→node edge
        nodesWithRelParent.add(rel.source_id);

        const handles = getBestHandles(posMap[sourceId] || { x: 0, y: 0 }, posMap[targetId] || { x: 0, y: 0 });
        const color = REL_TYPE_COLORS[rel.relation_type] || 'rgba(0, 255, 157, 0.4)';

        rfEdges.push({
          id: `rel-${rel.id}`,
          source: sourceId,
          target: targetId,
          sourceHandle: handles.sourceHandle,
          targetHandle: handles.targetHandle,
          label: REL_TYPE_LABELS[rel.relation_type] || rel.relation_type,
          labelStyle: { fontSize: 9, fontWeight: 600, fill: color },
          labelBgStyle: { fill: '#1a1a1a', fillOpacity: 0.85 },
          labelBgPadding: [4, 2],
          style: { stroke: color, strokeWidth: 2 },
          animated: rel.relation_type === 'CONTRADICTS',
          data: { relationType: rel.relation_type, properties: rel.properties },
        });
      });

      // Add structural edges (thread→node, parent→child, timeline chains)
      // for nodes that don't already have a typed relationship edge
      thread.nodes?.forEach(node => {
        let sourceId: string;
        const targetId = `node-${node.id}`;

        if (isHistorical && rootIdSet.has(node.id)) {
          // For timeline claim nodes: connect to previous claim in chain (or thread if first)
          const idx = rootNodesOrdered.findIndex(r => r.id === node.id);
          if (idx === 0) {
            sourceId = `thread-${thread.id}`;
          } else {
            sourceId = `node-${rootNodesOrdered[idx - 1].id}`;
          }
        } else if (node.parent_id) {
          const parentExists = thread.nodes.some(n => n.id === node.parent_id);
          sourceId = parentExists ? `node-${node.parent_id}` : `thread-${thread.id}`;
        } else if (nodesWithRelParent.has(node.id)) {
          // Node already connected via typed relationship — no need for thread→node edge
          return;
        } else {
          sourceId = `thread-${thread.id}`;
        }

        // Skip if a typed relationship already covers this edge
        if (relEdgeKeys.has(`${sourceId}-${targetId}`) || relEdgeKeys.has(`${targetId}-${sourceId}`)) return;

        const handles = getBestHandles(posMap[sourceId] || { x: 0, y: 0 }, posMap[targetId] || { x: 0, y: 0 });

        rfEdges.push({
          id: `e-${sourceId}-${targetId}`,
          source: sourceId,
          target: targetId,
          sourceHandle: handles.sourceHandle,
          targetHandle: handles.targetHandle,
          style: { stroke: 'rgba(0, 255, 157, 0.3)', strokeWidth: 1.5 },
          animated: false,
        });
      });
    });

    setNodes(rfNodes);
    setEdges(rfEdges);
    setLoading(false);
  }, [nodes, isMatteMode, decayMap, linkCountMap, confidenceMap, showHeatmap]);

  // When threads data changes for the SAME thread (e.g. after enrich), do incremental update
  // instead of full rebuild to preserve existing node positions and edges
  useEffect(() => {
    if (!threads || threads.length === 0) return;
    const thread = threads[0];
    const threadId = thread.id;
    // Only handle same-thread refreshes here (new thread is handled by the layout-loading effect)
    if (lastThreadIdRef.current !== threadId || savedLayoutRef.current === undefined) return;

    // Check if there are genuinely new nodes to add
    setNodes(prevNodes => {
      const existingIds = new Set(prevNodes.map(n => n.id));
      const newThreadNodes = (thread.nodes || []).filter(n => !existingIds.has(`node-${n.id}`));
      if (newThreadNodes.length === 0) {
        // No new nodes — just update data on existing nodes (e.g. content changes)
        const nodeDataMap = new Map((thread.nodes || []).map(n => [n.id, n]));
        return prevNodes.map(n => {
          if (!n.id.startsWith('node-')) return n;
          const nodeId = parseInt(n.id.slice(5));
          const freshNode = nodeDataMap.get(nodeId);
          if (!freshNode) return n;
          // Update originalData but keep position
          let parsedContent: unknown = freshNode.content;
          try {
            if (typeof freshNode.content === 'string' && (freshNode.content.startsWith('{') || freshNode.content.startsWith('['))) {
              parsedContent = JSON.parse(freshNode.content);
            }
          } catch (e) { /* keep as string */ }
          const nodeType = typeof freshNode.type === 'number' ? freshNode.type : NODE_TYPES.indexOf((freshNode.node_type?.toLowerCase() || '') as NodeTypeName);
          return { ...n, data: { ...n.data, originalData: { ...freshNode, type: nodeType, content: parsedContent } } };
        });
      }

      // Build position map from current live nodes
      const posMap: Record<string, { x: number; y: number }> = {};
      prevNodes.forEach(n => { posMap[n.id] = n.position; });

      // Build relationship parent map
      const relParentMap: Record<number, number> = {};
      for (const rel of (thread.relationships || [])) {
        if (!relParentMap[rel.source_id]) relParentMap[rel.source_id] = rel.target_id;
      }

      // Create RF nodes for new thread nodes, positioned near their parent
      const addedNodes: RFNode[] = [];
      newThreadNodes.forEach((node, ni) => {
        const nodeType = typeof node.type === 'number' ? node.type : NODE_TYPES.indexOf((node.node_type?.toLowerCase() || '') as NodeTypeName);
        const typeLabel = NODE_TYPES[nodeType] || '';
        const color = NODE_TYPE_COLORS[typeLabel as NodeTypeName] || '#666';
        const displayType = ENTITY_TYPE_LABELS[typeLabel] || typeLabel;
        const truncTitle = node.title
          ? (node.title.split(/\s+/).slice(0, 3).join(' ') + (node.title.split(/\s+/).length > 3 ? '…' : ''))
          : displayType;

        let parsedContent: unknown = node.content;
        try {
          if (typeof node.content === 'string' && (node.content.startsWith('{') || node.content.startsWith('['))) {
            parsedContent = JSON.parse(node.content);
          }
        } catch (e) { /* keep as string */ }

        // Position relative to parent's actual current position
        const parentId = node.parent_id || relParentMap[node.id];
        const parentPos = parentId ? posMap[`node-${parentId}`] : null;
        let position: { x: number; y: number };
        if (parentPos) {
          const fanOffset = (ni - (newThreadNodes.length - 1) / 2) * 140;
          position = { x: parentPos.x + fanOffset, y: parentPos.y + 160 };
        } else {
          // No parent found — place near the rightmost existing node
          const maxX = Math.max(...prevNodes.map(n => n.position.x), 400);
          position = { x: maxX + 150 + ni * 140, y: 300 };
        }

        const isRoot = typeLabel === 'claim';
        const parentRfId = node.parent_id ? `node-${node.parent_id}` : null;
        const nodeId = `node-${node.id}`;

        addedNodes.push({
          id: nodeId,
          type: 'graphNode',
          position,
          data: {
            label: truncTitle,
            isThread: false,
            isRoot,
            parentRfId,
            nodeColor: color,
            isMatteMode,
            decayPercent: decayMap[node.id] ?? null,
            confidenceScore: confidenceMap[node.id] ?? null,
            showHeatmap,
            crossLinkCount: linkCountMap[node.id] || 0,
            originalData: { ...node, type: nodeType, content: parsedContent },
          },
          draggable: true,
        });
        // Register position for edge building
        posMap[nodeId] = position;
      });

      // Also add new edges for the new nodes
      setEdges(prevEdges => {
        const existingEdgeIds = new Set(prevEdges.map(e => e.id));
        const newEdges: RFEdge[] = [];
        const relEdgeKeys = new Set(prevEdges.filter(e => e.id.startsWith('rel-')).map(e => `${e.source}-${e.target}`));

        // Add typed relationship edges for new relationships
        (thread.relationships || []).forEach(rel => {
          const edgeId = `rel-${rel.id}`;
          if (existingEdgeIds.has(edgeId)) return;
          const sourceId = `node-${rel.source_id}`;
          const targetId = `node-${rel.target_id}`;
          relEdgeKeys.add(`${sourceId}-${targetId}`);
          const handles = getBestHandles(posMap[sourceId] || { x: 0, y: 0 }, posMap[targetId] || { x: 0, y: 0 });
          const color = REL_TYPE_COLORS[rel.relation_type] || 'rgba(0, 255, 157, 0.4)';
          newEdges.push({
            id: edgeId,
            source: sourceId,
            target: targetId,
            sourceHandle: handles.sourceHandle,
            targetHandle: handles.targetHandle,
            label: REL_TYPE_LABELS[rel.relation_type] || rel.relation_type,
            labelStyle: { fontSize: 9, fontWeight: 600, fill: color },
            labelBgStyle: { fill: '#1a1a1a', fillOpacity: 0.85 },
            labelBgPadding: [4, 2] as [number, number],
            style: { stroke: color, strokeWidth: 2 },
            animated: rel.relation_type === 'CONTRADICTS',
            data: { relationType: rel.relation_type, properties: rel.properties },
          });
        });

        // Add structural edges for new nodes
        newThreadNodes.forEach(node => {
          const targetId = `node-${node.id}`;
          let sourceId: string;
          const nodesWithRelParent = new Set((thread.relationships || []).map(r => r.source_id));

          if (node.parent_id) {
            sourceId = `node-${node.parent_id}`;
          } else if (nodesWithRelParent.has(node.id)) {
            return; // already connected via typed relationship
          } else {
            sourceId = `thread-${threadId}`;
          }

          const edgeId = `e-${sourceId}-${targetId}`;
          if (existingEdgeIds.has(edgeId)) return;
          if (relEdgeKeys.has(`${sourceId}-${targetId}`) || relEdgeKeys.has(`${targetId}-${sourceId}`)) return;

          const handles = getBestHandles(posMap[sourceId] || { x: 0, y: 0 }, posMap[targetId] || { x: 0, y: 0 });
          newEdges.push({
            id: edgeId,
            source: sourceId,
            target: targetId,
            sourceHandle: handles.sourceHandle,
            targetHandle: handles.targetHandle,
            style: { stroke: 'rgba(0, 255, 157, 0.3)', strokeWidth: 1.5 },
            animated: false,
          });
        });

        return [...prevEdges, ...newEdges];
      });

      return [...prevNodes, ...addedNodes];
    });
  }, [threads]);

  // Update matte mode on existing nodes without resetting positions
  useEffect(() => {
    setNodes(prev => prev.map(n => ({
      ...n,
      data: { ...n.data, isMatteMode }
    })));
  }, [isMatteMode]);

  // Update heatmap mode and highlights on existing nodes without resetting positions
  useEffect(() => {
    setNodes(prev => prev.map(n => {
      const nodeId = n.id.startsWith('node-') ? parseInt(n.id.slice(5)) : null;
      return {
        ...n,
        data: {
          ...n.data,
          showHeatmap,
          confidenceScore: nodeId != null ? (confidenceMap[nodeId] ?? null) : null,
          highlighted: nodeId != null && highlightedNodeIds.has(nodeId),
        }
      };
    }));
  }, [showHeatmap, confidenceMap, highlightedNodeIds]);

  // Compute which nodes/edges are visible based on showAllSecondary + hover
  const visibleNodes = useMemo(() => nodes.map(n => {
    if (n.id.startsWith('thread-') || n.data.isRoot) return { ...n, hidden: false };
    if (showAllSecondary) return { ...n, hidden: false };
    const visible = hoveredRootId !== null && n.data.parentRfId === hoveredRootId;
    return { ...n, hidden: !visible };
  }), [nodes, showAllSecondary, hoveredRootId]);

  // Determine current thread type for visibility rules
  const currentThreadType = useMemo(() => {
    if (!threads || threads.length === 0) return 'argument';
    return (threads[0].thread_type || threads[0].metadata?.thread_type || 'argument') as string;
  }, [threads]);

  // Build set of ROOT node RF ids for edge visibility
  const rootNodeIds = useMemo(() => {
    const ids = new Set<string>();
    nodes.forEach(n => { if (n.data.isRoot) ids.add(n.id); });
    return ids;
  }, [nodes]);

  const visibleEdges = useMemo(() => edges.map(e => {
    if (showAllSecondary) return { ...e, hidden: false };
    // Thread → ROOT edges always visible
    if (e.source.startsWith('thread-')) return { ...e, hidden: false };
    // For historical threads: ROOT → ROOT chain edges always visible
    if (currentThreadType === 'timeline' && rootNodeIds.has(e.source) && rootNodeIds.has(e.target)) {
      return { ...e, hidden: false };
    }
    // Edges between root nodes (e.g. child claim linked to parent claim via typed relationship)
    if (rootNodeIds.has(e.source) && rootNodeIds.has(e.target)) {
      return { ...e, hidden: false };
    }
    // ROOT → secondary: visible when that ROOT is hovered
    if (hoveredRootId !== null && e.source === hoveredRootId) return { ...e, hidden: false };
    return { ...e, hidden: true };
  }), [edges, showAllSecondary, hoveredRootId, currentThreadType, rootNodeIds]);

  const handleNodeClick = useCallback((node: Record<string, unknown>) => {
    setSelectedNode(node as typeof selectedNode);
    // Notify parent of selected node id (null for thread-level, numeric id for nodes)
    if (onSelectedNodeChange) {
      onSelectedNodeChange(node?.type === 'thread' ? null : (node?.id as number) ?? null);
    }
  }, [onSelectedNodeChange]);

  const onNodeClickHandler = useCallback((_event: React.MouseEvent, rfNode: { data: GraphNodeData }) => {
    handleNodeClick(rfNode.data.originalData);
  }, [handleNodeClick]);

  const onNodeDoubleClickHandler = useCallback((_event: React.MouseEvent, rfNode: { data: GraphNodeData }) => {
    const node = rfNode.data.originalData;
    if (node?.type !== 'thread' && onOpenInArticle) {
      onOpenInArticle(node.id as number);
    }
  }, [onOpenInArticle]);

  const closeContentSidebar = () => {
    setSelectedNode(null);
    if (onSelectedNodeChange) onSelectedNodeChange(null);
  };

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sidebarResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      if (!sidebarResizingRef.current) return;
      const delta = startX - ev.clientX;
      setSidebarWidth(Math.max(250, Math.min(800, startWidth + delta)));
    };
    const onUp = () => {
      sidebarResizingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  // Save layout (also updates the ref so rebuilds preserve positions)
  const layoutSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveCurrentLayout = useCallback(async () => {
    if (!threads || threads.length === 0) return;
    const threadId = threads[0].id;
    const currentLayout: LayoutData = {
      nodes: {},
      settings: { isMatteMode }
    };
    nodes.forEach(n => {
      currentLayout.nodes[n.id] = { x: n.position.x, y: n.position.y };
    });
    savedLayoutRef.current = currentLayout;
    try {
      setLayoutLoading(true);
      await api.saveThreadLayout(threadId, currentLayout);
    } catch (e) {
      console.error('Failed to save layout:', e);
    } finally {
      setLayoutLoading(false);
    }
  }, [threads, nodes, isMatteMode]);

  // Auto-save layout after dragging nodes
  const handleNodeDragStop = useCallback(() => {
    if (layoutSaveTimer.current) clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = setTimeout(() => {
      saveCurrentLayout();
    }, 500);
  }, [saveCurrentLayout]);

  // Re-fetch thread nodes from API and rebuild the graph
  const refetchAndRebuild = useCallback(async () => {
    if (!threads || threads.length === 0) return;
    const threadId = threads[0].id;
    try {
      const { nodes: freshNodes, edges: freshEdges, relationships: freshRels } = await api.getThreadNodes(threadId);
      // Build an updated thread object with fresh nodes
      const updatedThread: Thread = { ...threads[0], nodes: freshNodes, edges: freshEdges, relationships: freshRels };
      buildGraph([updatedThread], savedLayoutRef.current);
      // Also notify parent if callback exists
      onRefresh?.();
    } catch (e) {
      console.error('Refresh failed:', e);
    }
  }, [threads, buildGraph, onRefresh]);

  // Reparent a node to a new parent (or detach to ROOT)
  const handleReparentNode = useCallback(async (nodeId: number, newParentId: number | null) => {
    if (!threads || threads.length === 0) return;
    const threadId = threads[0].id;
    try {
      await api.reparentNode(threadId, nodeId, newParentId);
      setSelectedNode(null); // close sidebar so stale data doesn't show
      await refetchAndRebuild();
    } catch (e) {
      console.error('Reparent failed:', e);
    }
  }, [threads, refetchAndRebuild]);

  // Reorder: move a ROOT node earlier/later by rebuilding the full order for all roots
  const handleReorderNode = useCallback(async (nodeId: number, direction: 'earlier' | 'later') => {
    if (!threads || threads.length === 0) return;
    const thread = threads[0];
    const threadId = thread.id;

    // Get all ROOT nodes in current visual order
    const rootNodes = (thread.nodes || [])
      .filter(n => {
        const nt = n.node_type || (NODE_TYPES[n.type] || '');
        return nt === 'CLAIM' || nt === 'claim';
      })
      .map(n => ({
        id: n.id,
        order: (n.metadata?.chronological_order as number | undefined) ?? null,
        created_at: n.created_at,
      }));

    rootNodes.sort((a, b) => {
      if (a.order != null && b.order != null) return a.order - b.order;
      if (a.order != null) return -1;
      if (b.order != null) return 1;
      return a.created_at.localeCompare(b.created_at);
    });

    const idx = rootNodes.findIndex(n => n.id === nodeId);
    if (idx < 0) return;

    const swapIdx = direction === 'earlier' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rootNodes.length) return;

    // Swap positions in the array
    [rootNodes[idx], rootNodes[swapIdx]] = [rootNodes[swapIdx], rootNodes[idx]];

    // Assign fresh sequential order (1, 2, 3, ...) to ALL roots
    try {
      await Promise.all(
        rootNodes.map((n, i) => api.updateNodeOrder(threadId, n.id, i + 1))
      );
      await refetchAndRebuild();
    } catch (e) {
      console.error('Reorder failed:', e);
    }
  }, [threads, refetchAndRebuild]);

  // Enrich a single node
  const handleEnrichNode = useCallback(async (nodeId: number) => {
    if (!threads || threads.length === 0) return;
    const threadId = threads[0].id;
    setEnrichLoading(true);
    try {
      await api.enrichNode(threadId, nodeId);
      await refetchAndRebuild();
      onRefresh?.();
    } catch (err) {
      console.error('Enrich node failed:', err);
    } finally {
      setEnrichLoading(false);
    }
  }, [threads, refetchAndRebuild, onRefresh]);

  // Enrich thread: enrich each top-level claim node
  const handleEnrichThread = useCallback(async (threadId: number) => {
    if (!threads || threads.length === 0) return;
    const thread = threads[0];
    const claimNodes = (thread.nodes || []).filter(n => {
      const nt = (n.node_type || NODE_TYPES[n.type] || '').toLowerCase();
      return nt === 'claim' && !n.parent_id;
    });
    if (claimNodes.length === 0) return;
    setEnrichLoading(true);
    try {
      for (const node of claimNodes) {
        await api.enrichNode(threadId, node.id);
      }
      await refetchAndRebuild();
      onRefresh?.();
    } catch (err) {
      console.error('Enrich thread failed:', err);
    } finally {
      setEnrichLoading(false);
    }
  }, [threads, refetchAndRebuild, onRefresh]);

  // Reset layout
  const resetLayout = async () => {
    if (!threads || threads.length === 0) return;
    const threadId = threads[0].id;
    try {
      setLayoutLoading(true);
      await api.deleteThreadLayout(threadId);
      // Clear saved data so computed layout takes effect on rebuild
      savedLayoutRef.current = null;
      // Rebuild graph with no saved positions — computed layout will apply
      buildGraph(threads, null);
    } catch (e) {
      console.error('Failed to reset layout:', e);
    } finally {
      setLayoutLoading(false);
    }
  };

  return (
    <div className={`thread-graph ${isMatteMode ? 'matte' : ''}`}>
      <div className="graph-container" ref={graphContainerRef}>
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @xyflow/react handler generics
          onNodeClick={onNodeClickHandler as any}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onNodeDoubleClick={onNodeDoubleClickHandler as any}
          onNodeDragStop={handleNodeDragStop}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onNodeMouseEnter={((_: React.MouseEvent, node: { id: string; data: GraphNodeData }) => {
            if (!showAllSecondary && node.data.isRoot) setHoveredRootId(node.id);
          }) as any}
          onNodeMouseLeave={() => setHoveredRootId(null)}
          nodeTypes={nodeTypes}
          panOnScroll
          zoomOnScroll={false}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          style={{ background: '#1d1d1d' }}
        >
          <Background
            variant={isDottedBackground ? BackgroundVariant.Dots : BackgroundVariant.Lines}
            gap={isDottedBackground ? 40 : 0}
            size={isDottedBackground ? 1 : 0}
            color={isDottedBackground ? 'rgba(255, 255, 255, 0.08)' : 'transparent'}
          />
        </ReactFlow>
        {loading && (
          <div className="loading-overlay">
            <div className="loading-spinner"></div>
          </div>
        )}
        <div className="bottom-right-controls">
          <button
            className={`control-button ${showHeatmap ? 'active' : ''}`}
            disabled={heatmapLoading}
            onClick={async () => {
              if (showHeatmap) {
                setShowHeatmap(false);
                return;
              }
              if (!threads?.[0]) return;
              setHeatmapLoading(true);
              try {
                const { scores } = await api.getNodeConfidence(threads[0].id);
                setConfidenceMap(scores);
                setShowHeatmap(true);
              } catch { /* toast shown by api layer */ }
              finally { setHeatmapLoading(false); }
            }}
            title={showHeatmap ? 'Hide confidence heatmap' : 'Show confidence heatmap (AI-scored)'}
          >
            {heatmapLoading ? '...' : 'H'}
          </button>
          <button
            className={`control-button ${showAllSecondary ? 'active' : ''}`}
            onClick={() => setShowAllSecondary(v => !v)}
            title={showAllSecondary ? 'Hide secondary nodes (show roots only)' : 'Show all secondary nodes'}
          >
            {showAllSecondary ? 'All' : 'Roots'}
          </button>
          <button
            className={`control-button ${isMatteMode ? 'active' : ''}`}
            onClick={() => setIsMatteMode(!isMatteMode)}
            title={isMatteMode ? 'Switch to Glossy mode' : 'Switch to Matte mode'}
          >
            M
          </button>
          <button
            className={`control-button ${isDottedBackground ? 'active' : ''}`}
            onClick={() => setIsDottedBackground(!isDottedBackground)}
            title={isDottedBackground ? 'Switch to solid background' : 'Switch to dotted background'}
          >
            D
          </button>
          <button
            className="control-button"
            onClick={() => fitView({ padding: 0.2, duration: 300 })}
            title="Fit view"
          >
            F
          </button>
          <button
            className="control-button"
            onClick={resetLayout}
            disabled={layoutLoading}
            title="Reset layout"
          >
            R
          </button>
        </div>
      </div>

      {showHeatmap && (
        <div style={{
          position: 'absolute', bottom: 50, left: 12, zIndex: 10,
          background: 'rgba(26,26,26,0.9)', border: '1px solid #333',
          borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#aaa',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <div style={{ fontWeight: 600, color: '#fff', marginBottom: 2 }}>Confidence</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#66bb6a', display: 'inline-block' }} />
            70-100 Strong
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#fdd835', display: 'inline-block' }} />
            45-69 Moderate
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef5350', display: 'inline-block' }} />
            0-44 Weak
          </div>
        </div>
      )}

      <div className={`content-sidebar ${selectedNode ? 'open' : ''}`} style={selectedNode ? { width: sidebarWidth } : undefined}>
        {selectedNode && <div className="sidebar-resize-handle" onMouseDown={handleSidebarResizeStart} />}
        <GraphContentSidebar
          selectedNode={selectedNode}
          threads={threads}
          onClose={closeContentSidebar}
          onNodeClick={handleNodeClick}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onOpenEditor={onOpenEditor as any}
          onOpenInArticle={onOpenInArticle}
          onNavigateToThread={onNavigateToThread}
          formatContent={formatContent}
          threadType={(threads[0]?.thread_type || threads[0]?.metadata?.thread_type || 'argument') as ThreadType}
          onHighlightNodes={(nodeIds: number[]) => {
            setHighlightedNodeIds(new Set(nodeIds));
            // Auto-clear highlights after 5 seconds
            setTimeout(() => setHighlightedNodeIds(new Set()), 5000);
          }}
          onStartDebate={() => setShowDebate(true)}
          onRefresh={refetchAndRebuild}
        />
      </div>

      {showDebate && threads.length > 0 && (
        <DebateMode
          threadId={threads[0].id}
          threadTitle={threads[0].metadata?.title || threads[0].title || `Thread ${threads[0].id}`}
          onClose={() => setShowDebate(false)}
        />
      )}
    </div>
  );
};

export default ThreadGraph;
