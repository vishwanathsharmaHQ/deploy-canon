import React from 'react';
import './ArticleReader.css';

// ── Content renderer ──────────────────────────────────────────────────────────
// Handles: raw HTML, YouTube embeds, inline URL linkification, plain paragraphs
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
    // Full-line YouTube URL → embed
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

    // Inline URL linkification
    const segments = [];
    let lastIdx = 0;
    let m;
    urlRegex.lastIndex = 0;
    while ((m = urlRegex.exec(para)) !== null) {
      if (m.index > lastIdx) segments.push(para.slice(lastIdx, m.index));
      segments.push(
        <a key={m.index} href={m[0]} target="_blank" rel="noopener noreferrer">
          {m[0]}
        </a>
      );
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < para.length) segments.push(para.slice(lastIdx));

    return <p key={pi}>{segments.length ? segments : para}</p>;
  });
};

// ── Component ─────────────────────────────────────────────────────────────────
const ArticleReader = ({ thread, onBack }) => {
  if (!thread) return null;

  const title =
    thread.metadata?.title || thread.title || `Thread ${thread.id}`;
  const description =
    thread.metadata?.description || thread.description || '';

  return (
    <div className="ar-page">
      <header className="ar-header">
        <button className="ar-back" onClick={onBack}>
          ← Back to graph
        </button>
        <span className="ar-brand">canonthread</span>
      </header>

      <main className="ar-body">
        <article className="ar-article">
          <h1 className="ar-title">{title}</h1>
          {description && <p className="ar-description">{description}</p>}
          <hr className="ar-divider" />
          <div className="ar-content">
            {renderContent(thread.content)}
          </div>
        </article>
      </main>
    </div>
  );
};

export default ArticleReader;
