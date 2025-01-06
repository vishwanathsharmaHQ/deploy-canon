// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IPFSHelper.sol";
import "./CanonToken.sol";

contract CanonThread is IPFSHelper {
    struct Thread {
        string metadataHash;    // IPFS hash containing thread metadata JSON
        string contentHash;     // IPFS hash containing thread content JSON
        address creator;
        uint256 version;
        uint256 timestamp;
        bool isActive;
    }

    struct Node {
        string metadataHash;    // IPFS hash containing node metadata JSON
        string contentHash;     // IPFS hash containing node content JSON
        NodeType nodeType;
        address creator;
        uint256 timestamp;
        uint256 threadId;
        bool isActive;
    }

    enum NodeType {
        EVIDENCE,
        REFERENCE,
        CONTEXT,
        EXAMPLE,
        COUNTERPOINT,
        SYNTHESIS
    }

    // Mapping of threadId to Thread
    mapping(uint256 => Thread) public threads;
    
    // Mapping of nodeId to Node
    mapping(uint256 => Node) public nodes;
    
    // Thread counter
    uint256 public threadCounter;
    
    // Node counter
    uint256 public nodeCounter;

    // Events
    event ThreadCreated(
        uint256 indexed threadId, 
        address creator, 
        string metadataHash, 
        string contentHash
    );
    event NodeCreated(
        uint256 indexed nodeId, 
        uint256 indexed threadId, 
        NodeType nodeType, 
        string metadataHash, 
        string contentHash
    );
    event ThreadUpdated(
        uint256 indexed threadId, 
        string newMetadataHash, 
        string newContentHash, 
        uint256 version
    );

    // Add new state variables
    CanonToken public token;
    uint256 public constant MINIMUM_STAKE = 100 * 10**18; // 100 tokens
    uint256 public constant VOTING_PERIOD = 3 days;
    uint256 public constant VOTING_BUFFER = 1 minutes; // Add 1 minute buffer for voting
    
    struct Proposal {
        uint256 threadId;
        string proposedMetadataHash;
        string proposedContentHash;
        address proposer;
        uint256 stake;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 deadline;
        bool executed;
        bool passed;
    }

    mapping(uint256 => Proposal) public proposals;
    uint256 public proposalCounter;
    
    // Mapping to track if an address has voted on a proposal
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    
    // Events
    event ProposalCreated(
        uint256 indexed proposalId,
        uint256 indexed threadId,
        address proposer,
        uint256 stake,
        uint256 deadline
    );
    event Voted(
        uint256 indexed proposalId,
        address voter,
        bool support,
        uint256 amount
    );
    event ProposalExecuted(
        uint256 indexed proposalId,
        bool passed
    );

    constructor(address _tokenAddress) {
        token = CanonToken(_tokenAddress);
        proposalCounter = 0;
    }

    function createThread(
        string memory _metadataHash,
        string memory _contentHash
    ) external returns (uint256) {
        require(isValidIPFSHash(_metadataHash), "Invalid metadata IPFS hash");
        require(isValidIPFSHash(_contentHash), "Invalid content IPFS hash");

        threadCounter++;
        
        threads[threadCounter] = Thread({
            metadataHash: _metadataHash,
            contentHash: _contentHash,
            creator: msg.sender,
            version: 1,
            timestamp: block.timestamp,
            isActive: true
        });

        emit ThreadCreated(threadCounter, msg.sender, _metadataHash, _contentHash);
        return threadCounter;
    }

    function createNode(
        uint256 _threadId,
        string memory _metadataHash,
        string memory _contentHash,
        NodeType _nodeType
    ) external returns (uint256) {
        require(threads[_threadId].isActive, "Thread does not exist");
        require(isValidIPFSHash(_metadataHash), "Invalid metadata IPFS hash");
        require(isValidIPFSHash(_contentHash), "Invalid content IPFS hash");
        
        nodeCounter++;
        
        nodes[nodeCounter] = Node({
            metadataHash: _metadataHash,
            contentHash: _contentHash,
            nodeType: _nodeType,
            creator: msg.sender,
            timestamp: block.timestamp,
            threadId: _threadId,
            isActive: true
        });

        emit NodeCreated(nodeCounter, _threadId, _nodeType, _metadataHash, _contentHash);
        return nodeCounter;
    }

    function updateThread(
        uint256 _threadId, 
        string memory _newMetadataHash,
        string memory _newContentHash
    ) external {
        require(threads[_threadId].isActive, "Thread does not exist");
        require(threads[_threadId].creator == msg.sender, "Only creator can update");
        require(isValidIPFSHash(_newMetadataHash), "Invalid metadata IPFS hash");
        require(isValidIPFSHash(_newContentHash), "Invalid content IPFS hash");
        
        Thread storage thread = threads[_threadId];
        thread.metadataHash = _newMetadataHash;
        thread.contentHash = _newContentHash;
        thread.version++;
        thread.timestamp = block.timestamp;

        emit ThreadUpdated(_threadId, _newMetadataHash, _newContentHash, thread.version);
    }

    function proposeUpdate(
        uint256 _threadId,
        string memory _newMetadataHash,
        string memory _newContentHash,
        uint256 _stake
    ) external returns (uint256) {
        require(_stake >= MINIMUM_STAKE, "Insufficient stake");
        require(threads[_threadId].isActive, "Thread does not exist");
        require(isValidIPFSHash(_newMetadataHash), "Invalid metadata IPFS hash");
        require(isValidIPFSHash(_newContentHash), "Invalid content IPFS hash");
        
        // Transfer tokens from proposer to contract
        require(token.transferFrom(msg.sender, address(this), _stake), "Stake transfer failed");
        
        proposalCounter++;
        
        proposals[proposalCounter] = Proposal({
            threadId: _threadId,
            proposedMetadataHash: _newMetadataHash,
            proposedContentHash: _newContentHash,
            proposer: msg.sender,
            stake: _stake,
            votesFor: 0,
            votesAgainst: 0,
            deadline: block.timestamp + VOTING_PERIOD,
            executed: false,
            passed: false
        });

        emit ProposalCreated(
            proposalCounter,
            _threadId,
            msg.sender,
            _stake,
            block.timestamp + VOTING_PERIOD
        );

        return proposalCounter;
    }

    function vote(uint256 _proposalId, bool _support, uint256 _amount) external {
        Proposal storage proposal = proposals[_proposalId];
        require(block.timestamp < proposal.deadline + VOTING_BUFFER, "Voting period ended");
        require(!proposal.executed, "Proposal already executed");
        require(!hasVoted[_proposalId][msg.sender], "Already voted");
        require(_amount > 0, "Must vote with some tokens");

        // Transfer voting tokens to contract
        require(token.transferFrom(msg.sender, address(this), _amount), "Vote transfer failed");

        if (_support) {
            proposal.votesFor += _amount;
        } else {
            proposal.votesAgainst += _amount;
        }

        hasVoted[_proposalId][msg.sender] = true;

        emit Voted(_proposalId, msg.sender, _support, _amount);
    }

    function executeProposal(uint256 _proposalId) external {
        Proposal storage proposal = proposals[_proposalId];
        require(block.timestamp >= proposal.deadline + VOTING_BUFFER, "Voting period not ended");
        require(!proposal.executed, "Proposal already executed");

        proposal.executed = true;
        
        if (proposal.votesFor > proposal.votesAgainst) {
            proposal.passed = true;
            
            // Update the thread
            Thread storage thread = threads[proposal.threadId];
            thread.metadataHash = proposal.proposedMetadataHash;
            thread.contentHash = proposal.proposedContentHash;
            thread.version++;
            
            // Return stake to proposer
            token.transfer(proposal.proposer, proposal.stake);
        } else {
            proposal.passed = false;
            // Stake is lost (kept by contract)
        }

        // Return voting tokens
        // Implementation needed for returning votes

        emit ProposalExecuted(_proposalId, proposal.passed);
    }
} 