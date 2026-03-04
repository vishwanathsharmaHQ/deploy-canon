import React, { useState } from 'react';
import InputModal from './InputModal';

interface EditorToolbarProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any;
  classPrefix: string; // 'ar' or 'ne'
}

const EditorToolbar: React.FC<EditorToolbarProps> = ({ editor, classPrefix }) => {
  const [modal, setModal] = useState<null | 'link' | 'youtube'>(null);

  if (!editor) return null;

  const Btn: React.FC<{ onClick: () => void; active?: boolean; children: React.ReactNode }> = ({ onClick, active, children }) => (
    <button type="button" onClick={onClick} className={active ? 'is-active' : ''}>
      {children}
    </button>
  );

  const Divider = () => <span className={`${classPrefix}-toolbar-divider`} />;

  return (
    <>
      <div className={`${classPrefix}-toolbar`}>
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
          onSubmit={(url: string) => {
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
          onSubmit={(url: string) => {
            editor.commands.setYoutubeVideo({ src: url });
            setModal(null);
          }}
          onCancel={() => setModal(null)}
        />
      )}
    </>
  );
};

export default EditorToolbar;
