import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Youtube from '@tiptap/extension-youtube';
import Placeholder from '@tiptap/extension-placeholder';
import ChatPanel from './ChatPanel';
import SocraticPanel from './SocraticPanel';
import EditorToolbar from './EditorToolbar';
import SourceVerifyBadge from './SourceVerifyBadge';
import ConfidenceMeter from './ConfidenceMeter';
import SecondaryNodePanel from './SecondaryNodePanel';
import ThreadContentEditor from './ThreadContentEditor';
import { api } from '../services/api';
import { NODE_TYPE_COLORS, EXPANDABLE_NODE_TYPES, ENTITY_TYPE_LABELS } from '../constants';
import {
  embedYouTubeLinks,
  getNodeType,
  getEditableContent,
  buildSavedContent,
  renderContent,
  formatNodeContent,
} from '../utils/articleContent';
import type { Thread, ThreadNode, NodeTypeName, User } from '../types';
import './ArticleReader.css';

// ── Component ─────────────────────────────────────────────────────────────────

interface ProposedUpdate {
  nodeId: number;
  title: string;
  description: string;
}

interface ArticleReaderProps {
  thread: Thread;
  initialNodeId?: number | null;
  onContentChange?: (html: string) => void;
  onUpdateNode?: (target: { nodeId: number; threadId: number }, data: { title: string; content: string }) => Promise<void>;
  onNodesCreated?: (threadId: number) => void;
  onThreadCreated?: (threadId: number) => void;
  onViewInGraph?: (nodeId: number) => void;
  currentUser: User | null | undefined;
  onAuthRequired?: () => void;
}

