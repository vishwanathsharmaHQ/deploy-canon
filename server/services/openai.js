const config = require('../config');

let _openai;

function getOpenAI() {
  if (_openai) return _openai;
  const OpenAI = require('openai');
  _openai = new OpenAI({ apiKey: config.openai.apiKey, timeout: config.openai.timeout });
  return _openai;
}

async function generateEmbedding(text) {
  if (!text || !text.trim()) return null;
  const openai = getOpenAI();
  const response = await openai.embeddings.create({
    model: config.openai.embeddingModel,
    input: text.substring(0, config.openai.maxEmbeddingChars),
  });
  return response.data[0].embedding;
}

function getEmbeddingText(entity, type) {
  if (type === 'thread') {
    return [entity.title, entity.description, entity.content]
      .filter(Boolean)
      .join('\n')
      .substring(0, config.openai.maxEmbeddingChars);
  }
  // type === 'node'
  let contentText = entity.content || '';
  if (typeof contentText === 'string' && (contentText.startsWith('{') || contentText.startsWith('['))) {
    try {
      const parsed = JSON.parse(contentText);
      contentText = parsed.description || parsed.point || parsed.explanation || parsed.argument || parsed.content || contentText;
    } catch (e) { /* keep raw */ }
  }
  contentText = String(contentText).replace(/<[^>]+>/g, ' ');
  return [entity.title, `[${entity.node_type || ''}]`, contentText]
    .filter(Boolean)
    .join('\n')
    .substring(0, config.openai.maxEmbeddingChars);
}

module.exports = { getOpenAI, generateEmbedding, getEmbeddingText };
