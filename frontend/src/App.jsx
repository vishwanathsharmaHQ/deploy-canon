import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ethers } from 'ethers'
import CanonThread from './contracts/CanonThread.json'
import CanonToken from './contracts/CanonToken.json'
import deployments from './contracts/deployments.json'
import { ReactFlowProvider } from '@xyflow/react'
import ThreadGraph from './components/ThreadGraph'
import NodeDetailsModal from './components/NodeDetailsModal'
import ArticleReader from './components/ArticleReader'
import ThreadCanvas from './components/ThreadCanvas'
import SequenceEditor from './components/SequenceEditor'
import ViewTabBar from './components/ViewTabBar'
import NodeEditor from './components/NodeEditor'
import ChatPanel from './components/ChatPanel'
import AuthModal from './components/AuthModal'
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
  const dropdownRef = useRef(null);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [view, setView] = useState('graph'); // 'graph' | 'article' | 'sequence' | 'editor' | 'canvas'
  const [editorNode, setEditorNode] = useState(null);
  const [graphSelectedNodeId, setGraphSelectedNodeId] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const NODE_TYPES = [
    'ROOT',
    'EVIDENCE',
    'REFERENCE',
    'CONTEXT',
    'EXAMPLE',
    'COUNTERPOINT',
    'SYNTHESIS'
  ]

  useEffect(() => {
    api.getMe().then(setCurrentUser).catch(() => {});
  }, []);

  function requireLogin(action) {
    if (!currentUser) { setShowAuthModal(true); return; }
    action();
  }

  useEffect(() => {
    if (isOnChain) {
      connectWallet()
    }
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
        // setError("Failed to connect wallet. Make sure you're on the Hardhat Local network.");
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

      if (!title.trim()) {
        setError('Title is required');
        setLoading(false);
        return;
      }

      console.log('Creating thread with content:', { title, description, content });
      
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
        
        // Get the new thread ID
        const threadId = await contract.threadCounter();
        
        // Clear form and close modal
        setTitle('');
        setDescription('');
        setContent('');
        setShowCreateThreadModal(false);

        // Reload threads and set the new thread as selected
        await loadThreads();
        setSelectedThreadId(Number(threadId));
      } else {
        // Off-chain creation
        const newThread = await api.createThread({
          title,
          description,
          content: '',
          metadata: {
            createdAt: new Date().toISOString(),
            version: 1,
            title,
            description
          }
        });

        console.log('Created thread:', newThread);

        // Clear form and close modal
        setTitle('');
        setDescription('');
        setContent('');
        setShowCreateThreadModal(false);

        // Update off-chain threads and set the new thread as selected
        await loadOffChainThreads();
        setSelectedThreadId(newThread.id);

        // Navigate to article view for content editing
        setView('article');
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

      // Load the latest thread first
      if (threadCount > 0) {
        const latestThreadId = Number(threadCount);
        const threadData = await contract.threads(latestThreadId);
        
        if (threadData && threadData.creator !== '0x0000000000000000000000000000000000000000') {
          // Set basic thread info immediately
          const metadata = await fetchFromIPFS(threadData.metadataHash);
          const content = await fetchFromIPFS(threadData.contentHash);
          
          // Set initial thread data without nodes
          const initialThread = {
            ...threadData,
            metadata,
            content,
            nodes: [], // Start with empty nodes
            id: latestThreadId,
            hasVoted: false, // Will be updated
            votesFor: ethers.parseEther("0"),
            votesAgainst: ethers.parseEther("0"),
            proposalDeadline: 0,
            hasActiveProposal: false
          };
          
          setThreads([initialThread]);
          setSelectedThreadId(latestThreadId);

          // Load additional thread data in the background
          const loadThreadDetails = async () => {
            const nodeCount = await contract.nodeCounter();
            const proposalCount = await contract.proposalCounter();
            const currentTimestamp = Math.floor(Date.now() / 1000);
            
            const hasVotedOnThread = await contract.hasVoted(latestThreadId, account);
            
            // Load nodes
            const nodes = [];
            for (let j = 1; j <= nodeCount; j++) {
              const nodeData = await contract.nodes(j);
              if (nodeData && 
                  nodeData.threadId.toString() === latestThreadId.toString() && 
                  nodeData.contentHash !== '') {
                const nodeMetadata = await fetchFromIPFS(nodeData.metadataHash);
                const nodeContent = await fetchFromIPFS(nodeData.contentHash);
                const hasVotedOnNode = await contract.hasVoted(j, account);
                
                nodes.push({
                  ...nodeData,
                  metadata: nodeMetadata,
                  content: nodeContent,
                  id: j,
                  type: Number(nodeData.nodeType),
                  hasVoted: hasVotedOnNode
                });
              }
            }

            // Find the latest proposal
            let votesFor = ethers.parseEther("0");
            let votesAgainst = ethers.parseEther("0");
            let proposalDeadline = 0;
            let hasActiveProposal = false;

            for (let j = 1; j <= proposalCount; j++) {
              const proposal = await contract.proposals(j);
              if (proposal.threadId.toString() === latestThreadId.toString() && !proposal.executed) {
                votesFor = proposal.votesFor;
                votesAgainst = proposal.votesAgainst;
                proposalDeadline = Number(proposal.deadline);
                hasActiveProposal = currentTimestamp < proposalDeadline + 60;
                break;
              }
            }

            // Update thread with complete data
            setThreads(prevThreads => [{
              ...prevThreads[0],
              nodes,
              hasVoted: hasVotedOnThread,
              votesFor,
              votesAgainst,
              proposalDeadline,
              hasActiveProposal
            }]);
          };

          // Start loading details in the background
          loadThreadDetails();
        }
      }

      // Load remaining threads in the background
      const loadRemainingThreads = async () => {
        const nodeCount = await contract.nodeCounter();
        const proposalCount = await contract.proposalCounter();
        const currentTimestamp = Math.floor(Date.now() / 1000);
        
        // Load threads in reverse order (newest to oldest, excluding the latest one)
        for (let i = threadCount - 1; i >= 1; i--) {
          const threadData = await contract.threads(i);
          if (threadData && threadData.creator !== '0x0000000000000000000000000000000000000000') {
            // Set basic thread info first
            const metadata = await fetchFromIPFS(threadData.metadataHash);
            const content = await fetchFromIPFS(threadData.contentHash);
            
            // Add thread with basic info
            setThreads(prevThreads => [...prevThreads, {
              ...threadData,
              metadata,
              content,
              nodes: [],
              id: i,
              hasVoted: false,
              votesFor: ethers.parseEther("0"),
              votesAgainst: ethers.parseEther("0"),
              proposalDeadline: 0,
              hasActiveProposal: false
            }]);

            // Load complete thread data
            const hasVotedOnThread = await contract.hasVoted(i, account);
            const nodes = [];
            
            // Load nodes
            for (let j = 1; j <= nodeCount; j++) {
              const nodeData = await contract.nodes(j);
              if (nodeData && 
                  nodeData.threadId.toString() === i.toString() && 
                  nodeData.contentHash !== '') {
                const nodeMetadata = await fetchFromIPFS(nodeData.metadataHash);
                const nodeContent = await fetchFromIPFS(nodeData.contentHash);
                const hasVotedOnNode = await contract.hasVoted(j, account);
                
                nodes.push({
                  ...nodeData,
                  metadata: nodeMetadata,
                  content: nodeContent,
                  id: j,
                  type: Number(nodeData.nodeType),
                  hasVoted: hasVotedOnNode
                });
              }
            }

            // Find the latest proposal
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

            // Update thread with complete data
            setThreads(prevThreads => prevThreads.map(t => 
              t.id === i ? {
                ...t,
                nodes,
                hasVoted: hasVotedOnThread,
                votesFor,
                votesAgainst,
                proposalDeadline,
                hasActiveProposal
              } : t
            ));
          }
        }
      };

      // Start loading remaining threads in the background
      loadRemainingThreads();
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

  const handleUpdateNode = async ({ nodeId, threadId }, { title, content }) => {
    try {
      await api.updateNode(threadId, nodeId, { title, content });
      await loadOffChainThreads();
    } catch (error) {
      console.error('Error updating node:', error);
      setError('Failed to update node: ' + error.message);
    }
  };

  const handleAddNode = async (threadData) => {
    if (isOnChain && (!contract || !account)) {
      console.log("No contract or account for on-chain operation");
      return;
    }
    
    const { id, newNode } = threadData;
    console.log('Creating node with data:', newNode);
    
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

        const tx = await contract.createNode(id, metadataHash, contentHash, newNode.type);
        await tx.wait();
        await loadThreads();
      } else {
        // Off-chain node creation
        console.log("Creating off-chain node with type:", newNode.type);
        const nodeType = typeof newNode.type === 'number' ? 
          NODE_TYPES[newNode.type] : 
          newNode.type || NODE_TYPES[0];

        const createdNode = await api.createNode({
          threadId: newNode.threadId,
          title: newNode.title,
          content: newNode.content,
          nodeType,
          parentId: newNode.parentId,
          metadata: {
            title: newNode.title,
            description: newNode.content.substring(0, 100) + (newNode.content.length > 100 ? '...' : ''),
            createdAt: new Date().toISOString()
          }
        });

        // Refresh the thread data to get the latest nodes and edges
        const { nodes, edges } = await api.getThreadNodes(newNode.threadId);
        
        // Update offChainThreads with the latest data
        const updatedThread = {
          ...threadData,
          nodes: nodes.map(node => ({
            ...node,
            id: node.id,
            type: NODE_TYPES.indexOf(node.node_type),
            content: node.content,
            parent_id: node.parent_id
          })),
          edges
        };
        
        // Refresh all off-chain threads to update the graph in place
        await loadOffChainThreads();
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
      console.log('Loaded threads:', threads);
      
      // Load nodes for each thread
      const threadsWithNodes = await Promise.all(
        threads.map(async thread => {
          const { nodes, edges } = await api.getThreadNodes(thread.id);
          console.log(`Loaded nodes for thread ${thread.id}:`, nodes);
          return {
            ...thread,
            content: thread.content || thread.metadata?.content,
            nodes: nodes.map(node => ({
              ...node,
              content: node.content || node.metadata?.content,
              type: NODE_TYPES.indexOf(node.node_type)
            })),
            edges
          };
        })
      );
      
      console.log('Threads with nodes:', threadsWithNodes);
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

  const currentThreadIndex = displayThreads.findIndex(t => t.id === selectedThreadId);
  const hasPrevThread = currentThreadIndex > 0;
  const hasNextThread = currentThreadIndex >= 0 && currentThreadIndex < displayThreads.length - 1;

  const handlePrevThread = () => {
    if (hasPrevThread) {
      setSelectedThreadId(displayThreads[currentThreadIndex - 1].id);
    }
  };

  const handleNextThread = () => {
    if (hasNextThread) {
      setSelectedThreadId(displayThreads[currentThreadIndex + 1].id);
    }
  };

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
  const filteredThreads = useMemo(() => {
    if (!searchQuery) return [];
    return displayThreads.filter(thread => 
      thread.metadata?.title?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [displayThreads, searchQuery]);

  const toggleFullScreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
      setIsFullScreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullScreen(false);
      }
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

  // Add click outside handler
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowThreadDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleThreadSelect = async (threadId) => {
    setSelectedThreadId(threadId);
    setShowSearchResults(false);
    setView('graph');
  };

  // Modify the search functionality
  const handleSearchInputChange = async (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    if (query) {
      setShowSearchResults(true);
    } else {
      setShowSearchResults(false);
    }
  };

  const handleSearchSubmit = async (e) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      e.preventDefault();
      try {
        setIsSearchLoading(true);
        const results = await api.searchThreads(searchQuery);
        
        // If no exact matches found, generate new thread
        if (results.length === 0) {
          if (!currentUser) { setShowAuthModal(true); return; }
          const newThread = await api.generateThread(searchQuery);
          setSelectedThreadId(newThread.id);
          await loadOffChainThreads(); // Reload threads to get the new one
          setSearchQuery('');
          setShowSearchResults(false);
        } else {
          // Merge search results into offChainThreads, then show
          setOffChainThreads(prev => {
            const existingIds = new Set(prev.map(t => t.id));
            const newThreads = results.filter(t => !existingIds.has(t.id));
            return [...prev, ...newThreads];
          });
          setShowSearchResults(true);
        }
      } catch (err) {
        console.error('Search/Generate error:', err);
        setError('Failed to search or generate thread');
      } finally {
        setIsSearchLoading(false);
      }
    }
  };

  return (
    <div className="app">
      {error && <div className="error">{error}</div>}
      
      <div className="header">
        <div className="header-center">
          <h1>canonthread</h1>
        </div>

        <div className="header-right">
          {currentUser ? (
            <div className="user-menu">
              <span className="user-email">{currentUser.email}</span>
              <button className="btn-outline" onClick={() => { api.logout(); setCurrentUser(null); }}>
                Sign out
              </button>
            </div>
          ) : (
            <button className="btn-primary" onClick={() => setShowAuthModal(true)}>
              Sign in
            </button>
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
        {(threadToShow || view === 'chat') && (
          <ViewTabBar
            view={view}
            onChangeView={(newView) => {
              if (newView === 'sequence' || newView === 'editor') {
                requireLogin(() => setView(newView));
              } else {
                setView(newView);
              }
            }}
            threadTitle={threadToShow?.metadata?.title || threadToShow?.title || (threadToShow ? `Thread ${threadToShow.id}` : '')}
            onPrevThread={handlePrevThread}
            onNextThread={handleNextThread}
            hasPrev={hasPrevThread}
            hasNext={hasNextThread}
          />
        )}
        {view === 'editor' && editorNode && threadToShow ? (
          <NodeEditor
            thread={threadToShow}
            selectedNode={editorNode}
            onSubmit={async (data) => { await handleAddNode(data); setView('graph'); setEditorNode(null); }}
            onCancel={() => { setView('graph'); setEditorNode(null); }}
          />
        ) : view === 'sequence' && threadToShow ? (
          <SequenceEditor
            thread={threadToShow}
            onDone={() => setView('article')}
          />
        ) : view === 'canvas' && threadToShow ? (
          <ThreadCanvas
            thread={threadToShow}
          />
        ) : view === 'article' && threadToShow ? (
          <ArticleReader
            thread={threadToShow}
            initialNodeId={graphSelectedNodeId}
            currentUser={currentUser}
            onAuthRequired={() => setShowAuthModal(true)}
            onContentChange={(html) => {
              setOffChainThreads(prev => prev.map(t =>
                t.id === threadToShow.id ? { ...t, content: html } : t
              ));
            }}
            onUpdateNode={handleUpdateNode}
            onNodesCreated={async (tid) => {
              await loadOffChainThreads();
              setSelectedThreadId(tid);
            }}
            onThreadCreated={async (tid) => {
              await loadOffChainThreads();
              setSelectedThreadId(tid);
            }}
          />
        ) : null}

        {/* Chat — always mounted to preserve conversation across tab switches */}
        <div style={{ display: view === 'chat' ? undefined : 'none', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <ChatPanel
            selectedThreadId={selectedThreadId}
            currentUser={currentUser}
            onAuthRequired={() => setShowAuthModal(true)}
            onNodesCreated={async (tid) => {
              await loadOffChainThreads();
              setSelectedThreadId(tid);
            }}
            onThreadCreated={async (tid) => {
              await loadOffChainThreads();
              setSelectedThreadId(tid);
            }}
          />
        </div>

        {/* Graph view — always mounted to avoid remount/layout-jump, hidden via CSS */}
        <div className="visualization-container" style={{ display: view === 'graph' ? undefined : 'none' }}>
          <div className="thread-controls">
            <div className="custom-select" ref={dropdownRef}>
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
                    onClick={() => requireLogin(() => {
                      setShowCreateThreadModal(true);
                      setShowThreadDropdown(false);
                    })}
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
                onChange={handleSearchInputChange}
                onKeyDown={handleSearchSubmit}
                onFocus={() => setShowSearchResults(true)}
              />
              {showSearchResults && searchQuery && (
                <div className="search-results">
                  {isSearchLoading ? (
                    <div className="loading-results">
                      <div className="loading-spinner"></div>
                      <p>Generating thread for "{searchQuery}"...</p>
                    </div>
                  ) : filteredThreads.length > 0 ? (
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
                    <div className="no-results">Press Enter to generate a new thread about "{searchQuery}"</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {selectedThreadId ? (
            <ReactFlowProvider>
              <ThreadGraph
                threads={graphData}
                onNodeClick={handleNodeClick}
                onAddNode={handleAddNode}
                onOpenEditor={(node) => requireLogin(() => { setEditorNode(node); setView('editor'); })}
                onSelectedNodeChange={setGraphSelectedNodeId}
                loading={loading}
              />
            </ReactFlowProvider>
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
                      disabled={loading || (isOnChain && !contract)}
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

        {showAuthModal && (
          <AuthModal
            onSuccess={(user) => { setCurrentUser(user); setShowAuthModal(false); }}
            onClose={() => setShowAuthModal(false)}
          />
        )}
      </div>
    </div>
  );
}

export default App;
