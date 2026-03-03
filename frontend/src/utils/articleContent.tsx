import React from 'react';
import ReactMarkdown from 'react-markdown';
import { sanitizeHtml } from './sanitize';
import { NODE_TYPES, NODE_TYPE_COLORS } from '../constants';
import type { NodeTypeName } from '../types';

// Lazily imported by formatNodeContent — avoid circular dep by importing at call site
// SourceVerifyBadge is imported dynamically below

export interface EditableContent {
  title: string;
  html: string;
  keywords?: string;
}

// Convert YouTube <a> links and bare markdown-style URLs into TipTap YouTube embed markup
export function embedYouTubeLinks(html: string): string {
  if (!html) return html;
  const ytPattern = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/;
  // Replace <a> tags wrapping YouTube URLs
  let result = html.replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, (match, href) => {
    const yt = href.match(ytPattern);
    if (yt) {
      return `<div data-youtube-video><iframe src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen></iframe></div>`;
    }
    return match;
  });
  // Replace bare YouTube URLs (markdown [text](url) converted to text only, or raw URLs on their own line)
  result = result.replace(/(^|>|\s)(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})[^\s<]*)/gm, (match, prefix, _url, id) => {
    return `${prefix}<div data-youtube-video><iframe src="https://www.youtube.com/embed/${id}" allowfullscreen></iframe></div>`;
  });
  return result;
}

export const getNodeType = (node: any): string => {
  if (node.node_type) return node.node_type;
  if (typeof node.type === 'number') return NODE_TYPES[node.type] || 'ROOT';
  return node.type || 'ROOT';
};

export function getEditableContent(node: any): EditableContent {
  const nodeType = getNodeType(node);
  let raw = node.content;
  if (raw && typeof raw === 'object' && raw.content !== undefined) raw = raw.content;
  let parsed: any = raw;
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

export function buildSavedContent(nodeType: string, title: string, html: string, keywords: string): string {
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

// Render a string that may contain HTML or markdown.
// TipTap / saved HTML always starts with a tag; AI content is markdown.
export const renderHtmlOrText = (str: any, linkify?: (html: string) => string): React.ReactNode => {
  if (!str) return null;
  const s = String(str);
  if (s.trim().startsWith('<')) {
    const html = linkify ? linkify(s) : s;
    return <div className="ar-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />;
  }
  return <div className="ar-markdown"><ReactMarkdown>{s}</ReactMarkdown></div>;
};

// Content renderer (for read-only node pages)
export const renderContent = (rawContent: any, linkify?: (html: string) => string): React.ReactNode => {
  if (!rawContent) return <p className="ar-empty">No content available.</p>;

  let text: any = rawContent;
  if (typeof text === 'object') {
    text = text.content || text.text || JSON.stringify(text, null, 2);
  }
  if (typeof text !== 'string') return <p className="ar-empty">No content available.</p>;

  // Raw HTML — render directly
  if (text.trim().startsWith('<')) {
    const html = linkify ? linkify(text) : text;
    return <div className="ar-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />;
  }

  const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/;
  const urlRegex = /https?:\/\/[^\s<>"]+/g;

  const paragraphs = text
    .split(/\n{2,}/)
    .flatMap((p: string) => (p.includes('\n') ? p.split('\n') : [p]))
    .filter((p: string) => p.trim() !== '');

  return paragraphs.map((para: string, pi: number) => {
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

    const segments: React.ReactNode[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
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

// Returns a React element (not a string) for structured node content.
// SourceVerifyBadge is passed in to avoid circular dependency.
export const formatNodeContent = (
  node: any,
  SourceVerifyBadge?: React.FC<{ url: string; claim: string }>,
): React.ReactNode => {
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
                {isUrl && SourceVerifyBadge && (
                  <SourceVerifyBadge
                    url={src}
                    claim={typeof content.point === 'string' ? content.point.replace(/<[^>]+>/g, '').substring(0, 300) : String(content.point || '').substring(0, 300)}
                  />
                )}
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
