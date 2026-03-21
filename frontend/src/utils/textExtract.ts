/** Extract readable plain text from node content (JSON+HTML) */
export function contentToPlainText(content: unknown): string {
  let raw = content;
  if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).content !== undefined) {
    raw = (raw as Record<string, unknown>).content;
  }

  let text = '';
  if (typeof raw === 'string') {
    // Try parsing as JSON to extract meaningful fields
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          const parts: string[] = [];
          if (parsed.title) parts.push(parsed.title);
          const body = parsed.description || parsed.point || parsed.explanation
            || parsed.content || parsed.text || parsed.argument || '';
          if (body) parts.push(body);
          if (parsed.keywords && Array.isArray(parsed.keywords) && parsed.keywords.length) {
            parts.push(`Keywords: ${parsed.keywords.join(', ')}`);
          }
          text = parts.join('\n\n');
        }
      } catch {
        text = raw;
      }
    }
    if (!text) text = raw;
  } else if (raw && typeof raw === 'object') {
    text = JSON.stringify(raw, null, 2);
  } else {
    text = String(raw || '');
  }

  // Strip HTML tags, decode entities, normalize whitespace
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|li|tr)[\s>]/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
