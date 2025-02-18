import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import './ThreadGraph.css';
import { api } from '../services/api';

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
  const toolbarRef = useRef();
  const [selectedNode, setSelectedNode] = useState(null);
  const [showNodeForm, setShowNodeForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [areNodesFixed, setAreNodesFixed] = useState(false);
  const [forceStrength, setForceStrength] = useState(-100);
  const [linkDistance, setLinkDistance] = useState(80);
  const [collisionRadius, setCollisionRadius] = useState(1.5);
  const [centerForce, setCenterForce] = useState(0.1);
  const [animationSpeed, setAnimationSpeed] = useState(0.1);
  const [damping, setDamping] = useState(0.6);
  const [linkOpacity, setLinkOpacity] = useState(0.6);
  const [linkWidth, setLinkWidth] = useState(2);
  const [nodeSize, setNodeSize] = useState(1);
  const [newNodeData, setNewNodeData] = useState({
    title: '',
    description: '',
    content: '',
    type: '0'
  });
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(true);
  const [isMatteMode, setIsMatteMode] = useState(false);
  const [isDottedMode, setIsDottedMode] = useState(false);
  const [isDottedBackground, setIsDottedBackground] = useState(false);
  const [fixedNodes, setFixedNodes] = useState(new Set());
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [isGeneratingSuggestions, setIsGeneratingSuggestions] = useState(false);
  const [currentTransform, setCurrentTransform] = useState(null);

  const presets = {
    default: {
      forceStrength: -300,
      linkDistance: 150,
      collisionRadius: 2,
      centerForce: 0.1,
      animationSpeed: 0.1,
      damping: 0.6,
      linkOpacity: 0.6,
      linkWidth: 2,
      nodeSize: 1
    },
    compact: {
      forceStrength: -150,
      linkDistance: 80,
      collisionRadius: 1.5,
      centerForce: 0.2,
      animationSpeed: 0.15,
      damping: 0.7,
      linkOpacity: 0.7,
      linkWidth: 1.5,
      nodeSize: 0.8
    },
    spread: {
      forceStrength: -400,
      linkDistance: 200,
      collisionRadius: 2.5,
      centerForce: 0.05,
      animationSpeed: 0.08,
      damping: 0.5,
      linkOpacity: 0.5,
      linkWidth: 2.5,
      nodeSize: 1.2
    }
  };

  const applyPreset = (presetName) => {
    const preset = presets[presetName];
    setForceStrength(preset.forceStrength);
    setLinkDistance(preset.linkDistance);
    setCollisionRadius(preset.collisionRadius);
    setCenterForce(preset.centerForce);
    setAnimationSpeed(preset.animationSpeed);
    setDamping(preset.damping);
    setLinkOpacity(preset.linkOpacity);
    setLinkWidth(preset.linkWidth);
    setNodeSize(preset.nodeSize);
  };

  // Update loading state when parent loading changes
  useEffect(() => {
    if (parentLoading !== undefined) {
      setLoading(parentLoading);
    }
  }, [parentLoading]);

  const handleNodeClick = (node) => {
    console.log('Node clicked:', node);
    console.log('Node content:', node.content);
    setSelectedNode(node);
    setShowNodeForm(false);
  };

  const closeContentSidebar = () => {
    setSelectedNode(null);
    setShowNodeForm(false);
  };

  const handleAddNode = () => {
    if (onAddNode) {
      setLoading(true);
      console.log('Adding node with data:', newNodeData);
      
      // Structure content based on node type
      let structuredContent;
      let shortDescription;
      
      switch (NODE_TYPES[Number(newNodeData.type)].label) {
        case 'EVIDENCE':
          structuredContent = JSON.stringify({
            point: newNodeData.content,
            source: newNodeData.title
          });
          shortDescription = newNodeData.content.substring(0, 100);
          break;
        
        case 'EXAMPLE':
          structuredContent = JSON.stringify({
            title: newNodeData.title,
            description: newNodeData.content
          });
          shortDescription = newNodeData.content.substring(0, 100);
          break;
        
        case 'COUNTERPOINT':
          structuredContent = JSON.stringify({
            argument: newNodeData.title,
            explanation: newNodeData.content
          });
          shortDescription = newNodeData.title;
          break;
        
        default:
          structuredContent = newNodeData.content;
          shortDescription = newNodeData.content.substring(0, 100);
      }

      // Add ellipsis if description was truncated
      if (shortDescription.length === 100) {
        shortDescription += '...';
      }

      onAddNode({
        id: selectedNode.id,
        type: selectedNode.type,
        newNode: {
          title: newNodeData.title,
          content: structuredContent,
          description: shortDescription,
          type: Number(newNodeData.type),
          parentId: selectedNode.id,
          threadId: threads[0].id,
          metadata: {
            title: newNodeData.title || 'New Node',
            description: shortDescription,
            content: structuredContent,
            type: NODE_TYPES[Number(newNodeData.type)].label
          }
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
      // For thread nodes, return all direct child nodes that don't have a parentId
      return (thread.nodes || []).filter(node => !node.parentId);
    } else {
      // For other nodes, return all nodes that have this node as parent
      const nodeIdNumber = parseInt(nodeId.replace('node-', ''));
      return (thread.nodes || []).filter(node => node.parentId === nodeIdNumber);
    }
  };

  const handleChildNodeClick = (node) => {
    handleNodeClick(node);
  };

  useEffect(() => {
    if (!threads || threads.length === 0 || loading) return;

    // Store previous positions and current transform
    const prevPositions = new Map();
    const prevTransform = currentTransform;
    d3.select(svgRef.current)
      .selectAll('.node')
      .each(function(d) {
        prevPositions.set(d.id, { x: d.x, y: d.y });
      });

    // Clear the SVG
    d3.select(svgRef.current).selectAll('*').remove();

    const nodes = [];
    const links = [];

    threads.forEach(thread => {
      // Add thread as a node
      const threadTitle = thread.metadata?.title || thread.title || `Thread ${thread.id}`;
      nodes.push({
        id: `thread-${thread.id}`,
        type: 'thread',
        title: threadTitle,
        description: thread.metadata?.description || thread.description || '',
        content: thread.content?.content || thread.content || '',
        radius: 25,
        hasVoted: thread.hasVoted || false,
        votesFor: thread.votesFor || 0,
        votesAgainst: thread.votesAgainst || 0,
        proposalDeadline: thread.proposalDeadline || 0,
        hasActiveProposal: thread.hasActiveProposal || false,
        originalData: { 
          ...thread, 
          type: 'thread',
          title: threadTitle,
          metadata: {
            ...thread.metadata,
            title: threadTitle
          }
        }
      });

      // Add nodes from the thread
      thread.nodes?.forEach(node => {
        console.log('Raw node data:', node);
        const nodeType = typeof node.type === 'number' ? node.type : 
                        NODE_TYPES.findIndex(t => t.label === node.node_type);
        console.log('Converted node type:', nodeType);
        
        // Parse content if it's a JSON string
        let parsedContent = node.content;
        try {
          if (typeof node.content === 'string' && 
              (node.content.startsWith('{') || node.content.startsWith('['))) {
            parsedContent = JSON.parse(node.content);
          }
        } catch (e) {
          console.error('Failed to parse node content:', e);
        }
        
        nodes.push({
          id: `node-${node.id}`,
          type: nodeType,
          title: node.metadata?.title || `Node ${node.id}`,
          content: parsedContent,
          radius: 15,
          hasVoted: node.hasVoted,
          votesFor: node.votesFor,
          votesAgainst: node.votesAgainst,
          proposalDeadline: node.proposalDeadline,
          hasActiveProposal: node.hasActiveProposal,
          originalData: { ...node, type: nodeType }
        });
      });

      // Create links after all nodes are created
      thread.nodes?.forEach(node => {
        if (node.parent_id) {
          // Check if parent node exists before creating link
          const parentExists = nodes.some(n => n.id === `node-${node.parent_id}`);
          if (parentExists) {
            links.push({
              source: `node-${node.parent_id}`,
              target: `node-${node.id}`,
              value: 1
            });
          } else {
            // If parent doesn't exist, connect to thread instead
            links.push({
              source: `thread-${thread.id}`,
              target: `node-${node.id}`,
              value: 1
            });
          }
        } else {
          // If no parent_id, connect to thread
          links.push({
            source: `thread-${thread.id}`,
            target: `node-${node.id}`,
            value: 1
          });
        }
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

    // Create a group for the graph that will be transformed
    const g = svg.append('g');

    // Add zoom behavior with transform preservation
    const zoom = d3.zoom()
      .scaleExtent([0.5, 2])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        setCurrentTransform(event.transform);
      })
      .filter(event => {
        return event.type === 'wheel' || event.target.tagName === 'circle';
      });

    svg.call(zoom);

    // If we have a previous transform, restore it
    if (prevTransform) {
      svg.call(zoom.transform, prevTransform);
    }

    // Fix thread node at center if no previous position
    nodes.forEach(node => {
      if (node.type === 'thread') {
        if (!prevPositions.has(node.id)) {
          node.fx = width / 2;
          node.fy = (height * 3) / 4;
        }
      }
    });

    // Create the force simulation with all forces
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links)
        .id(d => d.id)
        .distance(d => d.source.type === 'thread' ? linkDistance * 2 : linkDistance))
      .force('charge', d3.forceManyBody()
        .strength(d => d.type === 'thread' ? forceStrength * 5 : forceStrength))
      .force('collision', d3.forceCollide()
        .radius(d => d.type === 'thread' ? d.radius * 4 : d.radius * nodeSize * collisionRadius))
      .force('center', d3.forceCenter(width / 2, height / 2)
        .strength(centerForce))
      .alphaDecay(animationSpeed)
      .velocityDecay(damping);

    // Restart simulation with a higher alpha to make changes more visible
    simulation.alpha(0.5).restart();

    // Update node positions based on areNodesFixed state
    if (areNodesFixed) {
      nodes.forEach(node => {
        if (node.x && node.y) {
          node.fx = node.x;
          node.fy = node.y;
        }
      });
    } else {
      nodes.forEach(node => {
        if (node.type !== 'thread') {
          node.fx = null;
          node.fy = null;
        }
      });
    }

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
      .attr('stroke-opacity', linkOpacity)
      .attr('stroke-width', linkWidth);

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
      .attr('r', d => d.type === 'thread' ? d.radius : d.radius * nodeSize)
      .attr('fill', d => {
        if (d.type === 'thread') return NODE_COLORS.thread;
        return NODE_COLORS[NODE_TYPES[d.type]?.label] || '#666';
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .style('filter', 'url(#glow-effect)');

    // Add labels to nodes with enhanced styling
    node.append('text')
      .attr('dy', d => d.type === 'thread' ? d.radius + 25 : d.radius + 20)
      .attr('text-anchor', 'middle')
      .attr('class', 'node-label')
      .text(d => {
        if (d.type === 'thread') {
          const threadTitle = d.originalData?.metadata?.title || d.originalData?.title || d.title || 'Untitled';
          const words = (threadTitle || '').split(/\s+/);
          return words.length > 2 ? words.slice(0, 2).join(' ') + '...' : threadTitle;
        }
        return NODE_TYPES[d.type]?.label || '';
      })
      .each(function(d) {
        const bbox = this.getBBox();
        const padding = 4;
        
        d3.select(this.parentNode)
          .insert('rect', 'text')
          .attr('x', bbox.x - padding)
          .attr('y', bbox.y - padding)
          .attr('width', bbox.width + (padding * 2))
          .attr('height', bbox.height + (padding * 2))
          .attr('rx', 4)
          .attr('fill', 'rgba(0, 0, 0, 0.5)')
          .attr('class', 'label-background');
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
        .attr('y2', d => d.target.y)
        .attr('stroke-width', linkWidth)
        .attr('stroke-opacity', linkOpacity);

      node
        .attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // Set loading to false after simulation starts
    setTimeout(() => setLoading(false), 500);

    // Drag functionality
    function drag(simulation) {
      function dragstarted(event) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      }

      function dragged(event) {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      }

      function dragended(event) {
        if (!event.active) simulation.alphaTarget(0);
        if (!areNodesFixed && !fixedNodes.has(event.subject.id)) {
          event.subject.fx = null;
          event.subject.fy = null;
        }
      }

      return d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended);
    }

    // Add double-click handler for fixing individual nodes
    node.on('dblclick', (event, d) => {
      event.stopPropagation();
      const nodeId = d.id;
      const newFixedNodes = new Set(fixedNodes);
      
      if (fixedNodes.has(nodeId)) {
        newFixedNodes.delete(nodeId);
        d.fx = null;
        d.fy = null;
      } else {
        newFixedNodes.add(nodeId);
        d.fx = d.x;
        d.fy = d.y;
      }
      
      setFixedNodes(newFixedNodes);
      simulation.alpha(0.3).restart();
    });

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [threads, loading, selectedNode, areNodesFixed, fixedNodes, forceStrength, linkDistance, 
      collisionRadius, centerForce, animationSpeed, damping, linkOpacity, linkWidth, nodeSize]);

  const getNodeTypeBadgeColor = (type) => {
    if (type === 'thread') return NODE_COLORS.thread;
    return NODE_COLORS[NODE_TYPES[type]?.label] || '#666';
  };

  // Add click outside handler
  useEffect(() => {
    function handleClickOutside(event) {
      if (toolbarRef.current && !toolbarRef.current.contains(event.target)) {
        setIsToolbarCollapsed(true);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Update saveCurrentLayout function
  const saveCurrentLayout = async () => {
    if (!threads || threads.length === 0) return;
    
    const threadId = threads[0].id;
    const currentLayout = {
      nodes: {},
      settings: {
        areNodesFixed,
        forceStrength,
        linkDistance,
        collisionRadius,
        centerForce,
        animationSpeed,
        damping,
        linkOpacity,
        linkWidth,
        nodeSize,
        isMatteMode,
        fixedNodes: Array.from(fixedNodes)
      }
    };
    
    d3.select(svgRef.current)
      .selectAll('.node')
      .each(function(d) {
        currentLayout.nodes[d.id] = {
          x: d.x,
          y: d.y,
          fixed: fixedNodes.has(d.id)
        };
      });

    console.log('Saving layout and settings for thread:', threadId);
    console.log('Layout data:', currentLayout);

    try {
      setLayoutLoading(true);
      const response = await api.saveThreadLayout(threadId, currentLayout);
      console.log('Layout and settings saved successfully:', response);
      
      // Show success feedback
      const nodes = d3.select(svgRef.current).selectAll('.node');
      nodes.classed('saved', true);
      setTimeout(() => nodes.classed('saved', false), 1000);
    } catch (error) {
      console.error('Failed to save layout:', error);
    } finally {
      setLayoutLoading(false);
    }
  };

  // Update loadSavedLayout function
  const loadSavedLayout = async () => {
    if (!threads || threads.length === 0) return;
    
    const threadId = threads[0].id;
    console.log('Loading layout and settings for thread:', threadId);
    
    try {
      setLayoutLoading(true);
      const savedData = await api.loadThreadLayout(threadId);
      console.log('Loaded data:', savedData);
      
      if (!savedData || !savedData.nodes) {
        console.log('No saved layout found');
        return;
      }

      // Load settings first
      if (savedData.settings) {
        setAreNodesFixed(savedData.settings.areNodesFixed);
        setForceStrength(savedData.settings.forceStrength);
        setLinkDistance(savedData.settings.linkDistance);
        setCollisionRadius(savedData.settings.collisionRadius);
        setCenterForce(savedData.settings.centerForce);
        setAnimationSpeed(savedData.settings.animationSpeed);
        setDamping(savedData.settings.damping);
        setLinkOpacity(savedData.settings.linkOpacity);
        setLinkWidth(savedData.settings.linkWidth);
        setNodeSize(savedData.settings.nodeSize);
        setIsMatteMode(savedData.settings.isMatteMode);
        setFixedNodes(new Set(savedData.settings.fixedNodes || []));
      }

      // Get the simulation and nodes
      const simulation = d3.select(svgRef.current).select('g').datum();
      const nodes = d3.select(svgRef.current).selectAll('.node');
      
      if (!nodes.size()) {
        console.log('No nodes found in the DOM yet, positions will be applied in useEffect');
        return;
      }

      // Load node positions
      const newFixedNodes = new Set(savedData.settings?.fixedNodes || []);
      
      nodes.each(function(d) {
        if (!d || !d.id) {
          console.log('Invalid node data:', d);
          return;
        }

        const savedPos = savedData.nodes[d.id];
        if (savedPos) {
          console.log('Applying saved position for node:', d.id, savedPos);
          d.x = savedPos.x;
          d.y = savedPos.y;
          if (savedPos.fixed) {
            d.fx = savedPos.x;
            d.fy = savedPos.y;
            newFixedNodes.add(d.id);
          } else {
            d.fx = null;
            d.fy = null;
          }
        }
      });

      console.log('Fixed nodes after loading:', Array.from(newFixedNodes));
      setFixedNodes(newFixedNodes);

      // Restart simulation with loaded positions if available
      if (simulation) {
        simulation.alpha(0.3).restart();
      }
    } catch (error) {
      console.error('Failed to load layout:', error);
    } finally {
      setLayoutLoading(false);
    }
  };

  // Update resetLayout function
  const resetLayout = async () => {
    if (!threads || threads.length === 0) return;
    
    const threadId = threads[0].id;
    
    try {
      setLayoutLoading(true);
      await api.deleteThreadLayout(threadId);
      
      // Reset all settings to defaults
      setAreNodesFixed(false);
      setForceStrength(-100);
      setLinkDistance(80);
      setCollisionRadius(1.5);
      setCenterForce(0.1);
      setAnimationSpeed(0.1);
      setDamping(0.6);
      setLinkOpacity(0.6);
      setLinkWidth(2);
      setNodeSize(1);
      setIsMatteMode(false);
      setFixedNodes(new Set());
      
      // Reset node positions
      d3.select(svgRef.current)
        .selectAll('.node')
        .each(function(d) {
          d.fx = null;
          d.fy = null;
        });
    } catch (error) {
      console.error('Failed to reset layout:', error);
    } finally {
      setLayoutLoading(false);
    }
  };

  // Add effect to load layout when thread changes
  useEffect(() => {
    if (threads && threads.length > 0) {
      loadSavedLayout(); // Load layout whenever threads change
    }
  }, [threads]);

  const generateSuggestions = async () => {
    if (!selectedNode || !threads || threads.length === 0) return;
    
    console.log('Selected Node:', selectedNode);
    
    setIsGeneratingSuggestions(true);
    try {
      // Get thread ID from the selected node or find it in threads
      let threadId;
      if (selectedNode.type === 'thread') {
        threadId = selectedNode.id;
      } else {
        // Find the thread that contains this node
        const thread = threads.find(t => 
          t.nodes?.some(n => n.id === selectedNode.id)
        );
        if (!thread) {
          throw new Error('Could not find thread for selected node');
        }
        threadId = thread.id;
      }

      const response = await api.generateNodeSuggestions({
        nodeId: selectedNode.id,
        nodeType: selectedNode.type === 'thread' ? 'thread' : NODE_TYPES[selectedNode.type]?.label,
        content: selectedNode.content,
        title: selectedNode.title
      });
      
      // Create nodes for each suggestion sequentially
      for (const suggestion of response.suggestions) {
        try {
          // Structure content based on node type
          let structuredContent;
          let shortDescription;
          
          switch (suggestion.type) {
            case 'EVIDENCE':
              structuredContent = JSON.stringify({
                point: suggestion.content,
                source: suggestion.title
              });
              shortDescription = suggestion.content.substring(0, 100);
              break;
            
            case 'EXAMPLE':
              structuredContent = JSON.stringify({
                title: suggestion.title,
                description: suggestion.content
              });
              shortDescription = suggestion.content.substring(0, 100);
              break;
            
            case 'COUNTERPOINT':
              structuredContent = JSON.stringify({
                argument: suggestion.title,
                explanation: suggestion.content
              });
              shortDescription = suggestion.title;
              break;
            
            default:
              structuredContent = suggestion.content;
              shortDescription = suggestion.content.substring(0, 100);
          }

          // Add ellipsis if description was truncated
          if (shortDescription.length === 100) {
            shortDescription += '...';
          }

          // Create the node and wait for it to complete
          if (onAddNode) {
            await onAddNode({
              id: selectedNode.id,
              type: selectedNode.type,
              newNode: {
                title: suggestion.title,
                content: structuredContent,
                description: shortDescription,
                type: NODE_TYPES.findIndex(t => t.label === suggestion.type),
                parentId: selectedNode.id,
                threadId: threadId,
                metadata: {
                  title: suggestion.title,
                  description: shortDescription,
                  content: structuredContent
                }
              }
            });

            // Get the latest thread data after node creation
            const { nodes, edges } = await api.getThreadNodes(threadId);
            
            // Update the local thread data with proper type conversion
            const updatedThread = {
              ...threads[0],
              nodes: nodes.map(node => {
                // Convert node_type string to numeric type index
                const nodeType = NODE_TYPES.findIndex(t => t.label === node.node_type);
                return {
                  ...node,
                  type: nodeType,
                  node_type: NODE_TYPES[nodeType]?.label, // Keep the string type as well
                  content: node.content,
                  parent_id: node.parent_id
                };
              }),
              edges
            };

            // Store previous positions
            const prevPositions = new Map();
            d3.select(svgRef.current)
              .selectAll('.node')
              .each(function(d) {
                prevPositions.set(d.id, { x: d.x, y: d.y });
              });

            // Clear the SVG
            const svg = d3.select(svgRef.current);
            svg.selectAll('*').remove();

            // Create new nodes and links arrays
            const newNodes = [];
            const newLinks = [];

            // Add thread as a node
            newNodes.push({
              id: `thread-${updatedThread.id}`,
              type: 'thread',
              title: updatedThread.metadata?.title || 'Untitled',
              description: updatedThread.metadata?.description,
              content: updatedThread.content?.content,
              radius: 25,
              originalData: { ...updatedThread, type: 'thread' }
            });

            // Add all nodes from the thread with proper type handling
            updatedThread.nodes?.forEach(node => {
              newNodes.push({
                id: `node-${node.id}`,
                type: node.type,
                nodeType: node.node_type, // Store the string type for color lookup
                title: node.metadata?.title || `Node ${node.id}`,
                content: node.content,
                radius: 15,
                originalData: { ...node }
              });

              // Create links
              if (node.parent_id) {
                newLinks.push({
                  source: `node-${node.parent_id}`,
                  target: `node-${node.id}`,
                  value: 1
                });
              } else {
                newLinks.push({
                  source: `thread-${updatedThread.id}`,
                  target: `node-${node.id}`,
                  value: 1
                });
              }
            });

            // Restore previous positions
            newNodes.forEach(node => {
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
            
            svg.attr('width', width)
               .attr('height', height);

            // Add zoom behavior
            const zoom = d3.zoom()
              .scaleExtent([0.5, 2])
              .on('zoom', (event) => {
                const transform = d3.zoomIdentity
                  .translate(event.transform.x, event.transform.y)
                  .scale(event.transform.k);
                g.attr('transform', transform);
              });

            svg.call(zoom);

            // Create a group for the graph
            const g = svg.append('g');

            // Create the force simulation
            const simulation = d3.forceSimulation(newNodes)
              .force('link', d3.forceLink(newLinks)
                .id(d => d.id)
                .distance(d => d.source.type === 'thread' ? linkDistance * 2 : linkDistance))
              .force('charge', d3.forceManyBody()
                .strength(d => d.type === 'thread' ? forceStrength * 5 : forceStrength))
              .force('collision', d3.forceCollide()
                .radius(d => d.type === 'thread' ? d.radius * 4 : d.radius * nodeSize * collisionRadius))
              .force('center', d3.forceCenter(width / 2, height / 2)
                .strength(centerForce))
              .alphaDecay(animationSpeed)
              .velocityDecay(damping);

            // Create the links
            const link = g.append('g')
              .selectAll('line')
              .data(newLinks)
              .join('line')
              .attr('stroke', '#00ff9d')
              .attr('stroke-opacity', linkOpacity)
              .attr('stroke-width', linkWidth);

            // Create the nodes
            const node = g.append('g')
              .selectAll('g')
              .data(newNodes)
              .join('g')
              .attr('class', 'node')
              .attr('data-type', d => {
                if (d.type === 'thread') return 'thread';
                return d.nodeType || NODE_TYPES[d.type]?.label;
              })
              .call(d3.drag()
                .on('start', dragstarted)
                .on('drag', dragged)
                .on('end', dragended));

            // Add circles to nodes with enhanced styling
            node.append('circle')
              .attr('r', d => d.type === 'thread' ? d.radius : d.radius * nodeSize)
              .attr('fill', d => {
                if (d.type === 'thread') return NODE_COLORS.thread;
                // Use the stored nodeType for color lookup
                return NODE_COLORS[d.nodeType] || NODE_COLORS[NODE_TYPES[d.type]?.label] || '#666';
              })
              .attr('stroke', '#fff')
              .attr('stroke-width', 2)
              .style('filter', 'url(#glow-effect)');

            // Add labels to nodes with enhanced styling
            node.append('text')
              .attr('dy', d => d.type === 'thread' ? d.radius + 25 : d.radius + 20)
              .attr('text-anchor', 'middle')
              .attr('class', 'node-label')
              .text(d => {
                if (d.type === 'thread') {
                  const threadTitle = d.originalData?.metadata?.title || d.originalData?.title || d.title || 'Untitled';
                  const words = (threadTitle || '').split(/\s+/);
                  return words.length > 2 ? words.slice(0, 2).join(' ') + '...' : threadTitle;
                }
                return NODE_TYPES[d.type]?.label || '';
              })
              .each(function(d) {
                const bbox = this.getBBox();
                const padding = 4;
                
                d3.select(this.parentNode)
                  .insert('rect', 'text')
                  .attr('x', bbox.x - padding)
                  .attr('y', bbox.y - padding)
                  .attr('width', bbox.width + (padding * 2))
                  .attr('height', bbox.height + (padding * 2))
                  .attr('rx', 4)
                  .attr('fill', 'rgba(0, 0, 0, 0.5)')
                  .attr('class', 'label-background');
              });

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
                .attr('y2', d => d.target.y)
                .attr('stroke-width', linkWidth)
                .attr('stroke-opacity', linkOpacity);

              node
                .attr('transform', d => `translate(${d.x},${d.y})`);
            });

            // Drag functions
            function dragstarted(event) {
              if (!event.active) simulation.alphaTarget(0.3).restart();
              event.subject.fx = event.subject.x;
              event.subject.fy = event.subject.y;
            }

            function dragged(event) {
              event.subject.fx = event.x;
              event.subject.fy = event.y;
            }

            function dragended(event) {
              if (!event.active) simulation.alphaTarget(0);
              if (!areNodesFixed && !fixedNodes.has(event.subject.id)) {
                event.subject.fx = null;
                event.subject.fy = null;
              }
            }

            // Fix only thread node at center if no previous position
            newNodes.forEach(node => {
              if (node.type === 'thread') {
                if (!prevPositions.has(node.id)) {
                  node.fx = width / 2;
                  node.fy = (height * 3) / 4;
                }
              } else if (!areNodesFixed && !fixedNodes.has(node.id)) {
                // Unfix non-thread nodes unless they're meant to be fixed
                node.fx = null;
                node.fy = null;
              }
            });

            // Start simulation with high alpha
            simulation.alpha(1).restart();

            // Add a small delay between node creations
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (nodeError) {
          console.error('Error creating individual node:', nodeError);
        }
      }
    } catch (error) {
      console.error('Error generating suggestions:', error);
    } finally {
      setIsGeneratingSuggestions(false);
    }
  };

  const formatContent = (content, nodeType) => {
    if (!content) return 'No content available';
    
    try {
      // If content is an object with a content property, use that
      let actualContent = content.content || content;
      
      // If actualContent is a string that looks like JSON, try to parse it
      if (typeof actualContent === 'string' && (actualContent.startsWith('{') || actualContent.startsWith('['))) {
        try {
          actualContent = JSON.parse(actualContent);
        } catch (e) {
          console.log('Failed to parse JSON content:', e);
        }
      }

      // For evidence, example, and counterpoint nodes, handle JSON content
      if (['EVIDENCE', 'EXAMPLE', 'COUNTERPOINT'].includes(nodeType)) {
        // If content is already an object (parsed JSON)
        const jsonContent = typeof actualContent === 'object' ? actualContent : 
                          typeof actualContent === 'string' && actualContent.startsWith('{') ? 
                          JSON.parse(actualContent) : null;

        if (jsonContent) {
          switch (nodeType) {
            case 'EVIDENCE':
              return (
                <div className="evidence-content">
                  <p className="evidence-point">{jsonContent.point}</p>
                  <p className="evidence-source"><em>Source: {jsonContent.source}</em></p>
                </div>
              );
            case 'EXAMPLE':
              return (
                <div className="example-content">
                  <h4 className="example-title">{jsonContent.title}</h4>
                  <p className="example-description">{jsonContent.description}</p>
                </div>
              );
            case 'COUNTERPOINT':
              return (
                <div className="counterpoint-content">
                  <h4 className="counterpoint-argument">{jsonContent.argument}</h4>
                  <p className="counterpoint-explanation">{jsonContent.explanation}</p>
                </div>
              );
          }
        }
      }

      // For non-JSON content (Summary, Context, Synthesis), format with paragraphs
      if (['SYNTHESIS', 'CONTEXT'].includes(nodeType)) {
        const textContent = typeof actualContent === 'object' ? 
                          JSON.stringify(actualContent, null, 2) : actualContent;
        return textContent.split('\n').map((paragraph, index) => (
          <p key={index} className="content-paragraph">{paragraph}</p>
        ));
      }
      
      // Default case
      const textContent = typeof actualContent === 'object' ? 
                        JSON.stringify(actualContent, null, 2) : actualContent;
      return textContent.split('\n').map((paragraph, index) => (
        <p key={index} className="content-paragraph">{paragraph}</p>
      ));
    } catch (e) {
      console.error('Error formatting content:', e);
      return 'Error displaying content';
    }
  };

  return (
    <div className={`thread-graph ${isMatteMode ? 'matte' : ''}`}>
      <div className={`graph-container ${selectedNode ? 'with-sidebar' : ''} ${isDottedBackground ? 'dotted-background' : ''}`}>
        <svg ref={svgRef} className={`thread-graph ${isMatteMode ? 'matte' : ''}`}></svg>
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
            onClick={() => {
              // Get the current simulation and nodes
              const svg = d3.select(svgRef.current);
              const nodes = svg.selectAll('.node');
              
              // Get the container dimensions
              const width = svg.node().getBoundingClientRect().width;
              const height = svg.node().getBoundingClientRect().height;
              
              // Reset all node positions with initial spread
              nodes.each(function(d) {
                d.fx = null;
                d.fy = null;
                
                if (d.type === 'thread') {
                  // Place thread node in center
                  d.x = width / 2;
                  d.y = height / 2;
                } else {
                  // Spread other nodes in a circle around the center
                  const angle = Math.random() * 2 * Math.PI;
                  const radius = 100 + Math.random() * 100; // Random radius between 100 and 200
                  d.x = width / 2 + radius * Math.cos(angle);
                  d.y = height / 2 + radius * Math.sin(angle);
                }
              });
              
              // Update the force simulation
              const simulation = d3.forceSimulation(nodes.data())
                .force('link', d3.forceLink(svg.selectAll('line').data())
                  .id(d => d.id)
                  .distance(d => d.source.type === 'thread' ? linkDistance * 2 : linkDistance))
                .force('charge', d3.forceManyBody()
                  .strength(d => d.type === 'thread' ? forceStrength * 5 : forceStrength))
                .force('collision', d3.forceCollide()
                  .radius(d => d.type === 'thread' ? d.radius * 4 : d.radius * nodeSize * collisionRadius))
                .force('center', d3.forceCenter(width / 2, height / 2)
                  .strength(centerForce))
                .alphaDecay(animationSpeed)
                .velocityDecay(damping);

              // Heat up the simulation and restart
              simulation.alpha(1).restart();

              // Update positions on each tick
              simulation.on('tick', () => {
                svg.selectAll('line')
                  .attr('x1', d => d.source.x)
                  .attr('y1', d => d.source.y)
                  .attr('x2', d => d.target.x)
                  .attr('y2', d => d.target.y);

                nodes.attr('transform', d => `translate(${d.x},${d.y})`);
              });
            }}
            title="Reset node positions"
          >
            R
          </button>
        </div>
        <div className="toolbar-container" ref={toolbarRef}>
          <div className={`graph-toolbar collapsed`}>
            <div className="toolbar-content">
              <div className="toolbar-section">
                <div className="preset-buttons">
                  <button className="toolbar-button" onClick={() => applyPreset('default')}>Default</button>
                  <button className="toolbar-button" onClick={() => applyPreset('compact')}>Compact</button>
                  <button className="toolbar-button" onClick={() => applyPreset('spread')}>Spread</button>
                </div>
                <div className="layout-buttons">
                  <button
                    className={`toolbar-button ${layoutLoading ? 'loading' : ''}`}
                    onClick={saveCurrentLayout}
                    disabled={layoutLoading}
                    title="Save current layout"
                  >
                    {layoutLoading ? '⏳' : '💾'} Save Layout
                  </button>
                  <button
                    className={`toolbar-button ${layoutLoading ? 'loading' : ''}`}
                    onClick={loadSavedLayout}
                    disabled={layoutLoading}
                    title="Load saved layout"
                  >
                    {layoutLoading ? '⏳' : '📂'} Load Layout
                  </button>
                  <button
                    className={`toolbar-button ${layoutLoading ? 'loading' : ''}`}
                    onClick={resetLayout}
                    disabled={layoutLoading}
                    title="Reset to default layout"
                  >
                    {layoutLoading ? '⏳' : '🔄'} Reset Layout
                  </button>
                </div>
                <button
                  className={`toolbar-button ${isMatteMode ? 'active' : ''}`}
                  onClick={() => setIsMatteMode(!isMatteMode)}
                >
                  {isMatteMode ? '✨ Glossy' : '◼️ Matte'}
                </button>
              </div>
              
              <div className="toolbar-section">
                <label className="toolbar-label">
                  Repulsion Force
                  <input
                    type="range"
                    min="-200"
                    max="-20"
                    value={forceStrength}
                    onChange={(e) => setForceStrength(Number(e.target.value))}
                    className="toolbar-slider"
                  />
                </label>
                
                <label className="toolbar-label">
                  Link Distance
                  <input
                    type="range"
                    min="30"
                    max="200"
                    value={linkDistance}
                    onChange={(e) => setLinkDistance(Number(e.target.value))}
                    className="toolbar-slider"
                  />
                </label>
                
                <label className="toolbar-label">
                  Node Spacing
                  <input
                    type="range"
                    min="1"
                    max="3"
                    step="0.1"
                    value={collisionRadius}
                    onChange={(e) => setCollisionRadius(Number(e.target.value))}
                    className="toolbar-slider"
                  />
                </label>

                <label className="toolbar-label">
                  Center Force
                  <input
                    type="range"
                    min="0"
                    max="0.3"
                    step="0.01"
                    value={centerForce}
                    onChange={(e) => setCenterForce(Number(e.target.value))}
                    className="toolbar-slider"
                  />
                </label>
              </div>

              <div className="toolbar-section">
                <label className="toolbar-label">
                  Animation Speed
                  <input
                    type="range"
                    min="0.01"
                    max="0.2"
                    step="0.01"
                    value={animationSpeed}
                    onChange={(e) => setAnimationSpeed(Number(e.target.value))}
                    className="toolbar-slider"
                  />
                </label>

                <label className="toolbar-label">
                  Damping
                  <input
                    type="range"
                    min="0.1"
                    max="0.9"
                    step="0.1"
                    value={damping}
                    onChange={(e) => setDamping(Number(e.target.value))}
                    className="toolbar-slider"
                  />
                </label>
              </div>

              <div className="toolbar-section">
                <label className="toolbar-label">
                  Link Opacity
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.1"
                    value={linkOpacity}
                    onChange={(e) => setLinkOpacity(Number(e.target.value))}
                    className="toolbar-slider"
                  />
                </label>

                <label className="toolbar-label">
                  Link Width
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="0.5"
                    value={linkWidth}
                    onChange={(e) => setLinkWidth(Number(e.target.value))}
                    className="toolbar-slider"
                  />
                </label>

                <label className="toolbar-label">
                  Node Size
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={nodeSize}
                    onChange={(e) => setNodeSize(Number(e.target.value))}
                    className="toolbar-slider"
                  />
                </label>
              </div>
            </div>
          </div>
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
                    // If the node has a parent, navigate to it
                    if (selectedNode.parentId) {
                      const parentNode = threads[0].nodes.find(n => n.id === selectedNode.parentId);
                      if (parentNode) {
                        handleNodeClick(parentNode);
                        return;
                      }
                    }
                    // Otherwise go back to the thread
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
                  ←
                </button>
              )}
              <h2>
                {selectedNode.type === 'thread' 
                  ? (selectedNode.originalData?.metadata?.title || selectedNode.originalData?.title || selectedNode.title || `Thread ${selectedNode.id}`)
                  : (selectedNode.metadata?.title || selectedNode.title || `Node ${selectedNode.id}`)}
              </h2>
              <div className="header-actions">
                {!showNodeForm && (
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
                    placeholder={
                      NODE_TYPES[Number(newNodeData.type)].label === 'EVIDENCE' ? 'Source' :
                      NODE_TYPES[Number(newNodeData.type)].label === 'EXAMPLE' ? 'Example Title' :
                      NODE_TYPES[Number(newNodeData.type)].label === 'COUNTERPOINT' ? 'Argument' :
                      'Title'
                    }
                    value={newNodeData.title}
                    onChange={(e) => setNewNodeData({ ...newNodeData, title: e.target.value })}
                    className="node-input"
                  />
                  <textarea
                    placeholder={
                      NODE_TYPES[Number(newNodeData.type)].label === 'EVIDENCE' ? 'Evidence Point' :
                      NODE_TYPES[Number(newNodeData.type)].label === 'EXAMPLE' ? 'Example Description' :
                      NODE_TYPES[Number(newNodeData.type)].label === 'COUNTERPOINT' ? 'Explanation' :
                      'Content'
                    }
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

                  <div className="content-sidebar-metadata">
                    <div 
                      className="type-badge"
                      style={{ 
                        backgroundColor: getNodeTypeBadgeColor(selectedNode.type)
                      }}
                    >
                      {selectedNode.type === 'thread' ? 'THREAD' : NODE_TYPES[selectedNode.type]?.label}
                    </div>
                    {selectedNode.type === 'thread' ? (
                      selectedNode.metadata?.description && (
                        <p></p>
                      )
                    ) : (
                      selectedNode.metadata?.description && (
                        <p></p>
                      )
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
                    {formatContent(selectedNode.content, selectedNode.type === 'thread' ? 'thread' : NODE_TYPES[selectedNode.type]?.label)}
                  </div>

                  <div className="content-sidebar-actions">
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