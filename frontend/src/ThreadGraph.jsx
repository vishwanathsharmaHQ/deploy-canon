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
  metadata: thread.metadata,
  originalData: { ...thread, type: 'thread', id: thread.id }
}); 

const handleAddNode = () => {
  if (!onAddNode || !selectedNode) {
    console.error('Cannot add node: missing onAddNode handler or no node selected');
    return;
  }

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

  const nodeId = selectedNode.type === 'thread' ? 
    selectedNode.id.replace('thread-', '') : 
    selectedNode.id.replace('node-', '');

  onAddNode({
    id: nodeId,
    type: selectedNode.type,
    newNode: {
      title: newNodeData.title,
      content: structuredContent,
      description: shortDescription,
      type: Number(newNodeData.type),
      parentId: nodeId,
      threadId: threads[0].id,
      metadata: {
        title: newNodeData.title,
        description: shortDescription,
        content: structuredContent
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
}; 