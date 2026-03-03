import React from 'react';
import { YT_REGEX } from '../constants';

/**
 * Create ReactMarkdown `components` override that renders YouTube links as
 * embedded iframes.  Pass a CSS class name for the wrapper div so each
 * consumer can style it independently (e.g. 'cp-youtube', 'sidebar-youtube').
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
  };
}
