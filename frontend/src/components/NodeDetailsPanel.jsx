import { ethers } from 'ethers';

const NodeDetailsPanel = ({ node, onClose, onVote, loading, voteAmount, setVoteAmount }) => {
  if (!node) return null;

  const isThread = node.type === 'thread';
  const title = isThread ? node.metadata?.title : `${node.nodeType} Node`;
  const description = isThread ? node.metadata?.description : '';
  const content = isThread ? 
    node.content?.content : 
    (node.content?.content || '');

  return (
    <div className="node-details-panel">
      <div className="panel-header">
        <h3>{title}</h3>
        <button className="close-button" onClick={onClose}>×</button>
      </div>
      
      <div className="panel-content">
        {isThread && description && (
          <p className="description">{description}</p>
        )}
        
        <div className="content-section">
          <h4>Content:</h4>
          <p>{content}</p>
          {isThread && node.content?.lastUpdated && (
            <p className="date">Last Updated: {new Date(node.content.lastUpdated).toLocaleString()}</p>
          )}
        </div>

        {node.hasActiveProposal && !node.hasVoted && (
          <div className="voting-section">
            <h4>Vote</h4>
            <div className="vote-form">
              <input
                type="number"
                placeholder="Amount of CANON tokens"
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
                  Vote For ({node.votesFor ? ethers.formatEther(node.votesFor) : '0'})
                </button>
                <button 
                  onClick={() => onVote(node.id, false)}
                  disabled={loading || !voteAmount}
                  className="vote-against"
                >
                  Vote Against ({node.votesAgainst ? ethers.formatEther(node.votesAgainst) : '0'})
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="stats-section">
          <div className="stat">
            <label>Votes For:</label>
            <span>{node.votesFor ? ethers.formatEther(node.votesFor) : '0'} CANON</span>
          </div>
          <div className="stat">
            <label>Votes Against:</label>
            <span>{node.votesAgainst ? ethers.formatEther(node.votesAgainst) : '0'} CANON</span>
          </div>
          {node.proposalDeadline > 0 && (
            <div className="stat">
              <label>Deadline:</label>
              <span>{new Date(node.proposalDeadline * 1000).toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NodeDetailsPanel; 