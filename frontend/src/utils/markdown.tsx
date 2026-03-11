import React from 'react';
import { YT_REGEX } from '../constants';
import CodeBlock from '../components/CodeBlock';
import '../components/CodeBlock.css';

/**
 * Create ReactMarkdown `components` override that renders YouTube links as
 * embedded iframes and code blocks with syntax highlighting + copy button.
 * Pass a CSS class name for the wrapper div so each consumer can style it
 * independently (e.g. 'cp-youtube', 'sidebar-youtube').
 */
export function createMdComponents(youtubeClassName: string) {
  return {
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const yt = href?.match(YT_REGEX);
      if (yt) {
        return (
          <div className={youtubeClassName}>
            <iframe
              src={`https://www.youtube.com/embed/${yt[1]}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title={`yt-${yt[1]}`}
            />
          </div>
        );
      }
      return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
    },
    code: ({ className, children, ...props }: { className?: string; children?: React.ReactNode; node?: unknown }) => {
      // Detect if this is a fenced code block (has language class) or inline code
      const isInline = !className && typeof children === 'string' && !children.includes('\n');
      return <CodeBlock className={className} inline={isInline} {...props}>{children}</CodeBlock>;
    },
    pre: ({ children }: { children?: React.ReactNode }) => {
      // ReactMarkdown wraps code blocks in <pre><code>. We handle this in the code component,
      // so just pass through children without the default <pre> wrapper.
      return <>{children}</>;
    },
  };
}
