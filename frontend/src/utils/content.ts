/**
 * Parse node content which may be a JSON string with various shapes.
 * Returns the most meaningful text content.
 */
export function parseNodeContent(content: string): string {
  if (!content) return '';
  try {
    const parsed = JSON.parse(content);
    return parsed.description || parsed.point || parsed.explanation || parsed.argument || content;
  } catch {
    return content;
  }
}

/**
 * Strip HTML tags from a string.
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract clean text from node content (parse JSON + strip HTML).
 */
export function extractContentText(content: string, maxLength?: number): string {
  let text = parseNodeContent(content);
  text = stripHtml(text);
  if (maxLength && text.length > maxLength) {
    text = text.substring(0, maxLength);
  }
  return text;
}
