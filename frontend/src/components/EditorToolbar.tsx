import React, { useState, useCallback } from 'react';
import InputModal from './InputModal';

interface EditorToolbarProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any;
  classPrefix: string; // 'ar' or 'ne'
}

const EditorToolbar: React.FC<EditorToolbarProps> = ({ editor, classPrefix }) => {
  const [modal, setModal] = useState<null | 'link' | 'youtube'>(null);

  const runCmd = useCallback((cmd: () => void) => {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      cmd();
    };
  }, []);

  if (!editor) return null;

  return (
    <>
      <div className={`${classPrefix}-toolbar`}>
        <button type="button" onMouseDown={runCmd(() => editor.chain().focus().toggleBold().run())} className={editor.isActive('bold') ? 'is-active' : ''}>B</button>
        <button type="button" onMouseDown={runCmd(() => editor.chain().focus().toggleItalic().run())} className={editor.isActive('italic') ? 'is-active' : ''}>I</button>
        <button type="button" onMouseDown={runCmd(() => editor.chain().focus().toggleStrike().run())} className={editor.isActive('strike') ? 'is-active' : ''}>S</button>
        <span className={`${classPrefix}-toolbar-divider`} />
        <button type="button" onMouseDown={runCmd(() => editor.chain().focus().toggleHeading({ level: 1 }).run())} className={editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}>H1</button>
        <button type="button" onMouseDown={runCmd(() => editor.chain().focus().toggleHeading({ level: 2 }).run())} className={editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}>H2</button>
        <button type="button" onMouseDown={runCmd(() => editor.chain().focus().toggleHeading({ level: 3 }).run())} className={editor.isActive('heading', { level: 3 }) ? 'is-active' : ''}>H3</button>
        <span className={`${classPrefix}-toolbar-divider`} />
        <button type="button" onMouseDown={runCmd(() => editor.chain().focus().toggleBulletList().run())} className={editor.isActive('bulletList') ? 'is-active' : ''}>Bullet</button>
        <button type="button" onMouseDown={runCmd(() => editor.chain().focus().toggleOrderedList().run())} className={editor.isActive('orderedList') ? 'is-active' : ''}>Ordered</button>
        <button type="button" onMouseDown={runCmd(() => editor.chain().focus().toggleBlockquote().run())} className={editor.isActive('blockquote') ? 'is-active' : ''}>Quote</button>
        <button type="button" onMouseDown={runCmd(() => editor.chain().focus().toggleCodeBlock().run())} className={editor.isActive('codeBlock') ? 'is-active' : ''}>Code</button>
        <span className={`${classPrefix}-toolbar-divider`} />
        <button type="button" onClick={() => setModal('link')} className={editor.isActive('link') ? 'is-active' : ''}>Link</button>
        <button type="button" onClick={() => setModal('youtube')}>YouTube</button>
      </div>
      {modal === 'link' && (
        <InputModal
          label="Enter URL"
          placeholder="https://example.com"
          onSubmit={(url: string) => {
            editor.chain().focus().setLink({ href: url }).run();
            setModal(null);
          }}
          onCancel={() => setModal(null)}
        />
      )}
      {modal === 'youtube' && (
        <InputModal
          label="Enter YouTube URL"
          placeholder="https://youtube.com/watch?v=..."
          onSubmit={(url: string) => {
            editor.chain().focus().setYoutubeVideo({ src: url }).run();
            setModal(null);
          }}
          onCancel={() => setModal(null)}
        />
      )}
    </>
  );
};

export default EditorToolbar;
