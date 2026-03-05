import React, { useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Youtube from '@tiptap/extension-youtube';
import Placeholder from '@tiptap/extension-placeholder';
import EditorToolbar from './EditorToolbar';
import { NODE_TYPES, RELATIONSHIP_TYPES, ENTITY_TYPE_LABELS } from '../constants';
import type { Thread, NodeTypeName } from '../types';
import './NodeEditor.css';

const NODE_TYPE_OPTIONS = NODE_TYPES.map((label, value) => ({ value, label, displayLabel: ENTITY_TYPE_LABELS[label] || label }));

const TITLE_PLACEHOLDERS: Record<string, string> = {
  claim: 'Root Title',
  evidence: 'Source',
  example: 'Example Title',
  counterpoint: 'Argument',
  source: 'Title',
  context: 'Title',
  synthesis: 'Title',
  question: 'Title',
  note: 'Title'
};

const CONTENT_PLACEHOLDERS: Record<string, string> = {
  claim: 'Describe this root node...',
  evidence: 'Present your evidence...',
  example: 'Describe this example...',
  counterpoint: 'Explain the counterpoint...',
  source: 'Write reference content...',
  context: 'Provide context...',
  synthesis: 'Write your synthesis...',
  question: 'Write your question...',
  note: 'Write your note...'
};

// ── NodeEditor ───────────────────────────────────────────────────────────────

interface SelectedNodeData {
  id: number | string;
  type: string | number;
}

interface NewNodeData {
  title: string;
  content: string;
  description: string;
  type: number;
  parentId: number | null;
  threadId: number;
  connectTo?: { targetId: number; relationType: string };
  metadata: {
    title: string;
    description: string;
    content: string;
    type: string;
  };
}

interface NodeEditorProps {
  thread: Thread;
  selectedNode: SelectedNodeData | null;
  onSubmit: (payload: { id: number | string; type: string | number; newNode: NewNodeData }) => void;
  onCancel: () => void;
}

const NodeEditor: React.FC<NodeEditorProps> = ({ thread, selectedNode, onSubmit, onCancel }) => {
  const isThread = selectedNode?.type === 'thread';

  const [nodeType, setNodeType] = useState<string>(() => {
    // Default to EVIDENCE (1) unless parent is thread, then allow ROOT (0)
    return isThread ? '0' : '1';
  });
  const [relationType, setRelationType] = useState<string>('SUPPORTS');
  const [title, setTitle] = useState('');
  const [keywords, setKeywords] = useState('');
  const [hasContent, setHasContent] = useState(false);

  const currentLabel = NODE_TYPE_OPTIONS[Number(nodeType)]?.label || 'evidence';

  // Auto-update relationship type when node type changes
  const inferRelType = (label: string) => {
    switch (label) {
      case 'evidence': return 'SUPPORTS';
      case 'source': return 'CITES';
      case 'example': return 'ILLUSTRATES';
      case 'counterpoint': return 'CONTRADICTS';
      case 'context': return 'QUALIFIES';
      case 'synthesis': return 'DERIVES_FROM';
      case 'question': return 'ADDRESSES';
      default: return 'SUPPORTS';
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false }),
      Youtube.configure({ width: 640, height: 360 }),
      Placeholder.configure({
        placeholder: CONTENT_PLACEHOLDERS[currentLabel] || 'Write your content...',
      }),
    ],
    content: '',
    onUpdate: ({ editor }: { editor: { isEmpty: boolean } }) => {
      setHasContent(!editor.isEmpty);
    },
  });

  const handleSubmit = () => {
    if (!editor || !title.trim()) return;

    const html = editor.getHTML();

    // Structure content the same way ThreadGraph.handleAddNode did
    let structuredContent: string;
    let shortDescription: string;

    switch (currentLabel) {
      case 'claim':
        structuredContent = JSON.stringify({
          title,
          description: html,
          keywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
        });
        shortDescription = title;
        break;
      case 'evidence':
        structuredContent = JSON.stringify({
          point: html,
          source: title,
        });
        shortDescription = editor.getText().substring(0, 100);
        break;
      case 'example':
        structuredContent = JSON.stringify({
          title,
          description: html,
        });
        shortDescription = editor.getText().substring(0, 100);
        break;
      case 'counterpoint':
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
      : parseInt(String(selectedNode!.id).replace('node-', ''), 10);

    // Build connectTo for typed relationship (only for non-thread parents)
    const connectTo = parentId != null
      ? { targetId: parentId, relationType }
      : undefined;

    onSubmit({
      id: selectedNode!.id,
      type: selectedNode!.type,
      newNode: {
        title,
        content: structuredContent,
        description: shortDescription,
        type: Number(nodeType),
        parentId,
        threadId: thread.id,
        connectTo,
        metadata: {
          title: title || 'New Node',
          description: shortDescription,
          content: structuredContent,
          type: currentLabel,
        },
      },
    });
  };

  const canSubmit = title.trim() && editor && hasContent;

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
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              setNodeType(e.target.value);
              const label = NODE_TYPE_OPTIONS[Number(e.target.value)]?.label || 'evidence';
              setRelationType(inferRelType(label));
            }}
          >
            {NODE_TYPE_OPTIONS
              .map(t => (
                <option key={t.value} value={t.value}>
                  {t.displayLabel}
                </option>
              ))}
          </select>

          {!isThread && (
            <select
              className="ne-select"
              value={relationType}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRelationType(e.target.value)}
              style={{ marginTop: 8 }}
            >
              {RELATIONSHIP_TYPES.map(rt => (
                <option key={rt} value={rt}>
                  {rt.replace('_', ' ')} → parent
                </option>
              ))}
            </select>
          )}

          <input
            className="ne-title-input"
            type="text"
            placeholder={TITLE_PLACEHOLDERS[currentLabel] || 'Title'}
            value={title}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
          />

          {currentLabel === 'claim' && (
            <input
              className="ne-keywords-input"
              type="text"
              placeholder="Keywords (comma-separated)"
              value={keywords}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeywords(e.target.value)}
            />
          )}

          <div>
            <EditorToolbar editor={editor} classPrefix="ne" />
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
