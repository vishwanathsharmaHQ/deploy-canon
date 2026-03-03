import React, { useState, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Youtube from '@tiptap/extension-youtube';
import Placeholder from '@tiptap/extension-placeholder';
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

const ThreadContentEditor: React.FC<ThreadContentEditorProps> = ({ thread, onContentChange, currentUser, onAuthRequired }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false }),
      Youtube.configure({ width: 640, height: 360 }),
      Placeholder.configure({ placeholder: 'Write your thread notes here...' }),
    ],
    content: embedYouTubeLinks(thread.content || ''),
    editable: false,
  });

  // Keep editor content in sync when thread changes (e.g. different thread selected)
  useEffect(() => {
    if (editor) {
      editor.commands.setContent(embedYouTubeLinks(thread.content || ''));
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
    editor?.commands.setContent(embedYouTubeLinks(thread.content || ''));
    editor?.setEditable(false);
    setIsEditing(false);
  };

  const title = thread.metadata?.title || thread.title || `Thread ${thread.id}`;
  const description = thread.metadata?.description || thread.description || '';
  const hasContent = thread.content && thread.content !== '<p></p>';

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

      <h1 className="ar-title">{title}</h1>
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
    </article>
  );
};

export default ThreadContentEditor;
