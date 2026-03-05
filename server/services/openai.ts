import OpenAI from 'openai';
import config from '../config.js';

let _openai: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (_openai) return _openai;
  _openai = new OpenAI({ apiKey: config.openai.apiKey, timeout: config.openai.timeout });
  return _openai;
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!text || !text.trim()) return null;
  const openai = getOpenAI();
  const response = await openai.embeddings.create({
    model: config.openai.embeddingModel,
    input: text.substring(0, config.openai.maxEmbeddingChars),
  });
  return response.data[0].embedding;
}

export function getEmbeddingText(entity: Record<string, unknown>, type: 'thread' | 'node'): string {
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
    } catch { /* keep raw */ }
  }
  contentText = String(contentText).replace(/<[^>]+>/g, ' ');
  return [entity.title, `[${entity.entity_type || entity.node_type || ''}]`, contentText]
    .filter(Boolean)
    .join('\n')
    .substring(0, config.openai.maxEmbeddingChars);
}
