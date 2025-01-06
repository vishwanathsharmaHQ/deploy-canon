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

const CONTENT_PREVIEW_LENGTH = 300; // Show first 300 characters by default

const NodeDetailsModal = ({ node, onClose, onVote, onCreateProposal, onAddNode, loading, voteAmount, setVoteAmount }) => {
  const [showNodeForm, setShowNodeForm] = useState(false);
  const [nodeTitle, setNodeTitle] = useState('');
  const [nodeContent, setNodeContent] = useState('');
  const [nodeType, setNodeType] = useState(0);
  const [isContentExpanded, setIsContentExpanded] = useState(false);
  const [isFullscreenContent, setIsFullscreenContent] = useState(false);

  if (!node) return null;

  const isThread = (node.metadata?.title && !node.nodeType) || node.type === 'thread';
  const nodeTypeDisplay = node.nodeType || (isThread ? 'thread' : undefined);
  const displayContent = node.content?.content;
  const lastUpdated = node.content?.lastUpdated;
  
  const currentTime = Math.floor(Date.now() / 1000);
  const proposalDeadline = typeof node[4] === 'bigint' ? Number(node[4]) : (Number(node[4]) || 0);
  const hasProposal = proposalDeadline > 0;
  const isVotingActive = hasProposal && (proposalDeadline + 60) > currentTime;

  const handleAddNode = () => {
    if (!nodeTitle.trim() || !nodeContent.trim()) return;
    
    onAddNode({
      ...node,
      newNode: {
        title: nodeTitle,
        content: nodeContent,
        type: nodeType
      }
    });
    
    // Reset form
    setNodeTitle('');
    setNodeContent('');
    setNodeType(0);
    setShowNodeForm(false);
  };

  const isLongContent = displayContent?.length > CONTENT_PREVIEW_LENGTH;
  const contentToShow = isLongContent && !isContentExpanded 
    ? displayContent?.substring(0, CONTENT_PREVIEW_LENGTH) + '...'
    : displayContent;

  if (isFullscreenContent) {
    return (
      <div className="fullscreen-overlay" onClick={() => setIsFullscreenContent(false)}>
        <div className="fullscreen-content" onClick={e => e.stopPropagation()}>
          <div className="fullscreen-header">
            <h3>{node.metadata?.title || nodeTypeDisplay}</h3>
            <button className="close-button" onClick={() => setIsFullscreenContent(false)}>×</button>
          </div>
          <div className="fullscreen-body">
            <pre className="content-text">{displayContent}</pre>
            {lastUpdated && (
              <p className="date">Last Updated: {new Date(lastUpdated).toLocaleString()}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>{node.metadata?.title || `Node ${node.id}`}</h3>
            {node.type !== undefined && (
              <div className={`node-type ${NODE_TYPES[node.type].label}`}>
                {NODE_TYPES[node.type].label}
              </div>
            )}
          </div>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="content-section">
            <div className="content-header">
              <h4>Content</h4>
              {isLongContent && (
                <div className="content-controls">
                  <button 
                    className="content-control-button"
                    onClick={() => setIsContentExpanded(!isContentExpanded)}
                  >
                    {isContentExpanded ? 'Show Less' : 'Show More'}
                  </button>
                  <button 
                    className="content-control-button"
                    onClick={() => setIsFullscreenContent(true)}
                  >
                    View Full Content
                  </button>
                </div>
              )}
            </div>
            <pre className="content-text">{contentToShow}</pre>
            {lastUpdated && (
              <p className="date">Last Updated: {new Date(lastUpdated).toLocaleString()}</p>
            )}
          </div>

          {/* Add Node section - only show for threads */}
          {isThread && (
            <div className="add-node-section">
              {!showNodeForm ? (
                <button 
                  className="add-node-button"
                  onClick={() => setShowNodeForm(true)}
                  disabled={loading}
                >
                  Add Node
                </button>
              ) : (
                <div className="node-form">
                  <h4>Create New Node</h4>
                  <input
                    type="text"
                    placeholder="Node Title"
                    value={nodeTitle}
                    onChange={(e) => setNodeTitle(e.target.value)}
                    className="node-input"
                  />
                  <textarea
                    placeholder="Node Content"
                    value={nodeContent}
                    onChange={(e) => setNodeContent(e.target.value)}
                    className="node-input"
                    rows={4}
                  />
                  <select
                    value={nodeType}
                    onChange={(e) => setNodeType(Number(e.target.value))}
                    className="node-input"
                  >
                    {NODE_TYPES.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  <div className="node-form-buttons">
                    <button 
                      className="cancel-button"
                      onClick={() => setShowNodeForm(false)}
                      disabled={loading}
                    >
                      Cancel
                    </button>
                    <button 
                      className="submit-button"
                      onClick={handleAddNode}
                      disabled={loading || !nodeTitle.trim() || !nodeContent.trim()}
                    >
                      Create Node
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="voting-section">
            <div className="vote-stats">
              <div className="stat">
                <label>Votes For:</label>
                <span>{node.votesFor ? ethers.formatEther(node.votesFor) : '0'} canonthread</span>
              </div>
              <div className="stat">
                <label>Votes Against:</label>
                <span>{node.votesAgainst ? ethers.formatEther(node.votesAgainst) : '0'} canonthread</span>
              </div>
            </div>

            {hasProposal ? (
              isVotingActive ? (
                !node.hasVoted ? (
                  <div className="vote-form">
                    <h4>Cast Your Vote</h4>
                    <input
                      type="number"
                      placeholder="Amount of canonthread tokens"
                      value={voteAmount}
                      onChange={(e) => setVoteAmount(e.target.value)}
                      min="0"
                      step="0.1"
                    />
                    <div className="vote-buttons">
                      <button 
                        onClick={() => onVote(node.id, true)}
                        disabled={loading || !voteAmount}
                        className="vote-for"
                      >
                        Vote For
                      </button>
                      <button 
                        onClick={() => onVote(node.id, false)}
                        disabled={loading || !voteAmount}
                        className="vote-against"
                      >
                        Vote Against
                      </button>
                    </div>
                    <p className="deadline-info">
                      Voting ends: {new Date(proposalDeadline * 1000).toLocaleString()}
                      <br />
                      <small>Time remaining: {Math.max(0, Math.floor((proposalDeadline - currentTime) / 60))} minutes</small>
                    </p>
                  </div>
                ) : (
                  <p className="voted-message">You have already voted on this {nodeTypeDisplay === 'thread' ? 'thread' : 'node'}.</p>
                )
              ) : (
                <p className="voting-ended-message">
                  Voting period has ended on {new Date(proposalDeadline * 1000).toLocaleString()}
                  <br />
                  <small>Current time: {new Date(currentTime * 1000).toLocaleString()}</small>
                </p>
              )
            ) : (
              <div className="no-proposal-section">
                <p className="no-proposal-message">No active proposal for voting.</p>
                <button 
                  className="create-proposal-button"
                  onClick={() => onCreateProposal(node)}
                  disabled={loading}
                >
                  Create Proposal
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NodeDetailsModal; 