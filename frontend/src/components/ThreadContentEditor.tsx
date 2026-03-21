import React, { useState, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Link from '@tiptap/extension-link';
import Youtube from '@tiptap/extension-youtube';
import Placeholder from '@tiptap/extension-placeholder';
import lowlight from '../utils/lowlight';
import ReactMarkdown from 'react-markdown';
import { sanitizeHtml } from '../utils/sanitize';
import { embedYouTubeLinks } from '../utils/articleContent';
import { api } from '../services/api';
import EditorToolbar from './EditorToolbar';
import type { Thread, User } from '../types';

interface ThreadContentEditorProps {
  thread: Thread;
  onContentChange?: (html: string) => void;
  currentUser: User | null | undefined;
  onAuthRequired?: () => void;
}

const ThreadContentEditor: React.FC<ThreadContentEditorProps & { onTitleChanged?: (title: string) => void; onDelete?: () => void }> = ({ thread, onContentChange, currentUser, onAuthRequired, onTitleChanged, onDelete }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleSaving, setTitleSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const effectiveContent = thread.content && thread.content !== '<p></p>'
    ? thread.content
    : thread.metadata?.description || thread.description || '';

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, codeBlock: false }),
      CodeBlockLowlight.configure({ lowlight }),
      Link.configure({ openOnClick: false }),
      Youtube.configure({ width: 640, height: 360 }),
      Placeholder.configure({ placeholder: 'Write your thread notes here...' }),
    ],
    content: embedYouTubeLinks(effectiveContent),
    editable: false,
  });

  // Keep editor content in sync when thread changes (e.g. different thread selected)
  useEffect(() => {
    if (editor) {
      const content = thread.content && thread.content !== '<p></p>'
        ? thread.content
        : thread.metadata?.description || thread.description || '';
      editor.commands.setContent(embedYouTubeLinks(content));
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
    const content = thread.content && thread.content !== '<p></p>'
      ? thread.content
      : thread.metadata?.description || thread.description || '';
    editor?.commands.setContent(embedYouTubeLinks(content));
    editor?.setEditable(false);
    setIsEditing(false);
  };

  const title = thread.metadata?.title || thread.title || `Thread ${thread.id}`;
  const description = thread.metadata?.description || thread.description || '';
  const hasContent = thread.content && thread.content !== '<p></p>';

  const handleTitleEdit = () => {
    if (!currentUser) { onAuthRequired?.(); return; }
    setTitleDraft(title);
    setEditingTitle(true);
  };

  const handleTitleSave = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === title) { setEditingTitle(false); return; }
    setTitleSaving(true);
    try {
      await api.updateThread(thread.id, { title: trimmed });
      onTitleChanged?.(trimmed);
      setEditingTitle(false);
    } catch (err) {
      console.error('Failed to rename thread:', err);
    } finally {
      setTitleSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!currentUser) { onAuthRequired?.(); return; }
    setDeleting(true);
    try {
      await api.deleteThread(thread.id);
      onDelete?.();
    } catch (err) {
      console.error('Failed to delete thread:', err);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const renderThreadContent = (raw: string): React.ReactNode => {
    if (!raw) return null;
    if (raw.trim().startsWith('<')) {
      return <div className="ar-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(raw) }} />;
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

      {editingTitle ? (
        <div className="ar-title-edit-row">
          <input
            className="ar-title-edit-input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleTitleSave(); if (e.key === 'Escape') setEditingTitle(false); }}
            autoFocus
          />
          <button className="ar-save-btn" onClick={handleTitleSave} disabled={titleSaving}>
            {titleSaving ? '...' : 'Save'}
          </button>
          <button className="ar-cancel-btn" onClick={() => setEditingTitle(false)}>Cancel</button>
        </div>
      ) : (
        <h1 className="ar-title ar-title-editable" onClick={handleTitleEdit} title="Click to rename">{title}</h1>
      )}
      <hr className="ar-divider" />

      {isEditing ? (
        <div className="ar-editor-section">
          <EditorToolbar editor={editor} classPrefix="ar" />
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

      {onDelete && !isEditing && (
        <div className="ar-thread-delete-row">
          <button className="ar-delete-thread-btn" onClick={() => { if (!currentUser) { onAuthRequired?.(); return; } setShowDeleteConfirm(true); }}>
            Delete Thread
          </button>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="ar-modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="ar-modal ar-delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="ar-modal-title" style={{ color: '#ef5350' }}>Delete Thread</h3>
            <p className="ar-modal-desc">
              This will permanently delete <strong style={{ color: '#fff' }}>{title}</strong> and all its nodes. This cannot be undone.
            </p>
            <div className="ar-modal-actions">
              <button className="ar-delete-confirm-btn" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
              <button className="ar-modal-cancel" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
};

export default ThreadContentEditor;
