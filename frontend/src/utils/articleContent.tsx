import React from 'react';
import ReactMarkdown from 'react-markdown';
import hljs from 'highlight.js/lib/core';
import { sanitizeHtml } from './sanitize';
import { NODE_TYPES, NODE_TYPE_COLORS, YT_REGEX } from '../constants';
import { createMdComponents } from './markdown';
import type { NodeTypeName } from '../types';

// Register languages (mirrors CodeBlock.tsx registrations)
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import java from 'highlight.js/lib/languages/java';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import cpp from 'highlight.js/lib/languages/cpp';
import yaml from 'highlight.js/lib/languages/yaml';

if (!hljs.getLanguage('javascript')) {
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('js', javascript);
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('ts', typescript);
  hljs.registerLanguage('python', python);
  hljs.registerLanguage('py', python);
  hljs.registerLanguage('css', css);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('sh', bash);
  hljs.registerLanguage('html', xml);
  hljs.registerLanguage('xml', xml);
  hljs.registerLanguage('sql', sql);
  hljs.registerLanguage('java', java);
  hljs.registerLanguage('go', go);
  hljs.registerLanguage('rust', rust);
  hljs.registerLanguage('cpp', cpp);
  hljs.registerLanguage('c', cpp);
  hljs.registerLanguage('yaml', yaml);
  hljs.registerLanguage('yml', yaml);
}

const mdComponents = createMdComponents('ar-content-youtube');

/** Apply highlight.js to <pre><code> blocks in HTML strings */
function highlightCodeInHtml(html: string): string {
  return html.replace(
    /<pre><code(?:\s+class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/gi,
    (_match, lang, code) => {
      // Decode HTML entities so hljs sees real code
      const decoded = code
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      let highlighted: string;
      if (lang && hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(decoded, { language: lang }).value;
      } else {
        highlighted = hljs.highlightAuto(decoded).value;
      }
      const langLabel = lang ? `<div class="code-block-header"><span class="code-block-lang">${lang}</span></div>` : '';
      return `<div class="code-block-wrapper">${langLabel}<pre class="code-block-pre"><code class="hljs${lang ? ` language-${lang}` : ''}">${highlighted}</code></pre></div>`;
    }
  );
}

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
  const ytPattern = YT_REGEX;
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

export const getNodeType = (node: { node_type?: string; type?: string | number }): string => {
  if (node.node_type) return node.node_type;
  if (typeof node.type === 'number') return NODE_TYPES[node.type] || 'claim';
  return node.type || 'claim';
};

export function getEditableContent(node: { content: unknown; title?: string; node_type?: string; type?: string | number }): EditableContent {
  const nodeType = getNodeType(node);
  let raw: unknown = node.content;
  if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).content !== undefined) raw = (raw as Record<string, unknown>).content;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any = raw;
  if (typeof raw === 'string' && (raw.startsWith('{') || raw.startsWith('['))) {
    try { parsed = JSON.parse(raw); } catch (e) { /* keep as string */ }
  }
  // Helper: get string value from parsed object field, or fall back to raw string
  const rawStr = typeof raw === 'string' ? raw : '';
  const isObj = typeof parsed === 'object' && parsed !== null;

  switch (nodeType) {
    case 'claim':
      return {
        title: (isObj ? parsed?.title : null) || node.title || '',
        html: (isObj ? parsed?.description : null) || rawStr,
        keywords: isObj && parsed?.keywords
          ? (Array.isArray(parsed.keywords) ? parsed.keywords.join(', ') : parsed.keywords)
          : '',
      };
    case 'evidence':
      return {
        title: (isObj ? parsed?.source : null) || node.title || '',
        html: (isObj ? parsed?.point : null) || rawStr,
      };
    case 'example':
      return {
        title: (isObj ? parsed?.title : null) || node.title || '',
        html: (isObj ? parsed?.description : null) || rawStr,
      };
    case 'counterpoint':
      return {
        title: (isObj ? parsed?.argument : null) || node.title || '',
        html: (isObj ? parsed?.explanation : null) || rawStr,
      };
    case 'source':
      return {
        title: (isObj ? parsed?.title : null) || node.title || '',
        html: (isObj ? (parsed?.url || parsed?.content || parsed?.description || '') : null) || rawStr,
      };
    case 'context':
    case 'synthesis':
      return {
        title: (isObj ? parsed?.title : null) || node.title || '',
        html: (isObj ? (parsed?.description || parsed?.content || parsed?.text || '') : null) || rawStr,
      };
    default: {
      let html = '';
      if (isObj) {
        html = parsed.description || parsed.content || parsed.text || parsed.explanation || parsed.point || '';
        if (!html) html = JSON.stringify(parsed, null, 2);
      } else {
        html = rawStr;
      }
      return { title: node.title || '', html };
    }
  }
}

export function buildSavedContent(nodeType: string, title: string, html: string, keywords: string): string {
  switch (nodeType) {
    case 'claim':
      return JSON.stringify({
        title,
        description: html,
        keywords: keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : [],
      });
    case 'evidence':
      return JSON.stringify({ point: html, source: title });
    case 'example':
      return JSON.stringify({ title, description: html });
    case 'counterpoint':
      return JSON.stringify({ argument: title, explanation: html });
    default:
      return html;
  }
}

