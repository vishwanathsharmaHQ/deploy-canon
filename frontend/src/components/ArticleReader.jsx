import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Youtube from '@tiptap/extension-youtube';
import Placeholder from '@tiptap/extension-placeholder';
import ReactMarkdown from 'react-markdown';
import InputModal from './InputModal';
import ChatPanel from './ChatPanel';
import { api } from '../services/api';
import './ArticleReader.css';

const NODE_TYPES = ['ROOT', 'EVIDENCE', 'REFERENCE', 'CONTEXT', 'EXAMPLE', 'COUNTERPOINT', 'SYNTHESIS'];

const NODE_TYPE_COLORS = {
  ROOT: '#888',
  EVIDENCE: '#4fc3f7',
  REFERENCE: '#ab47bc',
  CONTEXT: '#ff8a65',
  EXAMPLE: '#66bb6a',
  COUNTERPOINT: '#ef5350',
  SYNTHESIS: '#fdd835',
};

// ── Toolbar (reuse pattern from NodeEditor) ───────────────────────────────────
const Toolbar = ({ editor }) => {
  const [modal, setModal] = useState(null); // null | 'link' | 'youtube'

  if (!editor) return null;

  const Btn = ({ onClick, active, children }) => (
    <button type="button" onClick={onClick} className={active ? 'is-active' : ''}>
      {children}
    </button>
  );

  const Divider = () => <span className="ar-toolbar-divider" />;

  return (
    <>
      <div className="ar-toolbar">
        <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')}>B</Btn>
        <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')}>I</Btn>
        <Btn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')}>S</Btn>
        <Divider />
        <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })}>H1</Btn>
        <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })}>H2</Btn>
        <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })}>H3</Btn>
        <Divider />
        <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')}>Bullet</Btn>
        <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')}>Ordered</Btn>
        <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')}>Quote</Btn>
        <Btn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')}>Code</Btn>
        <Divider />
        <Btn onClick={() => setModal('link')} active={editor.isActive('link')}>Link</Btn>
        <Btn onClick={() => setModal('youtube')}>YouTube</Btn>
      </div>
      {modal === 'link' && (
        <InputModal
          label="Enter URL"
          placeholder="https://example.com"
          onSubmit={(url) => {
            editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
            setModal(null);
          }}
          onCancel={() => setModal(null)}
        />
      )}
      {modal === 'youtube' && (
        <InputModal
          label="Enter YouTube URL"
          placeholder="https://youtube.com/watch?v=..."
          onSubmit={(url) => {
            editor.commands.setYoutubeVideo({ src: url });
            setModal(null);
          }}
          onCancel={() => setModal(null)}
        />
      )}
    </>
  );
};

// ── Node edit helpers ─────────────────────────────────────────────────────────

function getEditableContent(node) {
  const nodeType = getNodeType(node);
  let raw = node.content;
  if (raw && typeof raw === 'object' && raw.content !== undefined) raw = raw.content;
  let parsed = raw;
  if (typeof raw === 'string' && (raw.startsWith('{') || raw.startsWith('['))) {
    try { parsed = JSON.parse(raw); } catch (e) { /* keep as string */ }
  }
  switch (nodeType) {
    case 'ROOT':
      return {
        title: (typeof parsed === 'object' ? parsed?.title : null) || node.title || '',
        html: (typeof parsed === 'object' ? parsed?.description : null) || '',
        keywords: typeof parsed === 'object' && parsed?.keywords
          ? (Array.isArray(parsed.keywords) ? parsed.keywords.join(', ') : parsed.keywords)
          : '',
      };
    case 'EVIDENCE':
      return {
        title: (typeof parsed === 'object' ? parsed?.source : null) || node.title || '',
        html: (typeof parsed === 'object' ? parsed?.point : null) || '',
      };
    case 'EXAMPLE':
      return {
        title: (typeof parsed === 'object' ? parsed?.title : null) || node.title || '',
        html: (typeof parsed === 'object' ? parsed?.description : null) || '',
      };
    case 'COUNTERPOINT':
      return {
        title: (typeof parsed === 'object' ? parsed?.argument : null) || node.title || '',
        html: (typeof parsed === 'object' ? parsed?.explanation : null) || '',
      };
    default:
      return {
        title: node.title || '',
        html: typeof raw === 'string' ? raw : '',
      };
  }
}

