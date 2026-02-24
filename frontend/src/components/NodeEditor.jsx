import React, { useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Youtube from '@tiptap/extension-youtube';
import Placeholder from '@tiptap/extension-placeholder';
import './NodeEditor.css';

const NODE_TYPES = [
  { value: 0, label: 'ROOT' },
  { value: 1, label: 'EVIDENCE' },
  { value: 2, label: 'REFERENCE' },
  { value: 3, label: 'CONTEXT' },
  { value: 4, label: 'EXAMPLE' },
  { value: 5, label: 'COUNTERPOINT' },
  { value: 6, label: 'SYNTHESIS' }
];

const TITLE_PLACEHOLDERS = {
  ROOT: 'Root Title',
  EVIDENCE: 'Source',
  EXAMPLE: 'Example Title',
  COUNTERPOINT: 'Argument',
  REFERENCE: 'Title',
  CONTEXT: 'Title',
  SYNTHESIS: 'Title'
};

const CONTENT_PLACEHOLDERS = {
  ROOT: 'Describe this root node...',
  EVIDENCE: 'Present your evidence...',
  EXAMPLE: 'Describe this example...',
  COUNTERPOINT: 'Explain the counterpoint...',
  REFERENCE: 'Write reference content...',
  CONTEXT: 'Provide context...',
  SYNTHESIS: 'Write your synthesis...'
};

// ── Toolbar ──────────────────────────────────────────────────────────────────
const Toolbar = ({ editor }) => {
  if (!editor) return null;

  const addLink = useCallback(() => {
    const url = window.prompt('URL:');
    if (url) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  }, [editor]);

  const addYoutube = useCallback(() => {
    const url = window.prompt('YouTube URL:');
    if (url) {
      editor.commands.setYoutubeVideo({ src: url });
    }
  }, [editor]);

  const Btn = ({ onClick, active, children }) => (
    <button
      type="button"
      onClick={onClick}
      className={active ? 'is-active' : ''}
    >
      {children}
    </button>
  );

  const Divider = () => <span className="ne-toolbar-divider" />;

  return (
    <div className="ne-toolbar">
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
      <Btn onClick={addLink} active={editor.isActive('link')}>Link</Btn>
      <Btn onClick={addYoutube}>YouTube</Btn>
    </div>
  );
};

// ── NodeEditor ───────────────────────────────────────────────────────────────
const NodeEditor = ({ thread, selectedNode, onSubmit, onCancel }) => {
  const isThread = selectedNode?.type === 'thread';

  const [nodeType, setNodeType] = useState(() => {
    // Default to EVIDENCE (1) unless parent is thread, then allow ROOT (0)
    return isThread ? '0' : '1';
  });
  const [title, setTitle] = useState('');
  const [keywords, setKeywords] = useState('');

  const currentLabel = NODE_TYPES[Number(nodeType)]?.label || 'EVIDENCE';

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Youtube.configure({ width: 640, height: 360 }),
      Placeholder.configure({
        placeholder: CONTENT_PLACEHOLDERS[currentLabel] || 'Write your content...',
      }),
    ],
    content: '',
  });

  const handleSubmit = () => {
    if (!editor || !title.trim()) return;

    const html = editor.getHTML();

    // Structure content the same way ThreadGraph.handleAddNode did
    let structuredContent;
    let shortDescription;

    switch (currentLabel) {
      case 'ROOT':
        structuredContent = JSON.stringify({
          title,
          description: html,
          keywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
        });
        shortDescription = title;
        break;
      case 'EVIDENCE':
        structuredContent = JSON.stringify({
          point: html,
          source: title,
        });
        shortDescription = editor.getText().substring(0, 100);
        break;
      case 'EXAMPLE':
        structuredContent = JSON.stringify({
          title,
          description: html,
        });
        shortDescription = editor.getText().substring(0, 100);
        break;
      case 'COUNTERPOINT':
        structuredContent = JSON.stringify({
          argument: title,
          explanation: html,
        });
        shortDescription = title;
        break;
      default:
        structuredContent = html;
        shortDescription = editor.getText().substring(0, 100);
    }

    if (shortDescription.length === 100) shortDescription += '...';

    const parentId = isThread
      ? null
      : parseInt(String(selectedNode.id).replace('node-', ''), 10);

    onSubmit({
      id: selectedNode.id,
      type: selectedNode.type,
      newNode: {
        title,
        content: structuredContent,
        description: shortDescription,
        type: Number(nodeType),
        parentId,
        threadId: thread.id,
        metadata: {
          title: title || 'New Node',
          description: shortDescription,
          content: structuredContent,
          type: currentLabel,
        },
      },
    });
  };

  const canSubmit = title.trim() && editor && !editor.isEmpty;

  return (
    <div className="ne-page">
      <header className="ne-header">
        <button className="ne-back" onClick={onCancel}>
          ← Back to graph
        </button>
        <button
          className="ne-submit"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          Add Node
        </button>
      </header>

      <div className="ne-body">
        <div className="ne-column">
          <select
            className="ne-select"
            value={nodeType}
            onChange={(e) => setNodeType(e.target.value)}
          >
            {NODE_TYPES
              .filter(t => isThread || t.label !== 'ROOT')
              .map(t => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
          </select>

          <input
            className="ne-title-input"
            type="text"
            placeholder={TITLE_PLACEHOLDERS[currentLabel] || 'Title'}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {currentLabel === 'ROOT' && (
            <input
              className="ne-keywords-input"
              type="text"
              placeholder="Keywords (comma-separated)"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />
          )}

          <div>
            <Toolbar editor={editor} />
            <div className="ne-editor-wrapper">
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NodeEditor;