// Strip HTML tags to get plain text, preserving line breaks
const htmlToText = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|li|tr|blockquote)[\s>]/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Render a string that may contain HTML or markdown.
// TipTap / saved HTML always starts with a tag; AI content is markdown.
export const renderHtmlOrText = (str: unknown, linkify?: (html: string) => string): React.ReactNode => {
  if (!str) return null;
  const s = String(str);
  if (s.trim().startsWith('<')) {
    // If the HTML contains markdown code fences, strip tags and render as markdown
    // so code blocks get syntax highlighting via CodeBlock component
    if (s.includes('```')) {
      const plainText = htmlToText(s);
      return <div className="ar-markdown"><ReactMarkdown components={mdComponents as Record<string, React.ComponentType>}>{plainText}</ReactMarkdown></div>;
    }
    // Convert literal \n inside <p> tags to <br> so they render as line breaks
    let fixed = s.replace(/(<p[^>]*>)([\s\S]*?)(<\/p>)/gi, (_match, open, inner, close) => {
      if (inner.includes('\n')) {
        return open + inner.replace(/\n/g, '<br>') + close;
      }
      return _match;
    });
    // Apply syntax highlighting to <pre><code> blocks
    fixed = highlightCodeInHtml(fixed);
    const html = linkify ? linkify(fixed) : fixed;
    return <div className="ar-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />;
  }
  return <div className="ar-markdown"><ReactMarkdown components={mdComponents as Record<string, React.ComponentType>}>{s}</ReactMarkdown></div>;
};

// Content renderer (for read-only node pages)
export const renderContent = (rawContent: unknown, linkify?: (html: string) => string): React.ReactNode => {
  if (!rawContent) return <p className="ar-empty">No content available.</p>;

  let text: unknown = rawContent;
  if (typeof text === 'object' && text !== null) {
    const obj = text as Record<string, any>;
    text = obj.content || obj.text || JSON.stringify(text, null, 2);
  }
  if (typeof text !== 'string') return <p className="ar-empty">No content available.</p>;

  // Raw HTML — render directly (with syntax highlighting for code blocks)
  if (text.trim().startsWith('<')) {
    const highlighted = highlightCodeInHtml(text);
    const html = linkify ? linkify(highlighted) : highlighted;
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

    // Build HTML string with URL links, then apply node linkification
    let paraHtml = para.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    paraHtml = paraHtml.replace(urlRegex, (url: string) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
    );
    if (linkify) paraHtml = linkify(paraHtml);

    return <p key={pi} dangerouslySetInnerHTML={{ __html: sanitizeHtml(paraHtml) }} />;
  });
};

// Returns a React element (not a string) for structured node content.
// SourceVerifyBadge is passed in to avoid circular dependency.
export const formatNodeContent = (
  node: { content: unknown; title?: string; node_type?: string; type?: string | number },
  SourceVerifyBadge?: React.FC<{ url: string; claim: string }>,
  linkify?: (html: string) => string,
): React.ReactNode => {
  let content = node.content;
  if (!content) return null;

  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed === 'object') content = parsed;
    } catch (e) { /* not JSON */ }
  }

  if (typeof content === 'object' && content !== null) {
    const c = content as Record<string, any>;
    // ROOT: { title, description, keywords }
    if (c.title && c.description && 'keywords' in c) {
      return (
        <div>
          <h3 style={{ color: '#fff', margin: '0 0 12px' }}>{c.title}</h3>
          {renderHtmlOrText(c.description, linkify)}
          {c.keywords?.length > 0 && (
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', marginTop: 16 }}>
              <em>Keywords: {Array.isArray(c.keywords) ? c.keywords.join(', ') : c.keywords}</em>
            </p>
          )}
        </div>
      );
    }
    // EVIDENCE: { point, source }
    if (c.point) {
      const src = c.source;
      const ytMatch = src?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
      const isUrl = src && /^https?:\/\//.test(src);
      return (
        <div>
          {renderHtmlOrText(c.point, linkify)}
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
                    claim={typeof c.point === 'string' ? c.point.replace(/<[^>]+>/g, '').substring(0, 300) : String(c.point || '').substring(0, 300)}
                  />
                )}
              </p>
            )
          )}
        </div>
      );
    }
    // EXAMPLE: { title, description }
    if (c.title && c.description) {
      return (
        <div>
          <h3 style={{ color: '#fff', margin: '0 0 12px' }}>{c.title}</h3>
          {renderHtmlOrText(c.description, linkify)}
        </div>
      );
    }
    // COUNTERPOINT: { argument, explanation }
    if (c.argument) {
      return (
        <div>
          <h3 style={{ color: '#fff', margin: '0 0 12px' }}>{c.argument}</h3>
          {c.explanation && renderHtmlOrText(c.explanation, linkify)}
        </div>
      );
    }
    if (c.content) return c.content;
    if (c.text) return c.text;
    return JSON.stringify(c, null, 2);
  }

  return content as React.ReactNode;
};
