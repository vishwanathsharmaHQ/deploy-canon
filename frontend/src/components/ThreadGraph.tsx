import React, { useEffect, useState, useCallback, useMemo, useRef, memo } from 'react';
import { sanitizeHtml } from '../utils/sanitize';
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  Background,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ReactMarkdown from 'react-markdown';
import './ThreadGraph.css';
import { api } from '../services/api';
import { NODE_TYPES, NODE_TYPE_COLORS } from '../constants';
import type { Thread, ThreadNode, NodeTypeName } from '../types';
import CrossThreadLinkPanel from './CrossThreadLinkPanel';

const YT_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/;

const mdComponents = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    const yt = href?.match(YT_REGEX);
    if (yt) {
      return (
        <div className="sidebar-youtube">
          <iframe
            src={`https://www.youtube.com/embed/${yt[1]}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={`yt-${yt[1]}`}
          />
        </div>
      );
    }
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  },
};

// Custom node component with decay visualization
function GraphNode({ data }: { data: any }) {
  const color = data.nodeColor || '#666';
  const isThread = data.isThread;
  const radius = isThread ? 25 : 15;
  const matteClass = data.isMatteMode ? 'matte' : '';
  const decay: number | null = data.decayPercent;
  const hasLinks = data.crossLinkCount > 0;

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
      <div
        className="graph-node-circle"
        style={{
          width: radius * 2,
          height: radius * 2,
          borderRadius: '50%',
          background: color,
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
      <div className="graph-node-label">
        {data.label}
      </div>
    </div>
  );
}

const nodeTypes = { graphNode: GraphNode };

interface ThreadGraphProps {
  threads: Thread[];
  onNodeClick?: (node: any) => void;
  onAddNode?: (node: any) => void;
  onOpenEditor?: (node: any) => void;
  onSelectedNodeChange?: (nodeId: number | null) => void;
  onOpenInArticle?: (nodeId: number) => void;
  onNavigateToThread?: (threadId: number) => void;
  loading?: boolean;
}

const ThreadGraph: React.FC<ThreadGraphProps> = ({ threads, onNodeClick: _onNodeClick, onAddNode, onOpenEditor, onSelectedNodeChange, onOpenInArticle, onNavigateToThread, loading: parentLoading }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([] as any[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as any[]);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isMatteMode, setIsMatteMode] = useState(true);
  const [isDottedBackground, setIsDottedBackground] = useState(true);
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [showAllSecondary, setShowAllSecondary] = useState(false);
  const [hoveredRootId, setHoveredRootId] = useState<string | null>(null);
  const [decayMap, setDecayMap] = useState<Record<number, number>>({});
  const [linkCountMap, setLinkCountMap] = useState<Record<number, number>>({});
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (parentLoading !== undefined) {
      setLoading(parentLoading);
    }
  }, [parentLoading]);

  // Load decay data and cross-thread link counts
  useEffect(() => {
    if (!threads || threads.length === 0) return;
    const threadId = threads[0].id;
    api.getDecayData(threadId).then((data: any) => {
      const map: Record<number, number> = {};
      (data || []).forEach((d: any) => { map[d.nodeId] = d.decayPercent; });
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
  const savedLayoutRef = useRef<any>(null);
  const lastThreadIdRef = useRef<number | null>(null);
  const hasFitRef = useRef(false);

  // Load saved layout when thread changes
  useEffect(() => {
    if (!threads || threads.length === 0) return;
    const threadId = threads[0].id;
    if (lastThreadIdRef.current === threadId && savedLayoutRef.current) return;
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
  const buildGraph = useCallback((threadList: Thread[], savedData: any) => {
    if (!threadList || threadList.length === 0) return;

    // Also preserve current positions of existing nodes (for when data refreshes after adding a node)
    const currentPosMap: Record<string, { x: number; y: number }> = {};
    nodes.forEach(n => { currentPosMap[n.id] = n.position; });

    const rfNodes: any[] = [];
    const rfEdges: any[] = [];
    let yOffset = 0;

    threadList.forEach(thread => {
      const threadTitle = thread.metadata?.title || thread.title || `Thread ${thread.id}`;
      const titleWords = (threadTitle || '').split(/\s+/);
      const shortTitle = titleWords.length > 2 ? titleWords.slice(0, 2).join(' ') + '...' : threadTitle;

      const threadNodeId = `thread-${thread.id}`;
      const savedThreadPos = savedData?.nodes?.[threadNodeId];
      const currentThreadPos = currentPosMap[threadNodeId];

      rfNodes.push({
        id: threadNodeId,
        type: 'graphNode',
        position: savedThreadPos
          ? { x: savedThreadPos.x, y: savedThreadPos.y }
          : currentThreadPos || { x: 400, y: 300 + yOffset },
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
          NODE_TYPES.indexOf(node.node_type);
        const typeLabel = NODE_TYPES[nodeType] || '';
        const color = NODE_TYPE_COLORS[typeLabel] || '#666';

        // Parse content
        let parsedContent: any = node.content;
        try {
          if (typeof node.content === 'string' &&
            (node.content.startsWith('{') || node.content.startsWith('['))) {
            parsedContent = JSON.parse(node.content);
          }
        } catch (e) { /* keep as string */ }

        // Use saved position > current position > default circular layout
        const nodeId = `node-${node.id}`;
        const savedPos = savedData?.nodes?.[nodeId];
        const currentPos = currentPosMap[nodeId];

        let position: { x: number; y: number };
        if (savedPos) {
          position = { x: savedPos.x, y: savedPos.y };
        } else if (currentPos) {
          position = currentPos;
        } else {
          const angle = (2 * Math.PI * idx) / Math.max(nodeCount, 1) - Math.PI / 2;
          const radius = 180;
          position = {
            x: 400 + radius * Math.cos(angle),
            y: 300 + yOffset + radius * Math.sin(angle),
          };
        }

        const isRoot = typeLabel === 'ROOT';
        const parentRfId = node.parent_id ? `node-${node.parent_id}` : null;

        const rawLabel = isRoot && node.title
          ? (node.title.split(/\s+/).slice(0, 3).join(' ') + (node.title.split(/\s+/).length > 3 ? '…' : ''))
          : typeLabel;

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
            crossLinkCount: linkCountMap[node.id] || 0,
            originalData: { ...node, type: nodeType, content: parsedContent }
          },
          draggable: true,
        });
      });

      // Build edges with best handle pairs based on positions
      const posMap: Record<string, { x: number; y: number }> = {};
      rfNodes.forEach(n => { posMap[n.id] = n.position; });

      thread.nodes?.forEach(node => {
        let sourceId: string, targetId: string;
        targetId = `node-${node.id}`;

        if (node.parent_id) {
          const parentExists = thread.nodes.some(n => n.id === node.parent_id);
          sourceId = parentExists ? `node-${node.parent_id}` : `thread-${thread.id}`;
        } else {
          sourceId = `thread-${thread.id}`;
        }

        const handles = getBestHandles(posMap[sourceId] || { x: 0, y: 0 }, posMap[targetId] || { x: 0, y: 0 });

        rfEdges.push({
          id: `e-${sourceId}-${targetId}`,
          source: sourceId,
          target: targetId,
          sourceHandle: handles.sourceHandle,
          targetHandle: handles.targetHandle,
          style: { stroke: 'rgba(0, 255, 157, 0.3)', strokeWidth: 2 },
          animated: false,
        });
      });
    });

    setNodes(rfNodes);
    setEdges(rfEdges);
    setLoading(false);
  }, [nodes, isMatteMode, decayMap, linkCountMap]);

  // When threads change but we already have a saved layout, rebuild immediately
  useEffect(() => {
    if (!threads || threads.length === 0) return;
    const threadId = threads[0].id;
    // Only do the synchronous rebuild if we already loaded the layout for this thread
    if (lastThreadIdRef.current === threadId && savedLayoutRef.current !== undefined) {
      buildGraph(threads, savedLayoutRef.current);
    }
  }, [threads]);

  // Update matte mode on existing nodes without resetting positions
  useEffect(() => {
    setNodes(prev => prev.map(n => ({
      ...n,
      data: { ...n.data, isMatteMode }
    })));
  }, [isMatteMode]);

  // Compute which nodes/edges are visible based on showAllSecondary + hover
  const visibleNodes = useMemo(() => nodes.map(n => {
    if (n.id.startsWith('thread-') || n.data.isRoot) return { ...n, hidden: false };
    if (showAllSecondary) return { ...n, hidden: false };
    const visible = hoveredRootId !== null && n.data.parentRfId === hoveredRootId;
    return { ...n, hidden: !visible };
  }), [nodes, showAllSecondary, hoveredRootId]);

  const visibleEdges = useMemo(() => edges.map(e => {
    if (showAllSecondary) return { ...e, hidden: false };
    // Thread → ROOT edges always visible
    if (e.source.startsWith('thread-')) return { ...e, hidden: false };
    // ROOT → secondary: visible when that ROOT is hovered
    if (hoveredRootId !== null && e.source === hoveredRootId) return { ...e, hidden: false };
    return { ...e, hidden: true };
  }), [edges, showAllSecondary, hoveredRootId]);

  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode(node);
    // Notify parent of selected node id (null for thread-level, numeric id for nodes)
    if (onSelectedNodeChange) {
      onSelectedNodeChange(node?.type === 'thread' ? null : node?.id ?? null);
    }
  }, [onSelectedNodeChange]);

  const onNodeClickHandler = useCallback((_event: React.MouseEvent, rfNode: any) => {
    handleNodeClick(rfNode.data.originalData);
  }, [handleNodeClick]);

  const onNodeDoubleClickHandler = useCallback((_event: React.MouseEvent, rfNode: any) => {
    const node = rfNode.data.originalData;
    if (node?.type !== 'thread' && onOpenInArticle) {
      onOpenInArticle(node.id);
    }
  }, [onOpenInArticle]);

  const closeContentSidebar = () => {
    setSelectedNode(null);
    if (onSelectedNodeChange) onSelectedNodeChange(null);
  };

  const getChildNodes = (nodeId: string) => {
    if (!threads.length) return [];
    const thread = threads[0];
    if (nodeId.startsWith('thread-')) {
      return (thread.nodes || []).filter(node => !node.parent_id);
    } else {
      const nodeIdNumber = parseInt(nodeId.replace('node-', ''));
      return (thread.nodes || []).filter(node => node.parent_id === nodeIdNumber);
    }
  };

  const handleChildNodeClick = (node: any) => {
    handleNodeClick(node);
  };

  const getNodeTypeBadgeColor = (type: string | number) => {
    if (type === 'thread') return NODE_TYPE_COLORS.thread;
    return NODE_TYPE_COLORS[NODE_TYPES[type as number] as NodeTypeName] || '#666';
  };

  // Save layout (also updates the ref so rebuilds preserve positions)
  const layoutSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveCurrentLayout = useCallback(async () => {
    if (!threads || threads.length === 0) return;
    const threadId = threads[0].id;
    const currentLayout: any = {
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

  // Reset layout
  const resetLayout = async () => {
    if (!threads || threads.length === 0) return;
    const threadId = threads[0].id;
    try {
      setLayoutLoading(true);
      await api.deleteThreadLayout(threadId);
      // Re-trigger layout from thread data
      setNodes(prev => {
        const nodeCount = prev.length - 1; // minus thread node
        return prev.map((n, idx) => {
          if (n.id.startsWith('thread-')) {
            return { ...n, position: { x: 400, y: 300 } };
          }
          const i = idx - 1;
          const angle = (2 * Math.PI * i) / Math.max(nodeCount, 1) - Math.PI / 2;
          const radius = 180;
          return {
            ...n,
            position: {
              x: 400 + radius * Math.cos(angle),
              y: 300 + radius * Math.sin(angle)
            }
          };
        });
      });
    } catch (e) {
      console.error('Failed to reset layout:', e);
    } finally {
      setLayoutLoading(false);
    }
  };

  // Render a string that may contain HTML tags or markdown
  const renderText = (text: any): React.ReactNode => {
    if (!text) return null;
    const str = String(text);
    if (/<[a-z][\s\S]*>/i.test(str)) {
      return <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(str) }} />;
    }
    return <ReactMarkdown components={mdComponents as any}>{str}</ReactMarkdown>;
  };

  const formatContent = (content: any, nodeType: string): React.ReactNode => {
    if (!content) return 'No content available';

    try {
      let actualContent = content.content || content;

      if (typeof actualContent === 'string' && (actualContent.startsWith('{') || actualContent.startsWith('['))) {
        try { actualContent = JSON.parse(actualContent); } catch (e) { /* ignore */ }
      }

      if (['ROOT', 'EVIDENCE', 'EXAMPLE', 'COUNTERPOINT'].includes(nodeType)) {
        const jsonContent = typeof actualContent === 'object' ? actualContent :
          typeof actualContent === 'string' && actualContent.startsWith('{') ?
            JSON.parse(actualContent) : null;

        if (jsonContent) {
          switch (nodeType) {
            case 'ROOT':
              return (
                <div className="root-content">
                  <h4 className="root-title">{renderText(jsonContent.title)}</h4>
                  <div className="root-description">{renderText(jsonContent.description)}</div>
                  {jsonContent.keywords && (
                    <div className="root-keywords">
                      <strong>Keywords: </strong>{Array.isArray(jsonContent.keywords) ? jsonContent.keywords.join(', ') : renderText(jsonContent.keywords)}
                    </div>
                  )}
                </div>
              );
            case 'EVIDENCE': {
              const srcUrl = jsonContent.source || '';
              const ytMatch = srcUrl.match?.(YT_REGEX);
              return (
                <div className="evidence-content">
                  <div className="evidence-point">{renderText(jsonContent.point)}</div>
                  {ytMatch ? (
                    <div className="sidebar-youtube">
                      <iframe
                        src={`https://www.youtube.com/embed/${ytMatch[1]}`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        title={`yt-${ytMatch[1]}`}
                      />
                    </div>
                  ) : (
                    <p className="evidence-source"><em>Source: {
                      /^https?:\/\//.test(srcUrl)
                        ? <a href={srcUrl} target="_blank" rel="noopener noreferrer">{srcUrl}</a>
                        : renderText(srcUrl)
                    }</em></p>
                  )}
                </div>
              );
            }
            case 'EXAMPLE':
              return (
                <div className="example-content">
                  <h4 className="example-title">{renderText(jsonContent.title)}</h4>
                  <div className="example-description">{renderText(jsonContent.description)}</div>
                </div>
              );
            case 'COUNTERPOINT':
              return (
                <div className="counterpoint-content">
                  <h4 className="counterpoint-argument">{renderText(jsonContent.argument)}</h4>
                  <div className="counterpoint-explanation">{renderText(jsonContent.explanation)}</div>
                </div>
              );
          }
        }
      }

      // Plain text or HTML string
      const textContent = typeof actualContent === 'object' ?
        JSON.stringify(actualContent, null, 2) : String(actualContent);
      if (/<[a-z][\s\S]*>/i.test(textContent)) {
        return <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(textContent) }} />;
      }
      return <ReactMarkdown components={mdComponents as any}>{textContent}</ReactMarkdown>;
    } catch (e) {
      return 'Error displaying content';
    }
  };

  return (
    <div className={`thread-graph ${isMatteMode ? 'matte' : ''}`}>
      <div className="graph-container">
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClickHandler}
          onNodeDoubleClick={onNodeDoubleClickHandler}
          onNodeDragStop={handleNodeDragStop}
          onNodeMouseEnter={(_: any, node: any) => {
            if (!showAllSecondary && node.data.isRoot) setHoveredRootId(node.id);
          }}
          onNodeMouseLeave={() => setHoveredRootId(null)}
          nodeTypes={nodeTypes}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          style={{ background: '#1d1d1d' }}
        >
          <Background
            variant={isDottedBackground ? 'dots' as any : 'lines' as any}
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

      <div className={`content-sidebar ${selectedNode ? 'open' : ''}`}>
        {selectedNode && (
          <>
            <div className="content-sidebar-header">
              {selectedNode.type !== 'thread' && (
                <button
                  className="back-button"
                  onClick={() => {
                    if (selectedNode.parent_id) {
                      const parentNode = threads[0].nodes.find(n => n.id === selectedNode.parent_id);
                      if (parentNode) { handleNodeClick(parentNode); return; }
                    }
                    const thread = threads[0];
                    handleNodeClick({
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
                  ? (selectedNode.originalData?.metadata?.title || selectedNode.originalData?.title || selectedNode.title || `Thread ${selectedNode.id}`)
                  : (selectedNode.metadata?.title || selectedNode.title || `Node ${selectedNode.id}`)}
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
                <button
                  className="add-node-button"
                  onClick={() => onOpenEditor && onOpenEditor(selectedNode)}
                >
                  Add Node
                </button>
                <button className="content-sidebar-close" onClick={closeContentSidebar}>&times;</button>
              </div>
            </div>
            <div className="content-sidebar-body">
              <div className="child-nodes-list">
                <h3>Connected Nodes</h3>
                {getChildNodes(`${selectedNode.type === 'thread' ? 'thread-' : 'node-'}${selectedNode.id}`).length > 0 ? (
                  <div className="nodes-grid">
                    {getChildNodes(`${selectedNode.type === 'thread' ? 'thread-' : 'node-'}${selectedNode.id}`).map((node: any) => (
                      <div
                        key={node.id}
                        className="node-card"
                        onClick={() => handleChildNodeClick(node)}
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

              <div className="content-sidebar-metadata">
                <div
                  className="type-badge"
                  style={{ backgroundColor: getNodeTypeBadgeColor(selectedNode.type) }}
                >
                  {selectedNode.type === 'thread' ? 'THREAD' : NODE_TYPES[selectedNode.type]}
                </div>
                <div className="voting-stats">
                  <div className="stat">
                    <label>Votes For:</label>
                    <span>{selectedNode.votesFor || '0'}</span>
                  </div>
                  <div className="stat">
                    <label>Votes Against:</label>
                    <span>{selectedNode.votesAgainst || '0'}</span>
                  </div>
                </div>
              </div>

              <div className="content-sidebar-content">
                {formatContent(selectedNode.content, selectedNode.type === 'thread' ? 'thread' : NODE_TYPES[selectedNode.type])}
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
        )}
      </div>
    </div>
  );
};

export default ThreadGraph;
