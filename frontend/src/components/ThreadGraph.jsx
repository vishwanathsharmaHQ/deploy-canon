import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
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
import './ThreadGraph.css';
import { api } from '../services/api';

const NODE_TYPE_LABELS = [
  'ROOT', 'EVIDENCE', 'REFERENCE', 'CONTEXT', 'EXAMPLE', 'COUNTERPOINT', 'SYNTHESIS'
];

const NODE_COLORS = {
  ROOT: '#ffd700',
  EVIDENCE: '#ff6b6b',
  REFERENCE: '#4ecdc4',
  CONTEXT: '#45b7d1',
  EXAMPLE: '#96ceb4',
  COUNTERPOINT: '#ff7f50',
  SYNTHESIS: '#9b59b6',
  thread: '#00ff9d'
};

// Custom node component
function GraphNode({ data }) {
  const color = data.nodeColor || '#666';
  const isThread = data.isThread;
  const radius = isThread ? 25 : 15;
  const matteClass = data.isMatteMode ? 'matte' : '';

  return (
    <div
      className={`graph-node ${matteClass} ${isThread ? 'thread-node' : ''}`}
      style={{ position: 'relative', width: radius * 2, height: radius * 2 }}
    >
      <Handle type="target" position={Position.Top} id="t-top" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Bottom} id="t-bottom" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Left} id="t-left" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Right} id="t-right" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Top} id="s-top" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Bottom} id="s-bottom" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Left} id="s-left" style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Right} id="s-right" style={{ opacity: 0, pointerEvents: 'none' }} />
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
      <div className="graph-node-label">
        {data.label}
      </div>
    </div>
  );
}

const nodeTypes = { graphNode: GraphNode };

const ThreadGraph = ({ threads, onNodeClick: _onNodeClick, onAddNode, onOpenEditor, onSelectedNodeChange, loading: parentLoading }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isMatteMode, setIsMatteMode] = useState(true);
  const [isDottedBackground, setIsDottedBackground] = useState(true);
  const [layoutLoading, setLayoutLoading] = useState(false);
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (parentLoading !== undefined) {
      setLoading(parentLoading);
    }
  }, [parentLoading]);

  // Pick best handle pair based on relative positions of source & target
  function getBestHandles(srcPos, tgtPos) {
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
  const savedLayoutRef = useRef(null);
  const lastThreadIdRef = useRef(null);
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
  const buildGraph = useCallback((threadList, savedData) => {
    if (!threadList || threadList.length === 0) return;

    // Also preserve current positions of existing nodes (for when data refreshes after adding a node)
    const currentPosMap = {};
    nodes.forEach(n => { currentPosMap[n.id] = n.position; });

    const rfNodes = [];
    const rfEdges = [];
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
          nodeColor: NODE_COLORS.thread,
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
          NODE_TYPE_LABELS.indexOf(node.node_type);
        const typeLabel = NODE_TYPE_LABELS[nodeType] || '';
        const color = NODE_COLORS[typeLabel] || '#666';

        // Parse content
        let parsedContent = node.content;
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

        let position;
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

        rfNodes.push({
          id: nodeId,
          type: 'graphNode',
          position,
          data: {
            label: typeLabel,
            isThread: false,
            nodeColor: color,
            isMatteMode,
            originalData: { ...node, type: nodeType, content: parsedContent }
          },
          draggable: true,
        });
      });

      // Build edges with best handle pairs based on positions
      const posMap = {};
      rfNodes.forEach(n => { posMap[n.id] = n.position; });

      thread.nodes?.forEach(node => {
        let sourceId, targetId;
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
  }, [nodes, isMatteMode]);

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

  const handleNodeClick = useCallback((node) => {
    setSelectedNode(node);
    // Notify parent of selected node id (null for thread-level, numeric id for nodes)
    if (onSelectedNodeChange) {
      onSelectedNodeChange(node?.type === 'thread' ? null : node?.id ?? null);
    }
  }, [onSelectedNodeChange]);

  const onNodeClickHandler = useCallback((event, rfNode) => {
    handleNodeClick(rfNode.data.originalData);
  }, [handleNodeClick]);

  const closeContentSidebar = () => {
    setSelectedNode(null);
    if (onSelectedNodeChange) onSelectedNodeChange(null);
  };

  const getChildNodes = (nodeId) => {
    if (!threads.length) return [];
    const thread = threads[0];
    if (nodeId.startsWith('thread-')) {
      return (thread.nodes || []).filter(node => !node.parentId);
    } else {
      const nodeIdNumber = parseInt(nodeId.replace('node-', ''));
      return (thread.nodes || []).filter(node => node.parentId === nodeIdNumber);
    }
  };

  const handleChildNodeClick = (node) => {
    handleNodeClick(node);
  };

  const getNodeTypeBadgeColor = (type) => {
    if (type === 'thread') return NODE_COLORS.thread;
    return NODE_COLORS[NODE_TYPE_LABELS[type]] || '#666';
  };

  // Save layout (also updates the ref so rebuilds preserve positions)
  const layoutSaveTimer = useRef(null);
  const saveCurrentLayout = useCallback(async () => {
    if (!threads || threads.length === 0) return;
    const threadId = threads[0].id;
    const currentLayout = {
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

  // Render a string that may contain HTML tags
  const renderText = (text) => {
    if (!text) return null;
    const str = String(text);
    if (/<[a-z][\s\S]*>/i.test(str)) {
      return <span dangerouslySetInnerHTML={{ __html: str }} />;
    }
    return str;
  };

  const formatContent = (content, nodeType) => {
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
            case 'EVIDENCE':
              return (
                <div className="evidence-content">
                  <div className="evidence-point">{renderText(jsonContent.point)}</div>
                  <p className="evidence-source"><em>Source: {renderText(jsonContent.source)}</em></p>
                </div>
              );
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
        return <div dangerouslySetInnerHTML={{ __html: textContent }} />;
      }
      return textContent.split('\n').map((paragraph, index) => (
        <p key={index} className="content-paragraph">{paragraph}</p>
      ));
    } catch (e) {
      return 'Error displaying content';
    }
  };

  return (
    <div className={`thread-graph ${isMatteMode ? 'matte' : ''}`}>
      <div className={`graph-container ${selectedNode ? 'with-sidebar' : ''}`}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClickHandler}
          onNodeDragStop={handleNodeDragStop}
          nodeTypes={nodeTypes}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          style={{ background: '#1d1d1d' }}
        >
          <Background
            variant={isDottedBackground ? 'dots' : 'lines'}
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
                    if (selectedNode.parentId) {
                      const parentNode = threads[0].nodes.find(n => n.id === selectedNode.parentId);
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
                    {getChildNodes(`${selectedNode.type === 'thread' ? 'thread-' : 'node-'}${selectedNode.id}`).map(node => (
                      <div
                        key={node.id}
                        className="node-card"
                        onClick={() => handleChildNodeClick(node)}
                      >
                        <div
                          className="node-card-type"
                          style={{ backgroundColor: NODE_COLORS[NODE_TYPE_LABELS[node.type]] }}
                        >
                          {NODE_TYPE_LABELS[node.type]}
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
                  {selectedNode.type === 'thread' ? 'THREAD' : NODE_TYPE_LABELS[selectedNode.type]}
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
                {formatContent(selectedNode.content, selectedNode.type === 'thread' ? 'thread' : NODE_TYPE_LABELS[selectedNode.type])}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ThreadGraph;