const ArticleReader: React.FC<ArticleReaderProps> = ({ thread, initialNodeId, onContentChange, onUpdateNode, onNodesCreated, onThreadCreated, onViewInGraph, currentUser, onAuthRequired }) => {
  const [currentPage, setCurrentPage] = useState(0);
  const [orderedNodes, setOrderedNodes] = useState<ThreadNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const [selectedSecondaryId, setSelectedSecondaryId] = useState<number | string | null>(null);
  const [socraticOpen, setSocraticOpen] = useState(false);
  const [secondaryWidth, setSecondaryWidth] = useState(400);
  const [chatWidth, setChatWidth] = useState(0); // 0 means use CSS default (50%)
  const resizingRef = useRef(false);
  const chatResizingRef = useRef(false);
  // Red Team / Steelman — proposals shown in secondary panel with Accept/Discard
  const [redTeamLoading, setRedTeamLoading] = useState(false);
  const [steelmanLoading, setSteelmanLoading] = useState(false);
  const [secondaryPinnedNodes, setSecondaryPinnedNodes] = useState<ThreadNode[] | null>(null);
  const [secondaryPanelLabel, setSecondaryPanelLabel] = useState('Supporting Nodes');
  const [pendingProposals, setPendingProposals] = useState<{ nodes: ThreadNode[]; parentNodeId: number; type: string } | null>(null);
  // Enrich
  const [enrichLoading, setEnrichLoading] = useState(false);
  // Fork
  const [forkModalOpen, setForkModalOpen] = useState(false);
  const [forkClaim, setForkClaim] = useState('');
  const [forkLoading, setForkLoading] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<ProposedUpdate | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ nodeId: number; childCount: number } | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editKeywords, setEditKeywords] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Root nodes: nodes without a parent (not a child of any other node)
  const rootNodes = useMemo(() => {
    if (!orderedNodes.length) return [];
    // Nodes that are children via typed relationships (source RELATES_TO target, source is child)
    const childIds = new Set(
      (thread.relationships || []).map(r => r.source_id)
    );
    return orderedNodes.filter(n => !n.parent_id && !childIds.has(n.id));
  }, [orderedNodes, thread.relationships]);

  // Children of the current ROOT node (empty on non-ROOT pages)
  const currentRootChildren = useMemo(() => {
    if (currentPage === 0 || loading || !rootNodes.length) return [];
    const node = rootNodes[currentPage - 1];
    if (!node) return [];
    // Find children via parent_id OR via typed relationships
    const childByParent = orderedNodes.filter(n => n.parent_id === node.id);
    const relChildIds = new Set(
      (thread.relationships || [])
        .filter(r => r.target_id === node.id)
        .map(r => r.source_id)
    );
    const childByRel = orderedNodes.filter(n => relChildIds.has(n.id) && n.parent_id !== node.id);
    return [...childByParent, ...childByRel];
  }, [currentPage, orderedNodes, loading, thread.relationships]);

  // Pinned nodes (Red Team / Steelman results) take precedence over children
  const effectiveSecondaryNodes = secondaryPinnedNodes ?? currentRootChildren;

  // Map of lowercase node titles → { id, pageIndex, title } for cross-node linking
  const nodeLinkMap = useMemo(() => {
    const map = new Map<string, { id: number; pageIndex: number; title: string }>();
    rootNodes.forEach((n, idx) => {
      const title = n.title || '';
      if (title.trim()) {
        map.set(title.toLowerCase(), { id: n.id, pageIndex: idx, title });
      }
    });
    return map;
  }, [rootNodes]);

  // Replace node title mentions in an HTML string with clickable links (excluding currentNodeId)
  const linkifyNodeMentions = useCallback((htmlStr: string, currentNodeId: number): string => {
    if (!htmlStr || nodeLinkMap.size === 0) return htmlStr;
    // Build sorted entries (longest first to avoid partial matches)
    const entries: { lower: string; id: number; pageIndex: number; title: string }[] = [];
    nodeLinkMap.forEach((val, key) => {
      if (val.id !== currentNodeId) entries.push({ lower: key, ...val });
    });
    entries.sort((a, b) => b.lower.length - a.lower.length);
    if (entries.length === 0) return htmlStr;

    // Build a single regex alternation for all titles
    const escaped = entries.map(e => e.lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`(?<![\\w-])(${escaped.join('|')})(?![\\w-])`, 'gi');

    // Split on HTML tags to only replace in text nodes
    const parts = htmlStr.split(/(<[^>]*>)/);
    let inAnchor = 0;
    const result = parts.map(part => {
      if (part.startsWith('<')) {
        if (/^<a[\s>]/i.test(part)) inAnchor++;
        else if (/^<\/a>/i.test(part)) inAnchor = Math.max(0, inAnchor - 1);
        return part;
      }
      if (inAnchor > 0) return part; // don't link inside existing <a> tags
      return part.replace(pattern, (match) => {
        const entry = entries.find(e => e.lower === match.toLowerCase());
        if (!entry) return match;
        return `<a class="ar-node-link" data-node-id="${entry.id}" href="#">${match}</a>`;
      });
    });
    return result.join('');
  }, [nodeLinkMap]);

  // Click delegation for node links in the article body
  const bodyRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const handler = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest('.ar-node-link') as HTMLElement | null;
      if (!link) return;
      e.preventDefault();
      const nodeId = link.dataset.nodeId;
      if (!nodeId) return;
      const numId = parseInt(nodeId);
      const idx = rootNodes.findIndex(n => n.id === numId || String(n.id) === nodeId);
      if (idx >= 0) setCurrentPage(idx + 1);
    };
    body.addEventListener('click', handler);
    return () => body.removeEventListener('click', handler);
  }, [rootNodes]);

  // Resize handler for secondary sidebar
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const startX = e.clientX;
    const startWidth = secondaryWidth;
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = startX - ev.clientX;
      setSecondaryWidth(Math.max(200, Math.min(800, startWidth + delta)));
    };
    const onUp = () => {
      resizingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [secondaryWidth]);

  // Resize handler for chat/socratic sidebar
  const handleChatResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    chatResizingRef.current = true;
    const startX = e.clientX;
    const container = (e.target as HTMLElement).closest('.ar-content-row');
    const containerWidth = container?.clientWidth || window.innerWidth;
    const startWidth = chatWidth || containerWidth * 0.5;
    const onMove = (ev: MouseEvent) => {
      if (!chatResizingRef.current) return;
      const delta = startX - ev.clientX;
      setChatWidth(Math.max(250, Math.min(containerWidth * 0.7, startWidth + delta)));
    };
    const onUp = () => {
      chatResizingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [chatWidth]);

  const handleRedTeam = async (node: ThreadNode) => {
    if (!currentUser) { onAuthRequired?.(); return; }
    setRedTeamLoading(true);
    try {
      const { proposals, parentNodeId } = await api.redTeamThread(thread.id, node.id);
      // Proposals are not saved yet — show with Accept/Discard in secondary panel
      const previewNodes = proposals.map((p: { title: string; content: string; entityType: string }, i: number) => ({ ...p, id: `pending-rt-${i}` as unknown as number, node_type: p.entityType?.toUpperCase() || 'COUNTERPOINT', parent_id: parentNodeId } as unknown as ThreadNode));
      setPendingProposals({ nodes: previewNodes, parentNodeId, type: 'redteam' });
      setSecondaryPinnedNodes(previewNodes);
      setSecondaryPanelLabel('⚔ Red Team — Review');
      setSecondaryOpen(true);
      setSelectedSecondaryId(previewNodes[0]?.id ?? null);
    } catch (err) {
      console.error('Red team failed:', err);
    } finally {
      setRedTeamLoading(false);
    }
  };

  const handleSteelman = async (nodeId: number) => {
    if (!currentUser) { onAuthRequired?.(); return; }
    setSteelmanLoading(true);
    try {
      const { proposal, parentId } = await api.steelmanNode(thread.id, nodeId);
      const previewNode = { ...proposal, id: 'pending-steelman' as unknown as number, node_type: proposal.entityType?.toUpperCase() || 'COUNTERPOINT', parent_id: parentId } as unknown as ThreadNode;
      setPendingProposals({ nodes: [previewNode], parentNodeId: parentId ?? 0, type: 'steelman' });
      setSecondaryPinnedNodes([previewNode]);
      setSecondaryPanelLabel('▲ Steelmanned — Review');
      setSecondaryOpen(true);
      setSelectedSecondaryId(previewNode.id);
    } catch (err) {
      console.error('Steelman failed:', err);
    } finally {
      setSteelmanLoading(false);
    }
  };

  const enrichedNodeRef = useRef<number | null>(null);

  const handleEnrich = async (nodeId: number) => {
    if (!currentUser) { onAuthRequired?.(); return; }
    setEnrichLoading(true);
    enrichedNodeRef.current = nodeId;
    try {
      await api.enrichNode(thread.id, nodeId);
      onNodesCreated?.(thread.id);
    } catch (err) {
      console.error('Enrich failed:', err);
      enrichedNodeRef.current = null;
    } finally {
      setEnrichLoading(false);
    }
  };

  const handleAcceptProposals = async () => {
    if (!pendingProposals) return;
    try {
      const { createdNodes } = await api.createNodesBatch(thread.id, pendingProposals.nodes.map(n => {
        const nt = (n.node_type || '').toLowerCase();
        const relationType = nt === 'counterpoint' ? 'CONTRADICTS' : nt === 'evidence' ? 'SUPPORTS' : nt === 'context' ? 'QUALIFIES' : nt === 'example' ? 'ILLUSTRATES' : nt === 'source' ? 'CITES' : 'SUPPORTS';
        return {
          title: n.title,
          content: n.content,
          nodeType: n.node_type,
          parentId: pendingProposals.parentNodeId,
          connectTo: { targetId: pendingProposals.parentNodeId, relationType },
        };
      }));
      const nodesWithParent = createdNodes.map(n => ({ ...n, parent_id: pendingProposals.parentNodeId }));
      setOrderedNodes(prev => [...prev, ...nodesWithParent]);
      setSecondaryPinnedNodes(nodesWithParent);
      setSecondaryPanelLabel(pendingProposals.type === 'redteam' ? '⚔ Red Team' : '▲ Steelmanned');
      setSelectedSecondaryId(createdNodes[0]?.id ?? null);
      setPendingProposals(null);
      onNodesCreated?.(thread.id);
    } catch (err) {
      console.error('Accept proposals failed:', err);
    }
  };

  const handleDiscardProposals = () => {
    setPendingProposals(null);
    setSecondaryPinnedNodes(null);
    setSecondaryPanelLabel('Supporting Nodes');
    if (currentRootChildren.length > 0) {
      setSecondaryOpen(true);
      setSelectedSecondaryId(currentRootChildren[0].id);
    } else {
      setSecondaryOpen(false);
    }
  };

  const handleFork = async () => {
    if (!currentUser) { onAuthRequired?.(); return; }
    setForkLoading(true);
    try {
      const { thread: forked } = await api.forkThread(thread.id, { altClaim: forkClaim.trim() || undefined });
      setForkModalOpen(false);
      setForkClaim('');
      onThreadCreated?.(forked.id);
    } catch (err) {
      console.error('Fork failed:', err);
    } finally {
      setForkLoading(false);
    }
  };

  const nodeEditEditor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false }),
      Youtube.configure({ width: 640, height: 360 }),
      Placeholder.configure({ placeholder: 'Edit content...' }),
    ],
    content: '',
  });

  // Reset edit mode when navigating to a different page
  useEffect(() => {
    setIsEditing(false);
  }, [currentPage]);

  // Auto-open secondary panel when on a ROOT page with children; clear pins on navigation.
  // Never auto-close — prevents layout jump when paginating between nodes with/without children.
  useEffect(() => {
    setSecondaryPinnedNodes(null);
    setSecondaryPanelLabel('Supporting Nodes');
    if (currentRootChildren.length > 0) {
      setSecondaryOpen(true);
      setSelectedSecondaryId((id: number | string | null) =>
        id && currentRootChildren.some(n => n.id === id) ? id : currentRootChildren[0].id
      );
    } else {
      setSelectedSecondaryId(null);
      // Don't setSecondaryOpen(false) — sidebar stays to avoid layout jump
    }
  }, [currentPage]); // intentionally only re-runs on page change

  useEffect(() => {
    if (!thread?.id) return;
    loadOrder();
  }, [thread?.id, thread?.nodes?.length]);

  // When initialNodeId changes (e.g. user selected a node then clicked Article tab), navigate to it
  useEffect(() => {
    if (!initialNodeId || rootNodes.length === 0) return;
    // Check if it's a root node directly, or find its parent root
    let idx = rootNodes.findIndex(n => n.id === initialNodeId);
    if (idx < 0) {
      // It's a child node — find its parent root
      const childNode = orderedNodes.find(n => n.id === initialNodeId);
      if (childNode?.parent_id) {
        idx = rootNodes.findIndex(n => n.id === childNode.parent_id);
      }
      if (idx < 0) {
        // Check relationships
        const rel = (thread.relationships || []).find(r => r.source_id === initialNodeId);
        if (rel) idx = rootNodes.findIndex(n => n.id === rel.target_id);
      }
    }
    if (idx >= 0) {
      setCurrentPage(idx + 1); // +1 because page 0 is thread overview
    }
  }, [initialNodeId, orderedNodes]);

  const loadOrder = async () => {
    setLoading(true);
    try {
      const nodes = thread.nodes || [];
      const saved = await api.loadArticleSequence(thread.id);

      let ordered: ThreadNode[];
      if (saved && Array.isArray(saved)) {
        const savedSet = new Set(saved);
        const savedOrdered = saved.map((id: number) => nodes.find(n => n.id === id)).filter((n): n is ThreadNode => Boolean(n));
        const remaining = nodes.filter(n => !savedSet.has(n.id));
        ordered = [...savedOrdered, ...remaining];
      } else {
        ordered = [...nodes];
      }
      setOrderedNodes(prev => {
        // If nodes changed (enrich/add), preserve current page
        const isRefresh = prev.length > 0 && ordered.length > prev.length;
        if (isRefresh) {
          // Check if enrich just completed — auto-open sidebar for the enriched node
          const enrichedId = enrichedNodeRef.current;
          if (enrichedId) {
            enrichedNodeRef.current = null;
            // Find new children of the enriched node
            const newChildIds = new Set(ordered.filter(n => n.parent_id === enrichedId).map(n => n.id));
            const newRelChildIds = new Set(
              (thread.relationships || [])
                .filter(r => r.target_id === enrichedId)
                .map(r => r.source_id)
            );
            const allChildIds = new Set([...newChildIds, ...newRelChildIds]);
            if (allChildIds.size > 0) {
              const children = ordered.filter(n => allChildIds.has(n.id));
              if (children.length > 0) {
                setSecondaryOpen(true);
                setSecondaryPinnedNodes(null);
                setSecondaryPanelLabel('Supporting Nodes');
                setSelectedSecondaryId(children[0].id);
              }
            }
          }
          return ordered;
        }

        // Initial load — set page (filter to root nodes for page index)
        const relChildIds = new Set((thread.relationships || []).map(r => r.source_id));
        const roots = ordered.filter(n => !n.parent_id && !relChildIds.has(n.id));
        if (initialNodeId) {
          const idx = roots.findIndex(n => n.id === initialNodeId);
          setCurrentPage(idx >= 0 ? idx + 1 : 0);
        } else {
          setCurrentPage(0);
        }
        return ordered;
      });
    } catch (err) {
      console.error('Failed to load article sequence:', err);
      const fallback = [...(thread.nodes || [])];
      setOrderedNodes(fallback);
      const relChildIds = new Set((thread.relationships || []).map(r => r.source_id));
      const roots = fallback.filter(n => !n.parent_id && !relChildIds.has(n.id));
      if (initialNodeId) {
        const idx = roots.findIndex(n => n.id === initialNodeId);
        setCurrentPage(idx >= 0 ? idx + 1 : 0);
      } else {
        setCurrentPage(0);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!thread) return null;

  const totalPages = 1 + rootNodes.length;

  // Context passed to chat so it knows what article the user is viewing
  const currentArticleContext = (() => {
    if (loading) return null;
    if (currentPage === 0) {
      // Thread overview — provide thread-level context
      const nodeSummary = orderedNodes.slice(0, 15).map(n => `[${getNodeType(n)}] ${n.title || 'Untitled'}`).join('; ');
      return {
        threadTitle: thread.title || `Thread ${thread.id}`,
        threadDescription: thread.description || '',
        threadType: thread.thread_type || 'argument',
        nodesSummary: nodeSummary || 'No nodes yet',
      };
    }
    const node = rootNodes[currentPage - 1];
    if (!node) return null;
    return {
      nodeId: node.id,
      nodeType: getNodeType(node),
      title: node.title || `Node ${node.id}`,
      content: node.content || '',
    };
  })();

  const handleProposedUpdate = async (update: ProposedUpdate) => {
    if (!update || !update.nodeId || !onUpdateNode) return;
    const node = orderedNodes.find(n => n.id === update.nodeId);
    if (!node) return;
    const nodeType = getNodeType(node);

    // Preserve existing fields (e.g. keywords for ROOT), only replace title + body
    let existingParsed: Record<string, unknown> = {};
    if (typeof node.content === 'string') {
      try { existingParsed = JSON.parse(node.content); } catch (e) { /* ignore */ }
    }

    let newContent: string;
    const ntLower = nodeType.toLowerCase();
    if (ntLower === 'claim') {
      newContent = JSON.stringify({
        title: update.title,
        description: update.description,
        keywords: existingParsed.keywords || [],
      });
    } else if (ntLower === 'example') {
      newContent = JSON.stringify({ title: update.title, description: update.description });
    } else if (ntLower === 'counterpoint') {
      newContent = JSON.stringify({ argument: update.title, explanation: update.description });
    } else if (ntLower === 'evidence') {
      newContent = JSON.stringify({ point: update.description, source: existingParsed.source || '' });
    } else {
      newContent = update.description;
    }

    try {
      await onUpdateNode(
        { nodeId: update.nodeId, threadId: thread.id },
        { title: update.title, content: newContent }
      );
      setOrderedNodes(prev => prev.map(n =>
        n.id === update.nodeId ? { ...n, title: update.title, content: newContent } : n
      ));
      // Navigate to the updated node so the user sees the result
      const idx = orderedNodes.findIndex(n => n.id === update.nodeId);
      if (idx >= 0) setCurrentPage(idx + 1);
    } catch (e) {
      console.error('Failed to apply proposed update:', e);
    }
  };

  const handleDeleteNode = async (nodeId: number) => {
    try {
      const result = await api.deleteNode(thread.id, nodeId);
      if (result.hasChildren) {
        setDeleteConfirm({ nodeId, childCount: result.childCount ?? 0 });
        return;
      }
      // Deleted — remove from ordered nodes and navigate
      setOrderedNodes(prev => prev.filter(n => n.id !== nodeId));
      setCurrentPage(p => Math.max(0, p - 1));
      onNodesCreated?.(thread.id); // refresh thread data
    } catch (e) {
      console.error('Delete node failed:', e);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await api.deleteNode(thread.id, deleteConfirm.nodeId, true);
      setOrderedNodes(prev => prev.filter(n => n.id !== deleteConfirm.nodeId));
      setCurrentPage(p => Math.max(0, p - 1));
      setDeleteConfirm(null);
      onNodesCreated?.(thread.id);
    } catch (e) {
      console.error('Force delete failed:', e);
    }
  };

  const renderPage = (): React.ReactNode => {
    if (currentPage === 0) {
      return <ThreadContentEditor thread={thread} onContentChange={onContentChange} currentUser={currentUser} onAuthRequired={onAuthRequired} />;
    }

    const node = rootNodes[currentPage - 1];
    if (!node) return <p className="ar-empty">Node not found.</p>;

    const nodeType = getNodeType(node);
    const color = NODE_TYPE_COLORS[nodeType as NodeTypeName] || '#888';
    const nodeTitle = node.title || `Node ${node.id}`;
    const nodeLinkify = (html: string) => linkifyNodeMentions(html, node.id);
    const nodeRendered = formatNodeContent(node, SourceVerifyBadge, nodeLinkify);
    const isReactElement = React.isValidElement(nodeRendered);

    const handleEditStart = () => {
      if (!currentUser) { onAuthRequired?.(); return; }
      const { title, html, keywords } = getEditableContent(node);
      setEditTitle(title);
      setEditKeywords(keywords || '');
      nodeEditEditor?.commands.setContent(embedYouTubeLinks(html || ''));
      setIsEditing(true);
    };

    const handleEditSave = async () => {
      if (!nodeEditEditor || !onUpdateNode) return;
      const html = nodeEditEditor.getHTML();
      const newContent = buildSavedContent(nodeType, editTitle, html, editKeywords);
      setEditSaving(true);
      try {
        await onUpdateNode(
          { nodeId: node.id, threadId: thread.id },
          { title: editTitle, content: newContent }
        );
        // Optimistically update the local node list so read view reflects changes
        setOrderedNodes(prev => prev.map(n =>
          n.id === node.id ? { ...n, title: editTitle, content: newContent } : n
        ));
        setIsEditing(false);
      } catch (e) {
        console.error('Failed to save node:', e);
      } finally {
        setEditSaving(false);
      }
    };

    return (
      <article className="ar-article">
        <div className="ar-node-header">
          <div className="ar-node-badge" style={{ color, borderColor: color }}>{ENTITY_TYPE_LABELS[nodeType.toLowerCase()] || nodeType}</div>
          <div className="ar-node-actions">
            {!isEditing && onViewInGraph && (
              <button
                className="ar-graph-btn"
                onClick={() => onViewInGraph(node.id)}
                title="Jump to this node in Graph view"
              >
                ⬡ Graph
              </button>
            )}
            {!isEditing && onUpdateNode && (
              <button className="ar-edit-btn" onClick={handleEditStart}>Edit</button>
            )}
            {!isEditing && currentUser && (
              <button
                className="ar-delete-btn"
                onClick={() => handleDeleteNode(node.id)}
                title="Delete this node"
              >
                ✕ Delete
              </button>
            )}
            {!isEditing && (
              <>
                <button
                  className="ar-action-btn ar-action-btn--redteam"
                  onClick={() => handleRedTeam(node)}
                  disabled={redTeamLoading}
                  title="Generate sharp counterpoint attacks on this claim's weakest points"
                >
                  {redTeamLoading ? '…' : '⚔ Red Team'}
                </button>
                {nodeType.toLowerCase() === 'claim' && (
                    <button
                      className="ar-action-btn ar-action-btn--fork"
                      onClick={() => setForkModalOpen(true)}
                      title="Clone this thread to explore an alternative claim"
                    >
                      ⑂ Fork
                    </button>
                )}
                {EXPANDABLE_NODE_TYPES.includes(nodeType.toLowerCase() as any) && (
                    <button
                      className="ar-action-btn ar-action-btn--enrich"
                      onClick={() => handleEnrich(node.id)}
                      disabled={enrichLoading}
                      title="Generate child nodes and enrich this node with more detail"
                    >
                      {enrichLoading ? 'Enriching...' : '✦ Enrich'}
                    </button>
                )}
              </>
            )}
            {!isEditing && nodeType.toLowerCase() === 'counterpoint' && (
              <button
                className="ar-action-btn ar-action-btn--steelman"
                onClick={() => handleSteelman(node.id)}
                disabled={steelmanLoading}
                title="Rewrite this counterpoint in its strongest possible form — shown side-by-side for comparison"
              >
                {steelmanLoading ? '…' : '▲ Steelman'}
              </button>
            )}
            {isEditing && (
              <div className="ar-edit-actions">
                <button className="ar-save-btn" onClick={handleEditSave} disabled={editSaving}>
                  {editSaving ? 'Saving…' : 'Save'}
                </button>
                <button className="ar-cancel-btn" onClick={() => setIsEditing(false)} disabled={editSaving}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>


        {isEditing ? (
          <>
            <input
              className="ar-edit-title"
              type="text"
              value={editTitle}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditTitle(e.target.value)}
              placeholder="Title"
            />
            {nodeType === 'claim' && (
              <input
                className="ar-edit-keywords"
                type="text"
                value={editKeywords}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditKeywords(e.target.value)}
                placeholder="Keywords (comma-separated)"
              />
            )}
            <hr className="ar-divider" />
            <div className="ar-editor-section">
              <EditorToolbar editor={nodeEditEditor as any} classPrefix="ar" />
              <div className="ar-editor-wrapper">
                <EditorContent editor={nodeEditEditor} />
              </div>
            </div>
          </>
        ) : (
          <>
            <h1 className="ar-title">{nodeTitle}</h1>
            <hr className="ar-divider" />
            <div className="ar-content">
              {isReactElement ? nodeRendered : renderContent(nodeRendered, (html) => linkifyNodeMentions(html, node.id))}
            </div>
            {nodeType === 'claim' && <ConfidenceMeter threadId={thread.id} />}
            {nodeType === 'claim' && (
              <div className="ar-export-bar" style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
                <button
                  className="ar-action-btn"
                  onClick={async () => {
                    try {
                      const result = await api.exportThread(thread.id, 'markdown');
                      const blob = new Blob([result.content || result.markdown || ''], { type: 'text/markdown' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${thread.metadata?.title || 'thread'}.md`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (e) { console.error('Export failed:', e); }
                  }}
                  title="Export thread as Markdown"
                >
                  ↓ Export
                </button>
              </div>
            )}
          </>
        )}
      </article>
    );
  };

  return (
    <div className="ar-page">
      <div className="ar-content-row">
        {/* ── Main reading area ── */}
        <div className="ar-content-area">
          <main className="ar-body" ref={bodyRef}>
            {loading ? (
              <div className="ar-loading">Loading...</div>
            ) : (
              renderPage()
            )}
          </main>

          {!loading && totalPages > 1 && (
            <div className="ar-nav">
              <button
                className="ar-nav-btn"
                disabled={currentPage === 0}
                onClick={() => setCurrentPage(p => p - 1)}
              >
                &#8592; Prev
              </button>
              <span className="ar-nav-info">
                {currentPage + 1} / {totalPages}
              </span>
              <button
                className="ar-nav-btn"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setCurrentPage(p => p + 1)}
              >
                Next &#8594;
              </button>
            </div>
          )}
        </div>

        {/* ── Secondary nodes sidebar ── */}
        <div
          className={`ar-secondary-sidebar${secondaryOpen ? ' ar-secondary-sidebar--open' : ''}`}
          style={secondaryOpen ? { flexBasis: secondaryWidth, transition: resizingRef.current ? 'none' : undefined } : undefined}
        >
          {secondaryOpen && (
            <div className="ar-resize-handle" onMouseDown={handleResizeStart} />
          )}
          <SecondaryNodePanel
            nodes={effectiveSecondaryNodes}
            selectedId={selectedSecondaryId}
            onSelect={setSelectedSecondaryId}
            label={secondaryPanelLabel}
            onAccept={pendingProposals ? handleAcceptProposals : undefined}
            onDiscard={pendingProposals ? handleDiscardProposals : undefined}
          />
        </div>

        {/* ── Right sidebar: chat OR socratic (mutually exclusive) ── */}
        <div
          className={`ar-chat-sidebar${(chatOpen || socraticOpen) ? ' ar-chat-sidebar--open' : ''}`}
          style={(chatOpen || socraticOpen) && chatWidth ? { flexBasis: chatWidth, transition: chatResizingRef.current ? 'none' : undefined } : undefined}
        >
          {(chatOpen || socraticOpen) && (
            <div className="ar-resize-handle" onMouseDown={handleChatResizeStart} />
          )}
          {socraticOpen ? (
            <SocraticPanel
              thread={thread}
              currentUser={currentUser}
              onAuthRequired={onAuthRequired}
              onNodesCreated={(nodes: ThreadNode[]) => {
                setOrderedNodes(prev => [...prev, ...nodes]);
                onNodesCreated?.(thread.id);
              }}
              nodeContext={currentArticleContext && 'nodeId' in currentArticleContext ? currentArticleContext as { nodeId: number; nodeType: string; title: string; content: string } : null}
            />
          ) : (
            <ChatPanel
              selectedThreadId={thread.id}
              initialThreadId={thread.id}
              currentUser={currentUser}
              onAuthRequired={onAuthRequired}
              onNodesCreated={onNodesCreated}
              onThreadCreated={onThreadCreated}
              articleContext={currentArticleContext}
              onProposedUpdate={handleProposedUpdate}
              defaultSidebarCollapsed={true}
            />
          )}
        </div>
      </div>

      {/* ── Fork modal ── */}
      {forkModalOpen && (
        <div className="ar-modal-overlay" onClick={() => setForkModalOpen(false)}>
          <div className="ar-modal" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <h3 className="ar-modal-title">⑂ Fork Thread</h3>
            <p className="ar-modal-desc">Create an independent copy of this thread to explore an alternative claim. Both versions coexist separately.</p>
            <input
              className="ar-modal-input"
              type="text"
              placeholder="Alternative claim (leave blank to keep original title)"
              value={forkClaim}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForkClaim(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') handleFork(); if (e.key === 'Escape') setForkModalOpen(false); }}
              autoFocus
            />
            <div className="ar-modal-actions">
              <button className="ar-modal-confirm" onClick={handleFork} disabled={forkLoading}>
                {forkLoading ? 'Forking…' : 'Fork Thread'}
              </button>
              <button className="ar-modal-cancel" onClick={() => { setForkModalOpen(false); setForkClaim(''); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation modal ── */}
      {deleteConfirm && (
        <div className="ar-modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="ar-modal ar-delete-modal" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <h3 className="ar-modal-title" style={{ color: '#ef5350' }}>Delete Node</h3>
            <p className="ar-modal-desc">
              This node has <strong style={{ color: '#fff' }}>{deleteConfirm.childCount}</strong> child node{deleteConfirm.childCount !== 1 ? 's' : ''}. Their parent link will be removed. Delete anyway?
            </p>
            <div className="ar-modal-actions">
              <button className="ar-delete-confirm-btn" onClick={handleConfirmDelete}>
                Delete
              </button>
              <button className="ar-modal-cancel" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Secondary nodes toggle ── */}
      {!loading && (
        <button
          className={`ar-secondary-toggle${secondaryOpen ? ' ar-secondary-toggle--open' : ''}`}
          onClick={() => setSecondaryOpen(o => !o)}
          title={secondaryOpen ? `Hide ${secondaryPanelLabel}` : `Show ${secondaryPanelLabel}`}
        >
          {secondaryOpen ? '✕' : '⊞'}
        </button>
      )}

      {/* ── Socratic toggle ── */}
      {!loading && (
        <button
          className={`ar-socratic-toggle${socraticOpen ? ' ar-socratic-toggle--open' : ''}`}
          onClick={() => { setSocraticOpen(o => !o); setChatOpen(false); }}
          title={socraticOpen ? 'Close Socratic dialogue' : 'Open Socratic dialogue'}
        >
          {socraticOpen ? '✕' : '∿'}
        </button>
      )}

      {/* ── Chat toggle ── */}
      <button
        className={`ar-chat-toggle${chatOpen ? ' ar-chat-toggle--open' : ''}`}
        onClick={() => { setChatOpen(o => !o); setSocraticOpen(false); }}
        title={chatOpen ? 'Close chat' : 'Open chat'}
      >
        {chatOpen ? '✕' : '✦'}
      </button>
    </div>
  );
};

export default ArticleReader;
