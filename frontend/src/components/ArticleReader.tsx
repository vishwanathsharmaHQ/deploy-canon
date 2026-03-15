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
import ReactMarkdown from 'react-markdown';
import { api } from '../services/api';
import { NODE_TYPE_COLORS, ENTITY_TYPE_LABELS } from '../constants';
import {
  embedYouTubeLinks,
  getNodeType,
  getEditableContent,
  buildSavedContent,
  renderContent,
  formatNodeContent,
} from '../utils/articleContent';
import { createMdComponents } from '../utils/markdown';
import type { Thread, ThreadNode, NodeTypeName, User, Annotation } from '../types';
import './ArticleReader.css';

const footnoteMdComponents = createMdComponents('ar-footnote-youtube');

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
  savedPage?: number;
  onPageChange?: (page: number) => void;
  onTitleChanged?: (threadId: number, title: string) => void;
  onThreadDeleted?: (threadId: number) => void;
}

const ArticleReader: React.FC<ArticleReaderProps> = ({ thread, initialNodeId, onContentChange, onUpdateNode, onNodesCreated, onThreadCreated, onViewInGraph, currentUser, onAuthRequired, savedPage, onPageChange, onTitleChanged, onThreadDeleted }) => {
  const [currentPage, setCurrentPageRaw] = useState(savedPage ?? 0);
  const [focusedSecondaryNode, setFocusedSecondaryNode] = useState<ThreadNode | null>(null);
  const setCurrentPage = useCallback((v: number | ((prev: number) => number)) => {
    let nextPage: number;
    setCurrentPageRaw(prev => {
      nextPage = typeof v === 'function' ? v(prev) : v;
      return nextPage;
    });
    // Update parent outside the state updater to avoid setState-during-render
    queueMicrotask(() => onPageChange?.(nextPage!));
    setFocusedSecondaryNode(null);
  }, [onPageChange]);
  const [orderedNodes, setOrderedNodes] = useState<ThreadNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const [selectedSecondaryId, setSelectedSecondaryId] = useState<number | string | null>(null);
  const [socraticOpen, setSocraticOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
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
  // Highlights
  const [highlights, setHighlights] = useState<Record<number, string[]>>({});
  const highlightSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Annotations (footnotes)
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const annotationSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeFootnote, setActiveFootnote] = useState<Annotation | null>(null);

  // Root nodes: top-level nodes that are not children of any other node
  const rootNodes = useMemo(() => {
    if (!orderedNodes.length) return [];
    // Collect ALL child IDs — via parent_id and via relationships (source is child of target)
    const childIds = new Set<number>();
    for (const n of orderedNodes) {
      if (n.parent_id) childIds.add(n.id);
    }
    for (const r of (thread.relationships || [])) {
      childIds.add(r.source_id);
    }
    return orderedNodes.filter(n => !childIds.has(n.id));
  }, [orderedNodes, thread.relationships]);

  // Supporting nodes for the current root node (via parent_id or relationships)
  const currentRootChildren = useMemo(() => {
    if (currentPage === 0 || loading || !rootNodes.length) return [];
    const node = rootNodes[currentPage - 1];
    if (!node) return [];
    const seen = new Set<number>();
    const children: ThreadNode[] = [];
    const addChild = (n: ThreadNode) => { if (!seen.has(n.id)) { seen.add(n.id); children.push(n); } };
    // Children via parent_id
    orderedNodes.filter(n => n.parent_id === node.id).forEach(addChild);
    // Children via typed relationships (source → target, source is child)
    const relChildIds = new Set(
      (thread.relationships || [])
        .filter(r => r.target_id === node.id)
        .map(r => r.source_id)
    );
    orderedNodes.filter(n => relChildIds.has(n.id)).forEach(addChild);
    return children;
  }, [currentPage, orderedNodes, loading, rootNodes, thread.relationships]);

  // Stack for navigating into supporting nodes' children
  const [secondaryNavStack, setSecondaryNavStack] = useState<{ nodeId: number; nodeTitle: string }[]>([]);

  // Get children of a specific node
  const getNodeChildren = useCallback((nodeId: number): ThreadNode[] => {
    const seen = new Set<number>();
    const children: ThreadNode[] = [];
    const addChild = (n: ThreadNode) => { if (!seen.has(n.id)) { seen.add(n.id); children.push(n); } };
    orderedNodes.filter(n => n.parent_id === nodeId).forEach(addChild);
    const relChildIds = new Set(
      (thread.relationships || [])
        .filter(r => r.target_id === nodeId)
        .map(r => r.source_id)
    );
    orderedNodes.filter(n => relChildIds.has(n.id)).forEach(addChild);
    return children;
  }, [orderedNodes, thread.relationships]);

  // If navigated into a supporting node, show its children
  const drilledChildren = useMemo(() => {
    if (secondaryNavStack.length === 0) return null;
    const lastNode = secondaryNavStack[secondaryNavStack.length - 1];
    return getNodeChildren(lastNode.nodeId);
  }, [secondaryNavStack, getNodeChildren]);

  // Pinned nodes (Red Team / Steelman results) take precedence, then drilled children, then current root children
  const effectiveSecondaryNodes = secondaryPinnedNodes ?? drilledChildren ?? currentRootChildren;

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

  // Click delegation for node links and external links in the article body
  const bodyRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const handler = (e: MouseEvent) => {
      const nodeLink = (e.target as HTMLElement).closest('.ar-node-link') as HTMLElement | null;
      if (nodeLink) {
        e.preventDefault();
        const nodeId = nodeLink.dataset.nodeId;
        if (!nodeId) return;
        const numId = parseInt(nodeId);
        const idx = rootNodes.findIndex(n => n.id === numId || String(n.id) === nodeId);
        if (idx >= 0) setCurrentPage(idx + 1);
        return;
      }
      // Make all links in ar-content clickable (opens in new tab)
      const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
      if (anchor && anchor.href && !anchor.href.startsWith('#') && !anchor.classList.contains('ar-node-link')) {
        e.preventDefault();
        window.open(anchor.href, '_blank', 'noopener,noreferrer');
      }
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
  // On mobile, never auto-open — the panel is a full-screen overlay and would hijack navigation.
  const isMobile = window.innerWidth <= 768;
  useEffect(() => {
    setSecondaryPinnedNodes(null);
    setSecondaryPanelLabel('Supporting Nodes');
    setSecondaryNavStack([]);
    if (currentRootChildren.length > 0) {
      if (!isMobile) setSecondaryOpen(true);
      setSelectedSecondaryId((id: number | string | null) =>
        id && currentRootChildren.some(n => n.id === id) ? id : currentRootChildren[0].id
      );
    } else {
      setSelectedSecondaryId(null);
      if (isMobile) setSecondaryOpen(false);
      // On desktop: don't auto-close — prevents layout jump when paginating
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
        // Already have nodes — preserve previous order, update data, append new ones
        if (prev.length > 0) {
          const prevIds = new Set(prev.map(n => n.id));
          const updatedMap = new Map(ordered.map(n => [n.id, n]));
          // Update existing nodes with fresh data, keep order
          const preserved = prev
            .map(n => updatedMap.get(n.id) || n)
            .filter(n => ordered.some(o => o.id === n.id)); // remove deleted nodes
          const newNodes = ordered.filter(n => !prevIds.has(n.id));
          const merged = [...preserved, ...newNodes];

          // Check if enrich just completed — auto-open sidebar for the enriched node
          const enrichedId = enrichedNodeRef.current;
          if (enrichedId) {
            enrichedNodeRef.current = null;
            const newChildIds = new Set(merged.filter(n => n.parent_id === enrichedId).map(n => n.id));
            const newRelChildIds = new Set(
              (thread.relationships || [])
                .filter(r => r.target_id === enrichedId)
                .map(r => r.source_id)
            );
            const allChildIds = new Set([...newChildIds, ...newRelChildIds]);
            if (allChildIds.size > 0) {
              const children = merged.filter(n => allChildIds.has(n.id));
              if (children.length > 0) {
                setSecondaryOpen(true);
                setSecondaryPinnedNodes(null);
                setSecondaryPanelLabel('Supporting Nodes');
                setSelectedSecondaryId(children[0].id);
              }
            }
          }
          return merged;
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

  // ── Highlights: load, save, apply ──────────────────────────────────────────

  // Load highlights when thread changes
  useEffect(() => {
    if (!thread?.id) return;
    api.loadHighlights(thread.id).then(h => {
      // Normalize string keys from JSON to numbers
      const normalized: Record<number, string[]> = {};
      for (const [k, v] of Object.entries(h || {})) normalized[Number(k)] = v as string[];
      setHighlights(normalized);
    });
  }, [thread?.id]);

  // Persist highlights (debounced)
  const persistHighlights = useCallback((updated: Record<number, string[]>) => {
    if (highlightSaveTimer.current) clearTimeout(highlightSaveTimer.current);
    highlightSaveTimer.current = setTimeout(() => {
      api.saveHighlights(thread.id, updated).catch(e => console.error('Failed to save highlights:', e));
    }, 800);
  }, [thread.id]);

  // Listen for highlight events from DictionaryPopup
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent).detail?.text;
      if (!text || currentPage === 0) return;
      // Find which node actually contains the highlighted text
      const rootNode = rootNodes[currentPage - 1];
      if (!rootNode) return;
      const candidates = [rootNode, ...orderedNodes.filter(n => n.id !== rootNode.id)];
      const matchNode = candidates.find(n => {
        const c = typeof n.content === 'string' ? n.content : JSON.stringify(n.content || '');
        return c.toLowerCase().includes(text.toLowerCase());
      });
      const nodeId = matchNode?.id ?? rootNode.id;
      setHighlights(prev => {
        const nodeHighlights = prev[nodeId] || [];
        if (nodeHighlights.includes(text)) return prev;
        const updated = { ...prev, [nodeId]: [...nodeHighlights, text] };
        persistHighlights(updated);
        return updated;
      });
    };
    window.addEventListener('article-highlight', handler);
    return () => window.removeEventListener('article-highlight', handler);
  }, [currentPage, rootNodes, orderedNodes, persistHighlights]);

  // ── Annotations (footnotes): load, save, apply ──────────────────────────────

  // Load annotations when thread changes
  useEffect(() => {
    if (!thread?.id) return;
    api.loadAnnotations(thread.id).then(a => setAnnotations(a || []));
  }, [thread?.id]);

  // Persist annotations (debounced)
  const persistAnnotations = useCallback((updated: Annotation[]) => {
    if (annotationSaveTimer.current) clearTimeout(annotationSaveTimer.current);
    annotationSaveTimer.current = setTimeout(() => {
      api.saveAnnotations(thread.id, updated).catch(e => console.error('Failed to save annotations:', e));
    }, 800);
  }, [thread.id]);

  // Listen for annotation events from DictionaryPopup
  useEffect(() => {
    const handler = (e: Event) => {
      const { text, action, response, question } = (e as CustomEvent).detail || {};
      if (!text || !response) return;
      setAnnotations(prev => {
        const newAnnotation: Annotation = {
          id: Date.now(),
          text,
          action,
          question,
          response,
          nodeId: currentPage > 0 && rootNodes[currentPage - 1] ? rootNodes[currentPage - 1].id : 0,
          createdAt: new Date().toISOString(),
        };
        const updated = [...prev, newAnnotation];
        persistAnnotations(updated);
        return updated;
      });
    };
    window.addEventListener('article-annotation', handler);
    return () => window.removeEventListener('article-annotation', handler);
  }, [currentPage, rootNodes, persistAnnotations]);

  // Click delegation for footnotes + highlight removal (single handler to avoid conflicts)
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const handler = (e: MouseEvent) => {
      // ── Footnote click ──
      const sup = (e.target as HTMLElement).closest('.ar-footnote') as HTMLElement | null;
      if (sup) {
        e.preventDefault();
        e.stopPropagation();
        const annotationId = Number(sup.dataset.annotationId);
        const annotation = annotations.find(a => a.id === annotationId);
        if (annotation) setActiveFootnote(prev => prev?.id === annotation.id ? null : annotation);
        return;
      }

      // ── Highlight removal — only on plain click (no text selection) ──
      const mark = (e.target as HTMLElement).closest('mark.ar-highlight') as HTMLElement | null;
      if (!mark) return;
      const selection = window.getSelection();
      const selText = selection?.toString().trim() || '';
      if (selText) return; // user is selecting text inside the highlight, don't remove
      e.preventDefault();
      e.stopPropagation();
      const text = mark.dataset.highlightText;
      const markNodeId = Number(mark.dataset.highlightNodeId);
      if (!text || !markNodeId) return;
      setHighlights(prev => {
        const nodeHighlights = (prev[markNodeId] || []).filter(h => h !== text);
        const updated = { ...prev };
        if (nodeHighlights.length === 0) {
          delete updated[markNodeId];
        } else {
          updated[markNodeId] = nodeHighlights;
        }
        persistHighlights(updated);
        return updated;
      });
    };
    body.addEventListener('click', handler);
    return () => body.removeEventListener('click', handler);
  }, [annotations, currentPage, rootNodes, persistHighlights]);

  // Build an HTML transform that wraps highlighted text in <mark> tags.
  // Works across tag boundaries (e.g. text spanning <a>, <strong>, <p> tags).
  const applyHighlightsToHtml = useCallback((html: string, nodeId: number): string => {
    const nodeHighlights = highlights[nodeId];
    if (!nodeHighlights || nodeHighlights.length === 0) return html;

    // Split HTML into parts: text segments and tag segments
    const parts = html.split(/(<[^>]*>)/);
    // Build plain text and a map from plain-text offset → parts index + local offset
    let plainText = '';
    const partMeta: { isTag: boolean; start: number; end: number }[] = [];
    for (const part of parts) {
      const isTag = part.startsWith('<');
      const start = plainText.length;
      if (!isTag) plainText += part;
      partMeta.push({ isTag, start, end: plainText.length });
    }

    // Find all highlight ranges in the plain text (non-overlapping, longest first)
    const sorted = [...nodeHighlights].sort((a, b) => b.length - a.length);
    const ranges: { start: number; end: number; text: string }[] = [];
    const taken = new Uint8Array(plainText.length);

    for (const hl of sorted) {
      const lower = plainText.toLowerCase();
      const hlLower = hl.toLowerCase();
      let searchFrom = 0;
      while (searchFrom < lower.length) {
        const idx = lower.indexOf(hlLower, searchFrom);
        if (idx === -1) break;
        // Check no overlap with already-claimed ranges
        let overlap = false;
        for (let i = idx; i < idx + hl.length; i++) {
          if (taken[i]) { overlap = true; break; }
        }
        if (!overlap) {
          ranges.push({ start: idx, end: idx + hl.length, text: hl });
          for (let i = idx; i < idx + hl.length; i++) taken[i] = 1;
        }
        searchFrom = idx + 1;
      }
    }

    if (ranges.length === 0) return html;
    ranges.sort((a, b) => a.start - b.start);

    // Rebuild HTML, inserting <mark> and </mark> at the right plain-text offsets
    let result = '';
    let rangeIdx = 0;
    let inMark = false;

    for (let pi = 0; pi < parts.length; pi++) {
      const part = parts[pi];
      const meta = partMeta[pi];

      if (meta.isTag) {
        result += part;
        continue;
      }

      // Walk through this text segment character by character
      let localPos = 0;
      const text = part;

      while (localPos < text.length) {
        const plainPos = meta.start + localPos;

        // Close mark if we've reached the end of the current range
        if (inMark && rangeIdx < ranges.length && plainPos >= ranges[rangeIdx].end) {
          result += '</mark>';
          inMark = false;
          rangeIdx++;
        }

        // Open mark if we've reached the start of the next range
        if (!inMark && rangeIdx < ranges.length && plainPos >= ranges[rangeIdx].start && plainPos < ranges[rangeIdx].end) {
          const hl = ranges[rangeIdx].text;
          const safe = hl.replace(/"/g, '&quot;');
          result += `<mark class="ar-highlight" data-highlight-text="${safe}" data-highlight-node-id="${nodeId}">`;
          inMark = true;
        }

        // Find how many characters to emit before the next boundary
        let nextBoundary = text.length;
        if (inMark && rangeIdx < ranges.length) {
          nextBoundary = Math.min(nextBoundary, ranges[rangeIdx].end - meta.start);
        } else if (!inMark && rangeIdx < ranges.length) {
          nextBoundary = Math.min(nextBoundary, ranges[rangeIdx].start - meta.start);
        }
        nextBoundary = Math.max(nextBoundary, localPos + 1); // advance at least 1

        result += text.slice(localPos, nextBoundary);
        localPos = nextBoundary;
      }
    }

    if (inMark) result += '</mark>';

    return result;
  }, [highlights]);

  // Inject footnote superscripts after annotated text (tag-aware — never matches inside HTML attributes)
  const applyAnnotationsToHtml = useCallback((html: string, nodeId: number): string => {
    const nodeAnnotations = annotations.filter(a => a.nodeId === nodeId);
    if (nodeAnnotations.length === 0) return html;

    // Split HTML into text segments and tag segments (same approach as highlights)
    const parts = html.split(/(<[^>]*>)/);

    for (let i = 0; i < nodeAnnotations.length; i++) {
      const ann = nodeAnnotations[i];
      const footnoteNum = i + 1;
      const sup = `<sup class="ar-footnote" data-annotation-id="${ann.id}" title="${ann.action}: ${ann.text.substring(0, 50).replace(/"/g, '&quot;')}">${footnoteNum}</sup>`;
      const needle = ann.text.toLowerCase();

      // Build plain text from text-only parts to find the annotation position
      let plainText = '';
      const textPartIndices: number[] = [];
      for (let pi = 0; pi < parts.length; pi++) {
        if (!parts[pi].startsWith('<')) {
          textPartIndices.push(pi);
          plainText += parts[pi];
        }
      }

      const matchIdx = plainText.toLowerCase().indexOf(needle);
      if (matchIdx === -1) continue;

      // Find which text part contains the end of the match, and insert <sup> after it
      const matchEnd = matchIdx + ann.text.length;
      let offset = 0;
      for (const pi of textPartIndices) {
        const partEnd = offset + parts[pi].length;
        if (matchEnd <= partEnd) {
          // Insert the superscript at the match end position within this text part
          const localPos = matchEnd - offset;
          parts[pi] = parts[pi].slice(0, localPos) + sup + parts[pi].slice(localPos);
          break;
        }
        offset = partEnd;
      }
    }

    return parts.join('');
  }, [annotations]);

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
    if (currentPage === 0 && !focusedSecondaryNode) {
      return <ThreadContentEditor thread={thread} onContentChange={onContentChange} currentUser={currentUser} onAuthRequired={onAuthRequired} onTitleChanged={(title) => onTitleChanged?.(thread.id, title)} onDelete={() => onThreadDeleted?.(thread.id)} />;
    }

    const node = focusedSecondaryNode || rootNodes[currentPage - 1];
    if (!node) return <p className="ar-empty">Node not found.</p>;

    const nodeType = getNodeType(node);
    const color = NODE_TYPE_COLORS[nodeType as NodeTypeName] || '#888';
    const nodeTitle = node.title || `Node ${node.id}`;
    const nodeLinkify = (html: string) => applyAnnotationsToHtml(applyHighlightsToHtml(linkifyNodeMentions(html, node.id), node.id), node.id);
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
        {focusedSecondaryNode && (
          <button
            className="ar-back-btn"
            onClick={() => setFocusedSecondaryNode(null)}
          >
            ← Back to parent
          </button>
        )}
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
                <button
                  className="ar-action-btn ar-action-btn--enrich"
                  onClick={() => handleEnrich(node.id)}
                  disabled={enrichLoading}
                  title="Generate child nodes and enrich this node with more detail"
                >
                  {enrichLoading ? 'Enriching...' : '✦ Enrich'}
                </button>
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
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- TipTap Editor type mismatch */}
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
              {isReactElement ? nodeRendered : renderContent(nodeRendered, (html) => applyAnnotationsToHtml(applyHighlightsToHtml(linkifyNodeMentions(html, node.id), node.id), node.id))}
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
        {/* ── TOC sidebar ── */}
        <div className={`ar-toc-sidebar${tocOpen ? ' ar-toc-sidebar--open' : ''}`}>
          {tocOpen && (
            <nav className="ar-toc-nav">
              <div className="ar-toc-heading">Contents</div>
              <button
                className={`ar-toc-item${currentPage === 0 ? ' ar-toc-item--active' : ''}`}
                onClick={() => setCurrentPage(0)}
              >
                Overview
              </button>
              {rootNodes.map((node, idx) => (
                <button
                  key={node.id}
                  className={`ar-toc-item${currentPage === idx + 1 ? ' ar-toc-item--active' : ''}`}
                  onClick={() => setCurrentPage(idx + 1)}
                  title={node.title || `Node ${node.id}`}
                >
                  <span className="ar-toc-num">{idx + 1}</span>
                  <span className="ar-toc-title">{node.title || `Node ${node.id}`}</span>
                </button>
              ))}
            </nav>
          )}
          <button className="ar-toc-toggle" onClick={() => setTocOpen(o => !o)} title={tocOpen ? 'Hide contents' : 'Show contents'}>
            {tocOpen ? '‹' : '›'}
          </button>
        </div>

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
            onOpenNode={(node) => {
              // Always show the double-clicked node in the article panel
              setFocusedSecondaryNode(node);
              // If it has children, show them in the sidebar
              const children = getNodeChildren(node.id);
              if (children.length > 0) {
                setSecondaryNavStack(prev => [...prev, { nodeId: node.id, nodeTitle: node.title || `Node ${node.id}` }]);
                setSelectedSecondaryId(children[0].id);
              }
            }}
            label={secondaryNavStack.length > 0
              ? `← ${secondaryNavStack[secondaryNavStack.length - 1].nodeTitle}`
              : secondaryPanelLabel}
            onAccept={pendingProposals ? handleAcceptProposals : undefined}
            onDiscard={pendingProposals ? handleDiscardProposals : undefined}
            onClose={() => {
              if (secondaryNavStack.length > 0) {
                // Go back one level
                const prev = [...secondaryNavStack];
                prev.pop();
                setSecondaryNavStack(prev);
                if (prev.length === 0) {
                  // Back to root children
                  setSelectedSecondaryId(currentRootChildren[0]?.id ?? null);
                } else {
                  const parentId = prev[prev.length - 1].nodeId;
                  const parentChildren = getNodeChildren(parentId);
                  setSelectedSecondaryId(parentChildren[0]?.id ?? null);
                }
              } else {
                setSecondaryOpen(false);
              }
            }}
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
          {/* Mobile-only close bar for chat/socratic overlay */}
          {(chatOpen || socraticOpen) && (
            <div className="ar-mobile-close-bar">
              <button className="ar-mobile-close-btn" onClick={() => { setChatOpen(false); setSocraticOpen(false); }}>
                &larr; Back to Article
              </button>
            </div>
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

      {/* ── Footnote popup ── */}
      {activeFootnote && (
        <div className="ar-footnote-overlay" onClick={() => setActiveFootnote(null)}>
          <div className="ar-footnote-popup" onClick={(e) => e.stopPropagation()}>
            <button className="ar-footnote-close" onClick={() => setActiveFootnote(null)}>&times;</button>
            <div className="ar-footnote-action">{activeFootnote.action}{activeFootnote.question ? `: ${activeFootnote.question}` : ''}</div>
            <div className="ar-footnote-text">"{activeFootnote.text.length > 150 ? activeFootnote.text.substring(0, 150) + '...' : activeFootnote.text}"</div>
            <div className="ar-footnote-response">
              <ReactMarkdown components={footnoteMdComponents}>{activeFootnote.response}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArticleReader;