function buildSavedContent(nodeType, title, html, keywords) {
  switch (nodeType) {
    case 'ROOT':
      return JSON.stringify({
        title,
        description: html,
        keywords: keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : [],
      });
    case 'EVIDENCE':
      return JSON.stringify({ point: html, source: title });
    case 'EXAMPLE':
      return JSON.stringify({ title, description: html });
    case 'COUNTERPOINT':
      return JSON.stringify({ argument: title, explanation: html });
    default:
      return html;
  }
}

// ── Content renderer (for read-only node pages) ──────────────────────────────
const renderContent = (rawContent) => {
  if (!rawContent) return <p className="ar-empty">No content available.</p>;

  let text = rawContent;
  if (typeof text === 'object') {
    text = text.content || text.text || JSON.stringify(text, null, 2);
  }
  if (typeof text !== 'string') return <p className="ar-empty">No content available.</p>;

  // Raw HTML — render directly
  if (text.trim().startsWith('<')) {
    return <div className="ar-html" dangerouslySetInnerHTML={{ __html: text }} />;
  }

  const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/;
  const urlRegex = /https?:\/\/[^\s<>"]+/g;

  const paragraphs = text
    .split(/\n{2,}/)
    .flatMap(p => (p.includes('\n') ? p.split('\n') : [p]))
    .filter(p => p.trim() !== '');

  return paragraphs.map((para, pi) => {
    const ytMatch = para.trim().match(ytRegex);
    if (ytMatch) {
      return (
        <div key={pi} className="ar-youtube">
          <iframe
            src={`https://www.youtube.com/embed/${ytMatch[1]}`}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={`video-${pi}`}
          />
        </div>
      );
    }

    const segments = [];
    let lastIdx = 0;
    let m;
    urlRegex.lastIndex = 0;
    while ((m = urlRegex.exec(para)) !== null) {
      if (m.index > lastIdx) segments.push(para.slice(lastIdx, m.index));
      segments.push(
        <a key={m.index} href={m[0]} target="_blank" rel="noopener noreferrer">{m[0]}</a>
      );
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < para.length) segments.push(para.slice(lastIdx));

    return <p key={pi}>{segments.length ? segments : para}</p>;
  });
};

const getNodeType = (node) => {
  if (node.node_type) return node.node_type;
  if (typeof node.type === 'number') return NODE_TYPES[node.type] || 'ROOT';
  return node.type || 'ROOT';
};

// Render a string that may contain HTML or markdown.
// TipTap / saved HTML always starts with a tag; AI content is markdown.
const renderHtmlOrText = (str) => {
  if (!str) return null;
  const s = String(str);
  if (s.trim().startsWith('<')) {
    return <div className="ar-html" dangerouslySetInnerHTML={{ __html: s }} />;
  }
  return <div className="ar-markdown"><ReactMarkdown>{s}</ReactMarkdown></div>;
};

// Returns a React element (not a string) for structured node content
const formatNodeContent = (node) => {
  let content = node.content;
  if (!content) return null;

  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed === 'object') content = parsed;
    } catch (e) { /* not JSON */ }
  }

  if (typeof content === 'object') {
    // ROOT: { title, description, keywords }
    if (content.title && content.description && 'keywords' in content) {
      return (
        <div>
          <h3 style={{ color: '#fff', margin: '0 0 12px' }}>{content.title}</h3>
          {renderHtmlOrText(content.description)}
          {content.keywords?.length > 0 && (
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', marginTop: 16 }}>
              <em>Keywords: {Array.isArray(content.keywords) ? content.keywords.join(', ') : content.keywords}</em>
            </p>
          )}
        </div>
      );
    }
    // EVIDENCE: { point, source }
    if (content.point) {
      const src = content.source;
      const ytMatch = src?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
      const isUrl = src && /^https?:\/\//.test(src);
      return (
        <div>
          {renderHtmlOrText(content.point)}
          {src && (
            ytMatch ? (
              <div className="ar-youtube" style={{ marginTop: 20 }}>
                <iframe
                  src={`https://www.youtube.com/embed/${ytMatch[1]}`}
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title={`yt-${ytMatch[1]}`}
                />
              </div>
            ) : (
              <p style={{ color: 'rgba(255,255,255,0.45)', fontStyle: 'italic', marginTop: 16, fontSize: '0.9rem' }}>
                Source:{' '}
                {isUrl ? (
                  <a href={src} target="_blank" rel="noopener noreferrer"
                     style={{ color: '#00ff9d', textDecoration: 'underline', textUnderlineOffset: '3px', wordBreak: 'break-all' }}>
                    {src}
                  </a>
                ) : src}
              </p>
            )
          )}
        </div>
      );
    }
    // EXAMPLE: { title, description }
    if (content.title && content.description) {
      return (
        <div>
          <h3 style={{ color: '#fff', margin: '0 0 12px' }}>{content.title}</h3>
          {renderHtmlOrText(content.description)}
        </div>
      );
    }
    // COUNTERPOINT: { argument, explanation }
    if (content.argument) {
      return (
        <div>
          <h3 style={{ color: '#fff', margin: '0 0 12px' }}>{content.argument}</h3>
          {content.explanation && renderHtmlOrText(content.explanation)}
        </div>
      );
    }
    if (content.content) return content.content;
    if (content.text) return content.text;
    return JSON.stringify(content, null, 2);
  }

  return content;
};

