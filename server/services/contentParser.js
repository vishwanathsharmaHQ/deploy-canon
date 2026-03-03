/**
 * Extract plain text from node content (which may be JSON with various structures).
 */
function extractContentText(content) {
  if (!content) return '';
  let text = String(content);
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      text = parsed.description || parsed.point || parsed.explanation || parsed.argument || parsed.content || text;
    } catch (e) { /* keep raw */ }
  }
  return text.replace(/<[^>]+>/g, ' ').trim();
}

/**
 * Strip HTML tags from text.
 */
function stripHtml(html) {
  if (!html) return '';
  return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { extractContentText, stripHtml };
