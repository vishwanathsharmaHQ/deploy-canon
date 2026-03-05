import DOMPurify from 'dompurify';

/**
 * Sanitize HTML content for safe rendering with dangerouslySetInnerHTML.
 */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre', 'span', 'div', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'sup', 'sub', 'mark'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class', 'style', 'title', 'width', 'height', 'data-node-id'],
  });
}

/**
 * Create a safe dangerouslySetInnerHTML object.
 */
export function createSafeHtml(dirty: string): { __html: string } {
  return { __html: sanitizeHtml(dirty) };
}
