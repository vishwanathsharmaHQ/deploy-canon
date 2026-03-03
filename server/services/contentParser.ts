/**
 * Extract plain text from node content (which may be JSON with various structures).
 */
export function extractContentText(content: unknown): string {
  if (!content) return '';
  let text = String(content);
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      text = parsed.description || parsed.point || parsed.explanation || parsed.argument || parsed.content || text;
    } catch { /* keep raw */ }
  }
  return text.replace(/<[^>]+>/g, ' ').trim();
}

/**
 * Strip HTML tags from text.
 */
export function stripHtml(html: unknown): string {
  if (!html) return '';
  return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