// ── Secondary node panel (split-screen right sidebar for ROOT pages) ─────────
const SecondaryNodePanel = ({ nodes, selectedId, onSelect }) => {
  if (!nodes || nodes.length === 0) return null;

  const selectedNode = nodes.find(n => n.id === selectedId) || nodes[0];
  const selectedType = getNodeType(selectedNode);
  const selectedColor = NODE_TYPE_COLORS[selectedType] || '#888';

  return (
    <div className="ar-snp">
      <div className="ar-snp-header">
        <span className="ar-snp-label">Supporting Nodes</span>
        {/* <span className="ar-snp-count">{nodes.length}</span> */}
      </div>

      <div className="ar-snp-tabs">
        {nodes.map(node => {
          const nodeType = getNodeType(node);
          const color = NODE_TYPE_COLORS[nodeType] || '#888';
          const isActive = node.id === selectedId;
          return (
            <button
              key={node.id}
              className={`ar-snp-tab${isActive ? ' ar-snp-tab--active' : ''}`}
              onClick={() => onSelect(node.id)}
              style={isActive ? { borderColor: color } : {}}
            >
              <span
                className="ar-snp-tab-badge ar-node-badge"
                style={{ color, borderColor: color }}
              >
                {nodeType}
              </span>
              <span className="ar-snp-tab-title">{node.title || `Node ${node.id}`}</span>
            </button>
          );
        })}
      </div>

      {selectedNode && (
        <div className="ar-snp-content">
          <div
            className="ar-node-badge"
            style={{ color: selectedColor, borderColor: selectedColor }}
          >
            {selectedType}
          </div>
          <h2 className="ar-snp-article-title">
            {selectedNode.title || `Node ${selectedNode.id}`}
          </h2>
          <hr className="ar-divider" />
          <div className="ar-content">
            {(() => {
              const rendered = formatNodeContent(selectedNode);
              return React.isValidElement(rendered) ? rendered : renderContent(rendered);
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Thread content editor (page 0) ───────────────────────────────────────────
const ThreadContentEditor = ({ thread, onContentChange, currentUser, onAuthRequired }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false }),
      Youtube.configure({ width: 640, height: 360 }),
      Placeholder.configure({ placeholder: 'Write your thread notes here...' }),
    ],
    content: thread.content || '',
    editable: false,
  });

  // Keep editor content in sync when thread changes (e.g. different thread selected)
  useEffect(() => {
    if (editor) {
      editor.commands.setContent(thread.content || '');
      editor.setEditable(false);
      setIsEditing(false);
    }
  }, [thread.id]);

  const handleEditStart = () => {
    if (!currentUser) { onAuthRequired?.(); return; }
    editor?.setEditable(true);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!editor) return;
    setSaving(true);
    const html = editor.getHTML();
    try {
      await api.updateThreadContent(thread.id, html);
      if (onContentChange) onContentChange(html);
      editor.setEditable(false);
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to save content:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    editor?.commands.setContent(thread.content || '');
    editor?.setEditable(false);
    setIsEditing(false);
  };

  const title = thread.metadata?.title || thread.title || `Thread ${thread.id}`;
  const description = thread.metadata?.description || thread.description || '';
  const hasContent = thread.content && thread.content !== '<p></p>';

  const renderThreadContent = (raw) => {
    if (!raw) return null;
    if (raw.trim().startsWith('<')) {
      return <div className="ar-html" dangerouslySetInnerHTML={{ __html: raw }} />;
    }
    return <div className="ar-markdown"><ReactMarkdown>{raw}</ReactMarkdown></div>;
  };

  return (
    <article className="ar-article">
      <div className="ar-node-header">
        <div className="ar-node-badge" style={{ color: '#777', borderColor: '#444' }}>THREAD</div>
        {!isEditing && (
          <button className="ar-edit-btn" onClick={handleEditStart}>Edit</button>
        )}
        {isEditing && (
          <div className="ar-edit-actions">
            <button className="ar-save-btn" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="ar-cancel-btn" onClick={handleCancel} disabled={saving}>
              Cancel
            </button>
          </div>
        )}
      </div>

      <h1 className="ar-title">{title}</h1>
      <hr className="ar-divider" />

      {isEditing ? (
        <div className="ar-editor-section">
          <Toolbar editor={editor} />
          <div className="ar-editor-wrapper">
            <EditorContent editor={editor} />
          </div>
        </div>
      ) : (
        <div className="ar-content">
          {hasContent ? (
            renderThreadContent(thread.content)
          ) : description ? (
            renderThreadContent(description)
          ) : (
            <p className="ar-empty">No notes yet. Click Edit to add content.</p>
          )}
        </div>
      )}
    </article>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────
const ArticleReader = ({ thread, initialNodeId, onContentChange, onUpdateNode, onNodesCreated, onThreadCreated, currentUser, onAuthRequired }) => {
  const [currentPage, setCurrentPage] = useState(0);
  const [orderedNodes, setOrderedNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const [selectedSecondaryId, setSelectedSecondaryId] = useState(null);
  const [pendingUpdate, setPendingUpdate] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editKeywords, setEditKeywords] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Children of the current ROOT node (empty on non-ROOT pages)
  const currentRootChildren = useMemo(() => {
    if (currentPage === 0 || loading || !orderedNodes.length) return [];
    const node = orderedNodes[currentPage - 1];
    if (!node || getNodeType(node) !== 'ROOT') return [];
    return orderedNodes.filter(n => n.parent_id === node.id);
  }, [currentPage, orderedNodes, loading]);

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

  // Auto-open secondary panel when on a ROOT page with children
  useEffect(() => {
    if (currentRootChildren.length > 0) {
      setSecondaryOpen(true);
      setSelectedSecondaryId(id =>
        id && currentRootChildren.some(n => n.id === id) ? id : currentRootChildren[0].id
      );
    } else {
      setSecondaryOpen(false);
      setSelectedSecondaryId(null);
    }
  }, [currentPage]); // intentionally only re-runs on page change

  useEffect(() => {
    if (!thread?.id) return;
    loadOrder();
  }, [thread?.id]);

  // When initialNodeId changes (e.g. user selected a node then clicked Article tab), navigate to it
  useEffect(() => {
    if (!initialNodeId || orderedNodes.length === 0) return;
    const idx = orderedNodes.findIndex(n => n.id === initialNodeId);
    if (idx >= 0) {
      setCurrentPage(idx + 1); // +1 because page 0 is thread overview
    }
  }, [initialNodeId, orderedNodes]);

  const loadOrder = async () => {
    setLoading(true);
    try {
      const nodes = thread.nodes || [];
      const saved = await api.loadArticleSequence(thread.id);

      let ordered;
      if (saved && Array.isArray(saved)) {
        const savedSet = new Set(saved);
        const savedOrdered = saved.map(id => nodes.find(n => n.id === id)).filter(Boolean);
        const remaining = nodes.filter(n => !savedSet.has(n.id));
        ordered = [...savedOrdered, ...remaining];
      } else {
        ordered = [...nodes];
      }
      setOrderedNodes(ordered);

      // Set initial page based on initialNodeId or default to 0
      if (initialNodeId) {
        const idx = ordered.findIndex(n => n.id === initialNodeId);
        setCurrentPage(idx >= 0 ? idx + 1 : 0);
      } else {
        setCurrentPage(0);
      }
    } catch (err) {
      console.error('Failed to load article sequence:', err);
      const fallback = [...(thread.nodes || [])];
      setOrderedNodes(fallback);
      if (initialNodeId) {
        const idx = fallback.findIndex(n => n.id === initialNodeId);
        setCurrentPage(idx >= 0 ? idx + 1 : 0);
      } else {
        setCurrentPage(0);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!thread) return null;

  const totalPages = 1 + orderedNodes.length;

  // Context passed to chat so it knows what article the user is viewing
  const currentArticleContext = (() => {
    if (loading) return null;
    if (currentPage === 0) return null; // thread overview, no specific node
    const node = orderedNodes[currentPage - 1];
    if (!node) return null;
    return {
      nodeId: node.id,
      nodeType: getNodeType(node),
      title: node.title || `Node ${node.id}`,
      content: node.content || '',
    };
  })();

  const handleProposedUpdate = async (update) => {
    if (!update || !update.nodeId || !onUpdateNode) return;
    const node = orderedNodes.find(n => n.id === update.nodeId);
    if (!node) return;
    const nodeType = getNodeType(node);

    // Preserve existing fields (e.g. keywords for ROOT), only replace title + body
    let existingParsed = {};
    if (typeof node.content === 'string') {
      try { existingParsed = JSON.parse(node.content); } catch (e) { /* ignore */ }
    }

    let newContent;
    if (nodeType === 'ROOT') {
      newContent = JSON.stringify({
        title: update.title,
        description: update.description,
        keywords: existingParsed.keywords || [],
      });
    } else if (nodeType === 'EXAMPLE') {
      newContent = JSON.stringify({ title: update.title, description: update.description });
    } else if (nodeType === 'COUNTERPOINT') {
      newContent = JSON.stringify({ argument: update.title, explanation: update.description });
    } else if (nodeType === 'EVIDENCE') {
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

  const renderPage = () => {
    if (currentPage === 0) {
      return <ThreadContentEditor thread={thread} onContentChange={onContentChange} currentUser={currentUser} onAuthRequired={onAuthRequired} />;
    }

    const node = orderedNodes[currentPage - 1];
    if (!node) return <p className="ar-empty">Node not found.</p>;

    const nodeType = getNodeType(node);
    const color = NODE_TYPE_COLORS[nodeType] || '#888';
    const nodeTitle = node.title || `Node ${node.id}`;
    const nodeRendered = formatNodeContent(node);
    const isReactElement = React.isValidElement(nodeRendered);

    const handleEditStart = () => {
      if (!currentUser) { onAuthRequired?.(); return; }
      const { title, html, keywords } = getEditableContent(node);
      setEditTitle(title);
      setEditKeywords(keywords || '');
      nodeEditEditor?.commands.setContent(html || '');
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
          <div className="ar-node-badge" style={{ color, borderColor: color }}>{nodeType}</div>
          {!isEditing && onUpdateNode && (
            <button className="ar-edit-btn" onClick={handleEditStart}>Edit</button>
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

        {isEditing ? (
          <>
            <input
              className="ar-edit-title"
              type="text"
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              placeholder="Title"
            />
            {nodeType === 'ROOT' && (
              <input
                className="ar-edit-keywords"
                type="text"
                value={editKeywords}
                onChange={e => setEditKeywords(e.target.value)}
                placeholder="Keywords (comma-separated)"
              />
            )}
            <hr className="ar-divider" />
            <div className="ar-editor-section">
              <Toolbar editor={nodeEditEditor} />
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
              {isReactElement ? nodeRendered : renderContent(nodeRendered)}
            </div>
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
          <main className="ar-body">
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
        <div className={`ar-secondary-sidebar${secondaryOpen && currentRootChildren.length > 0 ? ' ar-secondary-sidebar--open' : ''}${secondaryOpen && currentRootChildren.length > 0 && chatOpen ? ' ar-secondary-sidebar--compact' : ''}`}>
          <SecondaryNodePanel
            nodes={currentRootChildren}
            selectedId={selectedSecondaryId}
            onSelect={setSelectedSecondaryId}
          />
        </div>

        {/* ── Collapsible chat sidebar ── */}
        <div className={`ar-chat-sidebar${chatOpen ? ' ar-chat-sidebar--open' : ''}`}>
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
        </div>
      </div>

      {/* ── Secondary nodes toggle button (shown only on ROOT pages with children) ── */}
      {currentRootChildren.length > 0 && !loading && (
        <button
          className={`ar-secondary-toggle${secondaryOpen ? ' ar-secondary-toggle--open' : ''}`}
          onClick={() => setSecondaryOpen(o => !o)}
          title={secondaryOpen ? 'Hide supporting nodes' : 'Show supporting nodes'}
        >
          {secondaryOpen ? '✕' : '⊞'}
        </button>
      )}

      {/* ── Chat toggle button ── */}
      <button
        className={`ar-chat-toggle${chatOpen ? ' ar-chat-toggle--open' : ''}`}
        onClick={() => setChatOpen(o => !o)}
        title={chatOpen ? 'Close chat' : 'Open chat'}
      >
        {chatOpen ? '✕' : '✦'}
      </button>
    </div>
  );
};

export default ArticleReader;
