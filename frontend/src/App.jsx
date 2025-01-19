import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import CanonThread from './contracts/CanonThread.json'
import CanonToken from './contracts/CanonToken.json'
import deployments from './contracts/deployments.json'
import ThreadGraph from './components/ThreadGraph'
import NodeDetailsModal from './components/NodeDetailsModal'
import { api } from './services/api'
import './App.css'

function App() {
  const [account, setAccount] = useState(null)
  const [contract, setContract] = useState(null)
  const [threads, setThreads] = useState([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [nodeContent, setNodeContent] = useState('')
  const [nodeType, setNodeType] = useState(0)
  const [tokenContract, setTokenContract] = useState(null)
  const [voteAmount, setVoteAmount] = useState('')
  const [hasVoted, setHasVoted] = useState({})
  const [selectedThreadId, setSelectedThreadId] = useState(null)
  const [showCreateThreadModal, setShowCreateThreadModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [showThreadDropdown, setShowThreadDropdown] = useState(false);
  const [isOnChain, setIsOnChain] = useState(false);
  const [offChainThreads, setOffChainThreads] = useState([]);
  const [isIPFSConnected, setIsIPFSConnected] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  const NODE_TYPES = [
    'EVIDENCE',
    'REFERENCE',
    'CONTEXT',
    'EXAMPLE',
    'COUNTERPOINT',
    'SYNTHESIS'
  ]

  useEffect(() => {
    connectWallet()
  }, [])

  async function setupNetwork() {
    try {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x7A69', // 31337 in hex (Hardhat's default)
          chainName: 'Hardhat Local',
          nativeCurrency: {
            name: 'ETH',
            symbol: 'ETH',
            decimals: 18
          },
          rpcUrls: ['http://127.0.0.1:8545']
        }]
      })
      return true
    } catch (error) {
      console.error("Error setting up network:", error)
      return false
    }
  }

  async function connectWallet() {
    if (typeof window.ethereum !== 'undefined') {
      try {
        console.log("Connecting to wallet and setting up contract...");
        // First try to switch to the Hardhat network
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x7A69' }], // 31337 in hex
          });
        } catch (switchError) {
          // If the network doesn't exist, try to add it
          if (switchError.code === 4902) {
            const success = await setupNetwork();
            if (!success) return;
          } else {
            console.error("Failed to switch network:", switchError);
            return;
          }
        }

        // Request account access
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        setAccount(accounts[0]);
        
        // Setup ethers provider and contract
        const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
        const signer = await provider.getSigner(accounts[0]);
        console.log("Setting up contract with address:", deployments.canonThread);
        const canonThreadContract = new ethers.Contract(
          deployments.canonThread,
          CanonThread.abi,
          signer
        );
        
        // Verify contract connection
        try {
          const code = await provider.getCode(deployments.canonThread);
          if (code === '0x') {
            console.error("No contract deployed at the specified address");
            return;
          }
        } catch (error) {
          console.error("Error verifying contract deployment:", error);
          return;
        }
        
        setContract(canonThreadContract);
        console.log("Contract setup complete");

        // Create contract instances
        const canonToken = new ethers.Contract(
          deployments.canonToken,
          CanonToken.abi,
          signer
        );
        
        setTokenContract(canonToken);
        setError(null);

        // Load on-chain threads after successful connection
        await loadThreads();
        
        // Listen for account changes
        window.ethereum.on('accountsChanged', (newAccounts) => {
          if (newAccounts.length === 0) {
            setAccount(null);
            setContract(null);
          } else {
            setAccount(newAccounts[0]);
            // Reconnect with new account
            connectWallet();
          }
        });

        // Listen for chain changes
        window.ethereum.on('chainChanged', () => {
          window.location.reload();
        });

      } catch (error) {
        console.error("Error connecting to wallet:", error);
        setError("Failed to connect wallet. Make sure you're on the Hardhat Local network.");
      }
    }
  }

  async function uploadToIPFS(content) {
    try {
      const formData = new FormData()
      const blob = new Blob([JSON.stringify(content)], { type: 'application/json' })
      formData.append('path', blob)

      const response = await fetch('http://localhost:5001/api/v0/add', {
        method: 'POST',
        body: formData
      })
      
      const data = await response.json()
      const hash = data.Hash

      // Validate hash format
      if (!hash || hash.length !== 46 || !hash.startsWith('Qm')) {
        throw new Error('Invalid IPFS hash format. Must start with Qm and be 46 characters long.')
      }

      return hash
    } catch (error) {
      console.error("Error uploading to IPFS:", error)
      throw error
    }
  }

  async function createThread() {
    try {
      setLoading(true);
      setError(null);

      if (isOnChain && contract) {
        // Existing on-chain creation logic
        const metadata = {
          title,
          description,
          createdAt: new Date().toISOString(),
          version: 1
        };

        const contentData = {
          title,
          content,
          lastUpdated: new Date().toISOString()
        };

        const metadataHash = await uploadToIPFS(metadata);
        const contentHash = await uploadToIPFS(contentData);

        const tx = await contract.createThread(metadataHash, contentHash);
        await tx.wait();
      } else {
        // Off-chain creation
        const newThread = await api.createThread({
          title,
          description,
          content,
          metadata: {
            createdAt: new Date().toISOString(),
            version: 1
          }
        });
        setOffChainThreads(prev => [newThread, ...prev]);
        setSelectedThreadId(newThread.id);
      }

      // Clear form
      setTitle('');
      setDescription('');
      setContent('');
      setShowCreateThreadModal(false);

      // Reload appropriate threads
      if (isOnChain) {
        await loadThreads();
      } else {
        await loadOffChainThreads();
      }
    } catch (error) {
      console.error("Error creating thread:", error);
      setError("Failed to create thread: " + error.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchFromIPFS(hash) {
    try {
      // First try direct gateway URL
      const response = await fetch(`http://localhost:8080/ipfs/${hash}`)
      
      if (!response.ok) {
        throw new Error(`IPFS request failed with status ${response.status}`)
      }
      
      const data = await response.json()
      return data
    } catch (error) {
      console.error("Error fetching from IPFS:", error)
      try {
        // Fallback to API if gateway fails
        const response = await fetch(`http://localhost:5001/api/v0/cat?arg=${hash}`)
        
        if (!response.ok) {
          throw new Error(`IPFS API request failed with status ${response.status}`)
        }
        
        const data = await response.json()
        return data
      } catch (fallbackError) {
        console.error("Error fetching from IPFS API:", fallbackError)
        return null
      }
    }
  }

  async function loadThreads() {
    if (!contract || !account) {
      console.log("Contract or account not initialized:", { contract: !!contract, account: !!account });
      return;
    }

    try {
      console.log("Loading on-chain threads...");
      const threadCount = await contract.threadCounter();
      console.log("Thread count:", threadCount);
      const nodeCount = await contract.nodeCounter();
      const proposalCount = await contract.proposalCounter();
      const currentTimestamp = Math.floor(Date.now() / 1000);

      // Create a temporary array to store all threads
      let loadedThreads = [];

      // Load threads one by one
      for (let i = 1; i <= threadCount; i++) {
        const threadData = await contract.threads(i);
        if (threadData && threadData.creator !== '0x0000000000000000000000000000000000000000') {
          // Fetch metadata and content from IPFS
          const metadata = await fetchFromIPFS(threadData.metadataHash);
          const content = await fetchFromIPFS(threadData.contentHash);

          // Check if user has voted
          const hasVotedOnThread = await contract.hasVoted(i, account);

          // Find the latest proposal for this thread
          let votesFor = ethers.parseEther("0");
          let votesAgainst = ethers.parseEther("0");
          let proposalDeadline = 0;
          let hasActiveProposal = false;

          for (let j = 1; j <= proposalCount; j++) {
            const proposal = await contract.proposals(j);
            if (proposal.threadId.toString() === i.toString() && !proposal.executed) {
              votesFor = proposal.votesFor;
              votesAgainst = proposal.votesAgainst;
              proposalDeadline = Number(proposal.deadline);
              hasActiveProposal = currentTimestamp < proposalDeadline + 60;
              break;
            }
          }

          // Load nodes for this thread
          const nodes = [];
          for (let j = 1; j <= nodeCount; j++) {
            const nodeData = await contract.nodes(j);
            if (nodeData && 
                nodeData.threadId.toString() === i.toString() && 
                nodeData.contentHash !== '') {
              const nodeMetadata = await fetchFromIPFS(nodeData.metadataHash);
              const nodeContent = await fetchFromIPFS(nodeData.contentHash);
              const hasVotedOnNode = await contract.hasVoted(j, account);
              
              // Find the latest proposal for this node
              let nodeVotesFor = ethers.parseEther("0");
              let nodeVotesAgainst = ethers.parseEther("0");
              let nodeProposalDeadline = 0;
              let nodeHasActiveProposal = false;

              for (let k = 1; k <= proposalCount; k++) {
                const proposal = await contract.proposals(k);
                if (proposal.threadId.toString() === j.toString() && !proposal.executed) {
                  nodeVotesFor = proposal.votesFor;
                  nodeVotesAgainst = proposal.votesAgainst;
                  nodeProposalDeadline = Number(proposal.deadline);
                  nodeHasActiveProposal = currentTimestamp < nodeProposalDeadline + 60;
                  break;
                }
              }
              
              nodes.push({
                ...nodeData,
                metadata: nodeMetadata,
                content: nodeContent,
                id: j,
                type: Number(nodeData.nodeType),
                hasVoted: hasVotedOnNode,
                votesFor: nodeVotesFor,
                votesAgainst: nodeVotesAgainst,
                proposalDeadline: nodeProposalDeadline,
                hasActiveProposal: nodeHasActiveProposal
              });
            }
          }

          // Create the thread object
          const threadObj = {
            ...threadData,
            metadata,
            content,
            nodes,
            id: i,
            hasVoted: hasVotedOnThread,
            votesFor,
            votesAgainst,
            proposalDeadline,
            hasActiveProposal
          };

          loadedThreads.push(threadObj);
        }
      }

      setThreads(loadedThreads);
      
      // If no thread is selected, select the first one
      if (!selectedThreadId && loadedThreads.length > 0) {
        setSelectedThreadId(loadedThreads[0].id);
      }
    } catch (error) {
      console.error("Error loading threads:", error);
      setError("Failed to load on-chain threads: " + error.message);
    }
  }

  const handleNodeClick = (node) => {
    setSelectedNode(node);
  };

  const handleCloseModal = () => {
    setSelectedNode(null);
  };

  const handleVote = async (nodeId, support) => {
    if (!contract || !tokenContract || !account) return;
    
    try {
      setLoading(true);
      setError(null);

      const amount = ethers.parseEther(voteAmount);
      
      // First approve token transfer
      const approveTx = await tokenContract.approve(contract.target, amount);
      await approveTx.wait();

      // Then vote
      const voteTx = await contract.vote(nodeId, support, amount);
      await voteTx.wait();

      // Clear form and reload
      setVoteAmount('');
      setSelectedNode(null);
      loadThreads();
    } catch (error) {
      console.error("Error voting:", error);
      setError("Error voting: " + (error.message || "Unknown error occurred"));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProposal = async (node) => {
    if (!contract || !tokenContract || !account) return;
    
    try {
      setLoading(true);
      setError(null);

      // Get minimum stake
      const minimumStake = await contract.MINIMUM_STAKE();
      console.log("Minimum stake required:", ethers.formatEther(minimumStake), "CANON");

      // Create and upload new metadata and content
      const metadata = {
        title: `Update Proposal for ${node.type === 'thread' ? 'Thread' : 'Node'} ${node.id}`,
        description: "Proposal to update content",
        createdAt: new Date().toISOString()
      };

      const content = {
        content: node.content?.content || '',
        lastUpdated: new Date().toISOString()
      };

      const metadataHash = await uploadToIPFS(metadata);
      const contentHash = await uploadToIPFS(content);

      // First approve token transfer
      console.log("Approving tokens...");
      const approveTx = await tokenContract.approve(contract.target, minimumStake);
      await approveTx.wait();

      // Create proposal
      console.log("Creating proposal...");
      const tx = await contract.proposeUpdate(node.id, metadataHash, contentHash, minimumStake);
      await tx.wait();
      console.log("Proposal created");

      // Reload threads and close modal
      await loadThreads();
      setSelectedNode(null);
    } catch (error) {
      console.error("Error creating proposal:", error);
      setError("Error creating proposal: " + (error.message || "Unknown error occurred"));
    } finally {
      setLoading(false);
    }
  };

  const handleAddNode = async (threadData) => {
    if (isOnChain && (!contract || !account)) {
      console.log("No contract or account for on-chain operation");
      return;
    }
    
    const { newNode } = threadData;
    if (!newNode?.title || !newNode?.content) {
      console.log("Missing node data");
      return;
    }
    
    try {
      setLoading(true);
      setError(null);

      if (isOnChain) {
        // Existing on-chain node creation logic
        const metadata = {
          title: newNode.title,
          description: newNode.content.substring(0, 100) + (newNode.content.length > 100 ? '...' : ''),
          createdAt: new Date().toISOString()
        };

        const content = {
          content: newNode.content,
          lastUpdated: new Date().toISOString()
        };

        const metadataHash = await uploadToIPFS(metadata);
        const contentHash = await uploadToIPFS(content);

        const tx = await contract.createNode(threadData.id, metadataHash, contentHash, newNode.type);
        await tx.wait();
        await loadThreads();
      } else {
        // Off-chain node creation
        console.log("Creating off-chain node with type:", newNode.type);
        const nodeType = typeof newNode.type === 'number' ? 
          NODE_TYPES[newNode.type] : 
          newNode.type || NODE_TYPES[0];

        const createdNode = await api.createNode({
          threadId: threadData.id,
          title: newNode.title,
          content: newNode.content,
          nodeType,
          parentId: newNode.parentId,
          metadata: {
            createdAt: new Date().toISOString()
          }
        });

        // Update the local state with the new node
        const updatedThreads = offChainThreads.map(thread => {
          if (thread.id === threadData.id) {
            return {
              ...thread,
              nodes: [...(thread.nodes || []), {
                ...createdNode,
                type: NODE_TYPES.indexOf(createdNode.node_type)
              }]
            };
          }
          return thread;
        });
        setOffChainThreads(updatedThreads);

        // Refresh the thread data to get the latest nodes and edges
        const { nodes, edges } = await api.getThreadNodes(threadData.id);
        const updatedThread = {
          ...threadData,
          nodes: nodes.map(node => ({
            ...node,
            type: NODE_TYPES.indexOf(node.node_type)
          })),
          edges
        };
        
        setOffChainThreads(prev => 
          prev.map(t => t.id === threadData.id ? updatedThread : t)
        );
      }

      setSelectedNode(null);
    } catch (error) {
      console.error("Error creating node:", error);
      setError("Failed to create node: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Load off-chain threads
  const loadOffChainThreads = async () => {
    try {
      const threads = await api.getThreads();
      
      // Load nodes for each thread
      const threadsWithNodes = await Promise.all(
        threads.map(async thread => {
          const { nodes, edges } = await api.getThreadNodes(thread.id);
          return {
            ...thread,
            nodes,
            edges
          };
        })
      );
      
      setOffChainThreads(threadsWithNodes);
      
      // If no thread is selected, select the first one
      if (!selectedThreadId && threadsWithNodes.length > 0) {
        setSelectedThreadId(threadsWithNodes[0].id);
      }
    } catch (error) {
      console.error("Error loading off-chain threads:", error);
      setError("Failed to load off-chain threads");
    }
  };

  // Initial setup on mount
  useEffect(() => {
    if (!isOnChain) {
      loadOffChainThreads();
    } else {
      connectWallet();
    }
  }, []);

  // Handle mode toggle
  const handleModeToggle = async (e) => {
    const newMode = e.target.checked;
    setIsOnChain(newMode);
    
    if (newMode) {
      // Switch to on-chain mode
      await connectWallet();
    } else {
      // Switch to off-chain mode
      setContract(null);
      setAccount(null);
      setTokenContract(null);
      await loadOffChainThreads();
    }
  };

  // Get the threads to display based on mode
  const displayThreads = isOnChain ? threads : offChainThreads;

  // Update the useEffect for contract changes
  useEffect(() => {
    if (contract && isOnChain) {
      loadThreads();
    }
  }, [contract]);

  const threadToShow = displayThreads.find(t => t.id === selectedThreadId);
  const graphData = threadToShow ? [threadToShow] : [];

  const handleCreateThreadClick = (e) => {
    if (e.target.value === 'create') {
      setShowCreateThreadModal(true);
      // Reset the selector to the previously selected thread
      e.target.value = selectedThreadId || '';
    } else {
      setSelectedThreadId(e.target.value ? Number(e.target.value) : null);
    }
  };

  // Add this function to filter threads based on search query
  const filteredThreads = displayThreads.filter(thread => 
    thread.metadata?.title?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Cross-browser fullscreen functions
  const requestFullscreen = async (element) => {
    if (element.requestFullscreen) {
      await element.requestFullscreen();
    } else if (element.webkitRequestFullscreen) { // Safari
      await element.webkitRequestFullscreen();
    } else if (element.msRequestFullscreen) { // IE11
      await element.msRequestFullscreen();
    }
  };

  const exitFullscreen = async () => {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
    } else if (document.webkitExitFullscreen) { // Safari
      await document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) { // IE11
      await document.msExitFullscreen();
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullScreen(
        !!(document.fullscreenElement || 
           document.webkitFullscreenElement || 
           document.msFullscreenElement)
      );
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('msfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('msfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Handle first interaction
  useEffect(() => {
    const handleFirstInteraction = async () => {
      if (!hasInteracted) {
        setHasInteracted(true);
        try {
          if (!document.fullscreenElement && 
              !document.webkitFullscreenElement && 
              !document.msFullscreenElement) {
            await requestFullscreen(document.documentElement);
            setIsFullScreen(true);
          }
        } catch (err) {
          console.error('Error attempting to enable full-screen mode:', err.message);
        }
      }
    };

    // Listen for any user interaction
    window.addEventListener('click', handleFirstInteraction);
    window.addEventListener('keydown', handleFirstInteraction);
    window.addEventListener('touchstart', handleFirstInteraction);

    return () => {
      window.removeEventListener('click', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
    };
  }, [hasInteracted]);

  // Update the toggleFullScreen function
  const toggleFullScreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement && 
          !document.webkitFullscreenElement && 
          !document.msFullscreenElement) {
        await requestFullscreen(document.documentElement);
      } else {
        await exitFullscreen();
      }
    } catch (err) {
      console.error(`Error attempting to toggle full-screen mode: ${err.message}`);
    }
  }, []);

  // Check IPFS connection
  const checkIPFSConnection = async () => {
    if (!isOnChain) return; // Skip IPFS check if not in on-chain mode
    
    try {
      // Use the id endpoint instead of version
      const response = await fetch('http://localhost:5001/api/v0/id', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`IPFS request failed with status ${response.status}`);
      }

      const data = await response.json();
      if (data && data.ID) {
        setIsIPFSConnected(true);
        return true;
      } else {
        throw new Error('Invalid IPFS response');
      }
    } catch (error) {
      if (error.message.includes('Failed to fetch')) {
        console.error('IPFS daemon not running');
      } else {
        console.error('IPFS connection failed:', error);
      }
      setIsIPFSConnected(false);
      return false;
    }
  };

  // Initial IPFS check and periodic updates
  useEffect(() => {
    if (isOnChain) {
      checkIPFSConnection();
      const interval = setInterval(checkIPFSConnection, 30000);
      return () => clearInterval(interval);
    } else {
      setIsIPFSConnected(false); // Reset IPFS status when not in on-chain mode
    }
  }, [isOnChain]);

  // Handle mainline connection
  const handleMainlineConnect = async () => {
    setIsOnChain(true);
    await connectWallet();
    await checkIPFSConnection(); // Check IPFS when connecting to mainline
  };

  return (
    <div className="app">
      <div className="header">
        <div className="header-center">
          <h1>canonthread</h1>
        </div>

        <div className="header-right">
          {!isOnChain ? (
            <div className="connection-statuses">
              <div className="connection-status">
                <div className="status-dot"></div>
                <span>Database Connected</span>
              </div>
            </div>
          ) : (
            <div className="connection-statuses">
              {account && (
                <div className="connection-status">
                  <div className="status-dot"></div>
                  <span>Mainline Connected</span>
                </div>
              )}
              {isIPFSConnected && (
                <div className="connection-status">
                  <div className="status-dot"></div>
                  <span>IPFS Connected</span>
                </div>
              )}
              <div className="connection-status">
                <div className="status-dot"></div>
                <span>Database Connected</span>
              </div>
            </div>
          )}
          <button 
            className="fullscreen-toggle" 
            onClick={toggleFullScreen}
            title={isFullScreen ? "Exit full screen" : "Enter full screen"}
            aria-label={isFullScreen ? "Exit full screen" : "Enter full screen"}
          />
        </div>
      </div>

      <div className="main-content">
        <div className="visualization-container">
          <div className="thread-controls">
            <div className="custom-select">
              <button 
                className="thread-selector"
                onClick={() => setShowThreadDropdown(!showThreadDropdown)}
              >
                {selectedThreadId ? 
                  displayThreads.find(t => t.id === selectedThreadId)?.metadata?.title || `Thread ${selectedThreadId}` 
                  : 'Select a Thread'}
              </button>
              {showThreadDropdown && (
                <div className="dropdown-menu">
                  <div 
                    className="dropdown-item create-thread-option"
                    onClick={() => {
                      setShowCreateThreadModal(true);
                      setShowThreadDropdown(false);
                    }}
                  >
                    + Create New Thread
                  </div>
                  {displayThreads.map(thread => (
                    <div
                      key={thread.id}
                      className="dropdown-item"
                      onClick={() => {
                        setSelectedThreadId(thread.id);
                        setShowThreadDropdown(false);
                      }}
                    >
                      {thread.metadata?.title || `Thread ${thread.id}`}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="search-container">
              <input
                type="text"
                className="search-input"
                placeholder="Search threads..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSearchResults(true);
                }}
                onFocus={() => setShowSearchResults(true)}
              />
              {showSearchResults && searchQuery && (
                <div className="search-results">
                  {filteredThreads.length > 0 ? (
                    filteredThreads.map(thread => (
                      <div
                        key={thread.id}
                        className="search-result-item"
                        onClick={() => {
                          setSelectedThreadId(thread.id);
                          setSearchQuery('');
                          setShowSearchResults(false);
                        }}
                      >
                        {thread.metadata?.title || `Thread ${thread.id}`}
                      </div>
                    ))
                  ) : (
                    <div className="no-results">No threads found</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {selectedThreadId ? (
            <>
              <ThreadGraph 
                threads={graphData} 
                onNodeClick={handleNodeClick}
                onAddNode={handleAddNode}
                loading={loading}
              />
            </>
          ) : (
            <div className="no-thread-message">
              Please select a thread from the dropdown
            </div>
          )}
        </div>

        {showCreateThreadModal && (
          <div className="modal-overlay" onClick={() => setShowCreateThreadModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Create New Thread</h3>
                <button className="close-button" onClick={() => setShowCreateThreadModal(false)}>×</button>
              </div>
              <div className="modal-body">
                <div className="create-thread-form">
                  <input
                    type="text"
                    placeholder="Title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="thread-input"
                  />
                  <input
                    type="text"
                    placeholder="Description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="thread-input"
                  />
                  <textarea
                    placeholder="Content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="thread-input"
                    rows={6}
                  />
                  <div className="form-buttons">
                    <button 
                      className="cancel-button"
                      onClick={() => setShowCreateThreadModal(false)}
                      disabled={loading}
                    >
                      Cancel
                    </button>
                    <button 
                      className="submit-button"
                      onClick={async () => {
                        await createThread();
                        if (!error) {
                          setShowCreateThreadModal(false);
                        }
                      }} 
                      disabled={loading || !contract}
                    >
                      {loading ? 'Creating...' : 'Create Thread'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedNode && (
          <NodeDetailsModal
            node={selectedNode}
            onClose={handleCloseModal}
            onVote={handleVote}
            onCreateProposal={handleCreateProposal}
            onAddNode={handleAddNode}
            loading={loading}
            voteAmount={voteAmount}
            setVoteAmount={setVoteAmount}
          />
        )}
      </div>
    </div>
  );
}

export default App;
