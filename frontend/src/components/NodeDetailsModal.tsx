import { useState } from 'react';
import { NODE_TYPES } from '../constants';
import type { ThreadNode, NodeTypeName } from '../types';
import './NodeDetailsModal.css';

interface NodeDetailsModalProps {
  node: ThreadNode;
  onClose: () => void;
  onVote?: (nodeId: number, support: boolean) => void;
  onCreateProposal?: (nodeId: number) => void;
  onAddNode?: (parentId: number) => void;
  loading?: boolean;
  voteAmount?: string;
  setVoteAmount?: (amount: string) => void;
}

const NodeDetailsModal: React.FC<NodeDetailsModalProps> = ({ node, onClose, onVote, onCreateProposal, onAddNode, loading, voteAmount, setVoteAmount }) => {
  const [showAddNode, setShowAddNode] = useState(false);

  const formatTitle = (title: string, nodeType: NodeTypeName): string => {
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

  const formatContent = (content: any, nodeType: NodeTypeName): React.ReactNode => {
    if (!content) {
      return 'No content available';
    }

    // If content is an object with a content property, use that
    let actualContent: any = content.content || content;

    // If actualContent is a string that looks like JSON, try to parse it
    if (typeof actualContent === 'string' && (actualContent.startsWith('{') || actualContent.startsWith('['))) {
      try {
        actualContent = JSON.parse(actualContent);
      } catch (e) {
        // not valid JSON, use as-is
      }
    }

    try {
      // For evidence, example, and counterpoint nodes, handle JSON content
      if (['EVIDENCE', 'EXAMPLE', 'COUNTERPOINT'].includes(nodeType)) {
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
        const textContent: string = typeof actualContent === 'object' ?
                          JSON.stringify(actualContent, null, 2) : actualContent;
        return (
          <div className="text-content">
            {textContent.split('\n').map((paragraph: string, index: number) => (
              <p key={index} className="content-paragraph">{paragraph}</p>
            ))}
          </div>
        );
      }

      // Default case
      const textContent: string = typeof actualContent === 'object' ?
                        JSON.stringify(actualContent, null, 2) : actualContent;
      return <div className="text-content">{textContent}</div>;
    } catch (e) {
      console.error('Error formatting content:', e);
      // If JSON parsing fails, return content with paragraph formatting
      const textContent: string = typeof actualContent === 'object' ?
                        JSON.stringify(actualContent, null, 2) : actualContent;
      return (
        <div className="text-content">
          {textContent.split('\n').map((paragraph: string, index: number) => (
            <p key={index} className="content-paragraph">{paragraph}</p>
          ))}
        </div>
      );
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <h3>{formatTitle(node.title, node.node_type)}</h3>
            <div className="node-type-badge">{node.node_type}</div>
          </div>
          <button className="close-button" onClick={onClose}>&times;</button>
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
