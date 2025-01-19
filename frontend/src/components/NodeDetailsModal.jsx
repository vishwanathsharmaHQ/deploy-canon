import { ethers } from 'ethers';
import { useState } from 'react';
import './NodeDetailsModal.css';

const NODE_TYPES = [
  { value: 0, label: 'EVIDENCE' },
  { value: 1, label: 'REFERENCE' },
  { value: 2, label: 'CONTEXT' },
  { value: 3, label: 'EXAMPLE' },
  { value: 4, label: 'COUNTERPOINT' },
  { value: 5, label: 'SYNTHESIS' }
];

const NodeDetailsModal = ({ node, onClose, onVote, onCreateProposal, onAddNode, loading, voteAmount, setVoteAmount }) => {
  const [showAddNode, setShowAddNode] = useState(false);

  const formatTitle = (title, nodeType) => {
    try {
      // For evidence nodes, try to extract source as title
      if (nodeType === 'EVIDENCE' && title.startsWith('{')) {
        const jsonContent = JSON.parse(title);
        return jsonContent.source || title;
      }
      return title;
    } catch (e) {
      return title;
    }
  };

  const formatContent = (content, nodeType) => {
    if (!content) {
      console.log('No content provided for node type:', nodeType);
      return 'No content available';
    }
    
    console.log('Formatting content for node type:', nodeType);
    console.log('Raw content:', content);
    console.log('Content type:', typeof content);
    
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
    
    try {
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
                <div className="json-content">
                  <div className="evidence-content">
                    <p className="evidence-point">{jsonContent.point}</p>
                    <p className="evidence-source"><em>Source: {jsonContent.source}</em></p>
                  </div>
                </div>
              );
            case 'EXAMPLE':
              return (
                <div className="json-content">
                  <div className="example-content">
                    <h4 className="example-title">{jsonContent.title}</h4>
                    <p className="example-description">{jsonContent.description}</p>
                  </div>
                </div>
              );
            case 'COUNTERPOINT':
              return (
                <div className="json-content">
                  <div className="counterpoint-content">
                    <h4 className="counterpoint-argument">{jsonContent.argument}</h4>
                    <p className="counterpoint-explanation">{jsonContent.explanation}</p>
                  </div>
                </div>
              );
          }
        }
      }
      
      // For non-JSON content (Summary, Context, Synthesis), format with paragraphs
      if (['SYNTHESIS', 'CONTEXT'].includes(nodeType)) {
        const textContent = typeof actualContent === 'object' ? 
                          JSON.stringify(actualContent, null, 2) : actualContent;
        return (
          <div className="text-content">
            {textContent.split('\n').map((paragraph, index) => (
              <p key={index} className="content-paragraph">{paragraph}</p>
            ))}
          </div>
        );
      }
      
      // Default case
      const textContent = typeof actualContent === 'object' ? 
                        JSON.stringify(actualContent, null, 2) : actualContent;
      return <div className="text-content">{textContent}</div>;
    } catch (e) {
      console.error('Error formatting content:', e);
      // If JSON parsing fails, return content with paragraph formatting
      const textContent = typeof actualContent === 'object' ? 
                        JSON.stringify(actualContent, null, 2) : actualContent;
      return (
        <div className="text-content">
          {textContent.split('\n').map((paragraph, index) => (
            <p key={index} className="content-paragraph">{paragraph}</p>
          ))}
        </div>
      );
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <h3>{formatTitle(node.title, node.node_type)}</h3>
            <div className="node-type-badge">{node.node_type}</div>
          </div>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="node-content">
            {formatContent(node.content, node.node_type)}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NodeDetailsModal; 