import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import './ThreadGraph.css';

const NODE_TYPES = [
  { value: 0, label: 'EVIDENCE' },
  { value: 1, label: 'REFERENCE' },
  { value: 2, label: 'CONTEXT' },
  { value: 3, label: 'EXAMPLE' },
  { value: 4, label: 'COUNTERPOINT' },
  { value: 5, label: 'SYNTHESIS' }
];

const NODE_COLORS = {
  EVIDENCE: '#ff6b6b',
  REFERENCE: '#4ecdc4',
  CONTEXT: '#45b7d1',
  EXAMPLE: '#96ceb4',
  COUNTERPOINT: '#ff7f50',
  SYNTHESIS: '#9b59b6',
  thread: '#00ff9d'
};

const ThreadGraph = ({ threads, onNodeClick: _onNodeClick, onAddNode, loading: parentLoading }) => {
  const svgRef = useRef();
  const [selectedNode, setSelectedNode] = useState(null);
  const [showNodeForm, setShowNodeForm] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newNodeData, setNewNodeData] = useState({
    title: '',
    description: '',
    content: '',
    type: '0'
  });

  const handleFullScreenToggle = () => {
    if (isFullScreen) {
      setIsClosing(true);
      setTimeout(() => {
        setIsFullScreen(false);
        setIsClosing(false);
      }, 300); // Match animation duration
    } else {
      setIsFullScreen(true);
    }
  };

  // Update loading state when parent loading changes
  useEffect(() => {
    if (parentLoading !== undefined) {
      setLoading(parentLoading);
    }
  }, [parentLoading]);

  const handleNodeClick = (node) => {
    setSelectedNode(node);
    setShowNodeForm(false);
    setIsFullScreen(false);
  };

  const closeContentSidebar = () => {
    setSelectedNode(null);
    setShowNodeForm(false);
    setIsFullScreen(false);
  };

  const handleAddNode = () => {
    if (onAddNode) {
      setLoading(true);
      onAddNode({
        id: selectedNode.id,
        type: 'thread',
        newNode: {
          title: newNodeData.title,
          content: newNodeData.content,
          type: Number(newNodeData.type)
        }
      });
      setShowNodeForm(false);
      setNewNodeData({
        title: '',
        description: '',
        content: '',
        type: '0'
      });
    }
  };

  const getChildNodes = (nodeId) => {
    if (!threads.length) return [];
    const thread = threads[0]; // Since we're only showing one thread at a time
    
    if (nodeId.startsWith('thread-')) {
      // For thread nodes, return all direct child nodes
      return thread.nodes || [];
    } else {
      // For other nodes, could implement child node logic here if needed
      return [];
    }
  };

  const handleChildNodeClick = (node) => {
    handleNodeClick(node);
  };

  useEffect(() => {
    if (!threads.length) return;
    setLoading(true);

    // Store previous node positions
    const prevPositions = new Map();
    d3.select(svgRef.current)
      .selectAll('.node')
      .each(function(d) {
        const transform = d3.select(this).attr('transform');
        if (transform) {
          const match = transform.match(/translate\(([^,]+),([^)]+)\)/);
          if (match) {
            prevPositions.set(d.id, {
              x: parseFloat(match[1]),
              y: parseFloat(match[2])
            });
          }
        }
      });

    // Clear any existing SVG content
    d3.select(svgRef.current).selectAll("*").remove();

    // Process data for visualization
    const nodes = [];
    const links = [];

    threads.forEach(thread => {
      // Add thread as a node
      nodes.push({
        id: `thread-${thread.id}`,
        type: 'thread',
        title: thread.metadata?.title || 'Untitled',
        description: thread.metadata?.description,
        content: thread.content?.content,
        radius: 25,
        hasVoted: thread.hasVoted,
        votesFor: thread.votesFor,
        votesAgainst: thread.votesAgainst,
        proposalDeadline: thread.proposalDeadline,
        hasActiveProposal: thread.hasActiveProposal,
        originalData: { ...thread, type: 'thread' }
      });

      // Add nodes from the thread
      thread.nodes?.forEach(node => {
        console.log('Raw node data:', node);
        const nodeType = Number(node.type);
        console.log('Converted node type:', nodeType);
        
        nodes.push({
          id: `node-${node.id}`,
          type: nodeType,
          title: node.metadata?.title || `Node ${node.id}`,
          content: node.content?.content,
          radius: 15,
          hasVoted: node.hasVoted,
          votesFor: node.votesFor,
          votesAgainst: node.votesAgainst,
          proposalDeadline: node.proposalDeadline,
          hasActiveProposal: node.hasActiveProposal,
          originalData: { ...node, type: nodeType }
        });

        // Create link between thread and node
        links.push({
          source: `thread-${thread.id}`,
          target: `node-${node.id}`,
          value: 1
        });
      });
    });

    // Restore previous positions
    nodes.forEach(node => {
      const prevPos = prevPositions.get(node.id);
      if (prevPos) {
        node.x = prevPos.x;
        node.y = prevPos.y;
        node.fx = prevPos.x;
        node.fy = prevPos.y;
      }
    });

    // Set up the SVG container with zoom functionality
    const containerWidth = selectedNode ? window.innerWidth * 0.7 : window.innerWidth;
    const width = containerWidth - 40;
    const height = 600;
    
    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    // Add zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.5, 2])
      .on('zoom', (event) => {
        const transform = d3.zoomIdentity
          .translate(event.transform.x, event.transform.y)
          .scale(event.transform.k);
        g.attr('transform', transform);
      })
      .filter(event => {
        return event.type === 'wheel' || event.target.tagName === 'circle';
      });

    svg.call(zoom);

    // Create a group for the graph
    const g = svg.append('g');

    // Fix thread node at center if no previous position
    nodes.forEach(node => {
      if (node.type === 'thread' && !prevPositions.has(node.id)) {
        node.fx = width / 2;
        node.fy = (height * 3) / 4;
      }
    });

    // Create the force simulation with reduced forces
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links)
        .id(d => d.id)
        .distance(d => d.source.type === 'thread' ? 150 : 80))
      .force('charge', d3.forceManyBody()
        .strength(d => d.type === 'thread' ? -500 : -100))
      .force('collision', d3.forceCollide()
        .radius(d => d.type === 'thread' ? d.radius * 3 : d.radius * 1.5))
      .alphaDecay(0.1) // Faster stabilization
      .velocityDecay(0.6); // More damping

    // Create the links with gradient effect
    const defs = svg.append('defs');

    // Create gradient for links
    links.forEach((link, i) => {
      const gradientId = `link-gradient-${i}`;
      const gradient = defs.append('linearGradient')
        .attr('id', gradientId)
        .attr('gradientUnits', 'userSpaceOnUse');

      gradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', '#00ff9d')
        .attr('stop-opacity', 0.2);

      gradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', '#00ff9d')
        .attr('stop-opacity', 0.1);
    });

    // Create the links
    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', (d, i) => `url(#link-gradient-${i})`)
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', 2);

    // Create glowing effect filter
    const glowFilter = defs.append('filter')
      .attr('id', 'glow-effect')
      .attr('height', '300%')
      .attr('width', '300%')
      .attr('x', '-100%')
      .attr('y', '-100%');

    glowFilter.append('feGaussianBlur')
      .attr('class', 'blur')
      .attr('stdDeviation', '3')
      .attr('result', 'coloredBlur');

    const glowMerge = glowFilter.append('feMerge');
    glowMerge.append('feMergeNode')
      .attr('in', 'coloredBlur');
    glowMerge.append('feMergeNode')
      .attr('in', 'SourceGraphic');

    // Create the nodes with enhanced effects
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('class', d => `node ${loading ? 'loading' : ''}`)
      .attr('data-type', d => d.type === 'thread' ? 'thread' : NODE_TYPES[d.type]?.label)
      .call(drag(simulation));

    // Add circles to nodes with enhanced styling
    node.append('circle')
      .attr('r', d => d.radius)
      .attr('fill', d => {
        if (d.type === 'thread') return NODE_COLORS.thread;
        return NODE_COLORS[NODE_TYPES[d.type]?.label] || '#666';
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .style('filter', 'url(#glow-effect)');

    // Add labels to nodes with enhanced styling
    node.append('text')
      .attr('dy', d => d.radius + 15)
      .attr('text-anchor', 'middle')
      .attr('class', 'node-label')
      .text(d => {
        if (d.type === 'thread') {
          const words = d.title.split(/\s+/);
          return words.length > 2 ? words.slice(0, 2).join(' ') + '...' : d.title;
        }
        return NODE_TYPES[d.type]?.label || '';
      });

    // Enhanced hover effects
    node.on('mouseover', (event, d) => {
      // Find connected nodes and links
      const connectedNodeIds = new Set();
      const connectedLinks = new Set();
      
      links.forEach(link => {
        if (link.source.id === d.id) {
          connectedNodeIds.add(link.target.id);
          connectedLinks.add(link);
        } else if (link.target.id === d.id) {
          connectedNodeIds.add(link.source.id);
          connectedLinks.add(link);
        }
      });

      // Dim unrelated nodes and links
      node.style('opacity', n => (n.id === d.id || connectedNodeIds.has(n.id)) ? 1 : 0.2)
        .select('circle')
        .style('filter', n => (n.id === d.id || connectedNodeIds.has(n.id)) ? 'url(#glow-effect)' : 'none');

      link.style('opacity', l => connectedLinks.has(l) ? 1 : 0.1)
        .attr('stroke-width', l => connectedLinks.has(l) ? 3 : 1);
    })
    .on('mouseout', () => {
      // Reset all nodes and links
      node.style('opacity', 1)
        .select('circle')
        .style('filter', 'url(#glow-effect)');
      
      link.style('opacity', 0.6)
        .attr('stroke-width', 2);
    });

    // Add tooltips
    node.append('title')
      .text(d => d.type === 'thread' ? 
        `${d.title}\n${d.description || ''}` : 
        `${d.type}\n${d.content || ''}`);

    // Add click handler
    node.on('click', (event, d) => {
      handleNodeClick(d.originalData);
    });

    // Update positions on each tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      node
        .attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // Set loading to false after simulation starts
    setTimeout(() => setLoading(false), 500);

    // Drag functionality
    function drag(simulation) {
      function dragstarted(event) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        // Only allow dragging of non-thread nodes
        if (event.subject.type !== 'thread') {
          event.subject.fx = event.subject.x;
          event.subject.fy = event.subject.y;
        }
      }

      function dragged(event) {
        // Only allow dragging of non-thread nodes
        if (event.subject.type !== 'thread') {
          event.subject.fx = event.x;
          event.subject.fy = event.y;
        }
      }

      function dragended(event) {
        if (!event.active) simulation.alphaTarget(0);
        // Only allow dragging of non-thread nodes
        if (event.subject.type !== 'thread') {
          event.subject.fx = null;
          event.subject.fy = null;
        }
      }

      return d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended);
    }

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [threads, selectedNode]);

  const getNodeTypeBadgeColor = (type) => {
    if (type === 'thread') return NODE_COLORS.thread;
    return NODE_COLORS[NODE_TYPES[type]?.label] || '#666';
  };

  return (
    <div className="thread-graph">
      <div className={`graph-container ${selectedNode ? (isFullScreen ? 'hidden' : 'with-sidebar') : ''}`}>
        <svg ref={svgRef}></svg>
      </div>
      
      <div className={`content-sidebar ${selectedNode ? (isFullScreen ? 'full-screen' : 'open') : ''} ${isClosing ? 'closing' : ''}`}>
        {selectedNode && (
          <>
            <div className="content-sidebar-header">
              {selectedNode.type !== 'thread' && (
                <button 
                  className="back-button"
                  onClick={() => {
                    const thread = threads[0];
                    handleNodeClick({ ...thread, type: 'thread' });
                  }}
                  aria-label="Back to thread"
                >
                  ←
                </button>
              )}
              <h2>{selectedNode.metadata?.title || `${selectedNode.type === 'thread' ? 'Thread' : 'Node'} ${selectedNode.id}`}</h2>
              <div className="header-actions">
                {!showNodeForm && (
                  <button 
                    className="view-mode-button"
                    onClick={handleFullScreenToggle}
                    title={isFullScreen ? "Exit full screen" : "Enter full screen"}
                    aria-label={isFullScreen ? "Exit full screen" : "Enter full screen"}
                  />
                )}
                {selectedNode.type === 'thread' && !showNodeForm && (
                  <button 
                    className="add-node-button"
                    onClick={() => setShowNodeForm(true)}
                  >
                    Add Node
                  </button>
                )}
                {showNodeForm && (
                  <button 
                    className="add-node-button"
                    onClick={() => setShowNodeForm(false)}
                  >
                    Cancel
                  </button>
                )}
                <button className="content-sidebar-close" onClick={closeContentSidebar}>×</button>
              </div>
            </div>
            <div className="content-sidebar-body">
              {showNodeForm ? (
                <div className="node-form">
                  <h3>Add New Node</h3>
                  <select
                    value={newNodeData.type}
                    onChange={(e) => setNewNodeData({ ...newNodeData, type: e.target.value })}
                    className="node-input"
                  >
                    {NODE_TYPES.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Title"
                    value={newNodeData.title}
                    onChange={(e) => setNewNodeData({ ...newNodeData, title: e.target.value })}
                    className="node-input"
                  />
                  <textarea
                    placeholder="Description"
                    value={newNodeData.description}
                    onChange={(e) => setNewNodeData({ ...newNodeData, description: e.target.value })}
                    className="node-input"
                    rows={3}
                  />
                  <textarea
                    placeholder="Content"
                    value={newNodeData.content}
                    onChange={(e) => setNewNodeData({ ...newNodeData, content: e.target.value })}
                    className="node-input"
                    rows={6}
                  />
                  <button 
                    className="submit-button"
                    onClick={handleAddNode}
                    disabled={!newNodeData.title || !newNodeData.content}
                  >
                    Add Node
                  </button>
                </div>
              ) : (
                <>
                  {selectedNode.type === 'thread' && (
                    <div className="child-nodes-list">
                      <h3>Connected Nodes</h3>
                      {getChildNodes(`thread-${selectedNode.id}`).length > 0 ? (
                        <div className="nodes-grid">
                          {getChildNodes(`thread-${selectedNode.id}`).map(node => (
                            <div 
                              key={node.id}
                              className="node-card"
                              onClick={() => handleChildNodeClick(node)}
                            >
                              <div 
                                className="node-card-type"
                                style={{ 
                                  backgroundColor: NODE_COLORS[NODE_TYPES[node.type]?.label]
                                }}
                              >
                                {NODE_TYPES[node.type]?.label}
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
                  )}

                  <div className="content-sidebar-metadata">
                    <div 
                      className="type-badge"
                      style={{ 
                        backgroundColor: getNodeTypeBadgeColor(selectedNode.type)
                      }}
                    >
                      {selectedNode.type === 'thread' ? 'THREAD' : NODE_TYPES[selectedNode.type]?.label}
                    </div>
                    {selectedNode.metadata?.description && (
                      <p>{selectedNode.metadata.description}</p>
                    )}
                    
                    <div className="voting-stats">
                      <div className="stat">
                        <label>Votes For:</label>
                        <span>{selectedNode.votesFor || '0'}</span>
                      </div>
                      <div className="stat">
                        <label>Votes Against:</label>
                        <span>{selectedNode.votesAgainst || '0'}</span>
                      </div>
                      {selectedNode.proposalDeadline > 0 && (
                        <div className="stat">
                          <label>Proposal Deadline:</label>
                          <span>{new Date(selectedNode.proposalDeadline * 1000).toLocaleString()}</span>
                        </div>
                      )}
                      {selectedNode.hasActiveProposal && (
                        <div className="proposal-badge">
                          Active Proposal
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="content-sidebar-content">
                    {selectedNode.content?.content || 'No content available'}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ThreadGraph; 