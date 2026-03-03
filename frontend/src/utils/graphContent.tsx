import React from 'react';
import ReactMarkdown from 'react-markdown';
import { sanitizeHtml } from './sanitize';
import { YT_REGEX } from '../constants';
import { createMdComponents } from './markdown';

const mdComponents = createMdComponents('sidebar-youtube');

// Render a string that may contain HTML tags or markdown
export const renderText = (text: unknown): React.ReactNode => {
  if (!text) return null;
  const str = String(text);
  if (/<[a-z][\s\S]*>/i.test(str)) {
    return <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(str) }} />;
  }
  return <ReactMarkdown components={mdComponents as Record<string, React.ComponentType>}>{str}</ReactMarkdown>;
};

export const formatContent = (content: unknown, nodeType: string): React.ReactNode => {
  if (!content) return 'No content available';

  try {
    let actualContent = content.content || content;

    if (typeof actualContent === 'string' && (actualContent.startsWith('{') || actualContent.startsWith('['))) {
      try { actualContent = JSON.parse(actualContent); } catch (e) { /* ignore */ }
    }

    if (['ROOT', 'EVIDENCE', 'EXAMPLE', 'COUNTERPOINT'].includes(nodeType)) {
      const jsonContent = typeof actualContent === 'object' ? actualContent :
        typeof actualContent === 'string' && actualContent.startsWith('{') ?
          JSON.parse(actualContent) : null;

      if (jsonContent) {
        switch (nodeType) {
          case 'ROOT':
            return (
              <div className="root-content">
                <h4 className="root-title">{renderText(jsonContent.title)}</h4>
                <div className="root-description">{renderText(jsonContent.description)}</div>
                {jsonContent.keywords && (
                  <div className="root-keywords">
                    <strong>Keywords: </strong>{Array.isArray(jsonContent.keywords) ? jsonContent.keywords.join(', ') : renderText(jsonContent.keywords)}
                  </div>
                )}
              </div>
            );
          case 'EVIDENCE': {
            const srcUrl = jsonContent.source || '';
            const ytMatch = srcUrl.match?.(YT_REGEX);
            return (
              <div className="evidence-content">
                <div className="evidence-point">{renderText(jsonContent.point)}</div>
                {ytMatch ? (
                  <div className="sidebar-youtube">
                    <iframe
                      src={`https://www.youtube.com/embed/${ytMatch[1]}`}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      title={`yt-${ytMatch[1]}`}
                    />
                  </div>
                ) : (
                  <p className="evidence-source"><em>Source: {
                    /^https?:\/\//.test(srcUrl)
                      ? <a href={srcUrl} target="_blank" rel="noopener noreferrer">{srcUrl}</a>
                      : renderText(srcUrl)
                  }</em></p>
                )}
              </div>
            );
          }
          case 'EXAMPLE':
            return (
              <div className="example-content">
                <h4 className="example-title">{renderText(jsonContent.title)}</h4>
                <div className="example-description">{renderText(jsonContent.description)}</div>
              </div>
            );
          case 'COUNTERPOINT':
            return (
              <div className="counterpoint-content">
                <h4 className="counterpoint-argument">{renderText(jsonContent.argument)}</h4>
                <div className="counterpoint-explanation">{renderText(jsonContent.explanation)}</div>
              </div>
            );
        }
      }
    }

    // Plain text or HTML string
    const textContent = typeof actualContent === 'object' ?
      JSON.stringify(actualContent, null, 2) : String(actualContent);
    if (/<[a-z][\s\S]*>/i.test(textContent)) {
      return <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(textContent) }} />;
    }
    return <ReactMarkdown components={mdComponents as Record<string, React.ComponentType>}>{textContent}</ReactMarkdown>;
  } catch (e) {
    return 'Error displaying content';
  }
};
