import { GoogleGenerativeAI, type Content, type GenerateContentStreamResult } from '@google/generative-ai';
import config from '../config.js';

// ── Gemini client singleton ─────────────────────────────────────────────────
let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(apiKey?: string): GoogleGenerativeAI {
  if (!apiKey && _genAI) return _genAI;
  const ai = new GoogleGenerativeAI(apiKey || config.gemini.apiKey);
  if (!apiKey) _genAI = ai;
  return ai;
}

// ── Message conversion helpers ──────────────────────────────────────────────
interface ChatMessage {
  role: string;
  content: string;
}

function convertMessages(messages: ChatMessage[]): { systemInstruction?: string; contents: Content[] } {
  let systemInstruction: string | undefined;
  const contents: Content[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Gemini uses systemInstruction at model level; concatenate all system messages
      systemInstruction = systemInstruction
        ? `${systemInstruction}\n\n${msg.content}`
        : msg.content;
    } else {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      contents.push({ role, parts: [{ text: msg.content }] });
    }
  }

  // Gemini requires contents to start with a user message
  if (contents.length > 0 && contents[0].role === 'model') {
    contents.unshift({ role: 'user', parts: [{ text: '(context)' }] });
  }

  // Gemini doesn't allow consecutive messages of the same role — merge them
  const merged: Content[] = [];
  for (const c of contents) {
    if (merged.length > 0 && merged[merged.length - 1].role === c.role) {
      const prev = merged[merged.length - 1];
      prev.parts = [...prev.parts, ...c.parts];
    } else {
      merged.push({ ...c });
    }
  }

  return { systemInstruction, contents: merged };
}

// ── OpenAI-compatible wrapper ───────────────────────────────────────────────
// Mimics the OpenAI SDK interface so all existing route code works unchanged.

interface CompletionChoice {
  message: { content: string; role: string };
  index: number;
  finish_reason: string;
}

interface CompletionResponse {
  choices: CompletionChoice[];
}

interface StreamChunk {
  choices: { delta: { content?: string }; index: number }[];
}

interface EmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

class GeminiCompat {
  private genAI: GoogleGenerativeAI;

  constructor(opts?: { apiKey?: string; timeout?: number }) {
    this.genAI = getGenAI(opts?.apiKey);
  }

  /** Check if an error is a rate-limit (429) or resource-exhausted error */
  private _isRateLimitError(err: unknown): boolean {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      return msg.includes('429') || msg.includes('resource') && msg.includes('exhaust')
        || msg.includes('rate') && msg.includes('limit') || msg.includes('quota');
    }
    return false;
  }

  /**
   * Try calling `fn` with each model in the cascade until one succeeds.
   * Only retries on rate-limit errors; other errors are thrown immediately.
   */
  private async _withFallback<T>(fn: (modelName: string) => Promise<T>): Promise<T> {
    const cascade = config.gemini.modelCascade;
    let lastError: unknown;
    for (const modelName of cascade) {
      try {
        return await fn(modelName);
      } catch (err) {
        lastError = err;
        if (this._isRateLimitError(err)) {
          console.warn(`[gemini] ${modelName} rate-limited, falling back…`);
          continue;
        }
        throw err; // non-rate-limit error — don't retry
      }
    }
    throw lastError; // all models exhausted
  }

  chat = {
    completions: {
      create: async (params: {
        model?: string;
        messages: ChatMessage[];
        temperature?: number;
        stream?: boolean;
        response_format?: { type: string };
        max_tokens?: number;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }): Promise<any> => {
        const { systemInstruction, contents } = convertMessages(params.messages);

        const generationConfig: Record<string, unknown> = {};
        if (params.temperature !== undefined) generationConfig.temperature = params.temperature;
        if (params.response_format?.type === 'json_object') {
          generationConfig.responseMimeType = 'application/json';
        }

        return this._withFallback(async (modelName) => {
          const model = this.genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: systemInstruction || undefined,
            generationConfig,
          });

          if (params.stream) {
            const result = await model.generateContentStream({ contents });
            return this._wrapStream(result.stream);
          }

          const result = await model.generateContent({ contents });
          const text = result.response.text();
          return {
            choices: [{ message: { content: text, role: 'assistant' }, index: 0, finish_reason: 'stop' }],
          };
        });
      },
    },
  };

  // Gemini grounding with Google Search — replacement for OpenAI Responses API
  responses = {
    create: async (params: {
      model?: string;
      tools?: { type: string }[];
      input: ChatMessage[];
      stream?: boolean;
    }): Promise<AsyncIterable<Record<string, unknown>>> => {
      const { systemInstruction, contents } = convertMessages(params.input);

      return this._withFallback(async (modelName) => {
        const model = this.genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: systemInstruction || undefined,
          // @ts-expect-error -- Gemini SDK googleSearch tool type not yet in @types
          tools: [{ googleSearch: {} }],
        });

        if (params.stream) {
          const result = await model.generateContentStream({ contents });
          return this._wrapResponsesStream(result);
        }

        const result = await model.generateContent({ contents });
        const text = result.response.text();
        return (async function* () {
          yield { type: 'response.output_text.delta', delta: text };
          yield { type: 'response.completed', response: { output: [] } };
        })();
      });
    },
  };

  embeddings = {
    create: async (params: {
      model?: string;
      input: string;
    }): Promise<EmbeddingResponse> => {
      const model = this.genAI.getGenerativeModel({ model: config.gemini.embeddingModel });
      const result = await model.embedContent(params.input);
      return {
        data: [{ embedding: result.embedding.values, index: 0 }],
      };
    },
  };

  private async *_wrapStream(
    stream: AsyncIterable<{ text: () => string }>
  ): AsyncIterable<StreamChunk> {
    for await (const chunk of stream) {
      const text = chunk.text();
      if (text) {
        yield { choices: [{ delta: { content: text }, index: 0 }] };
      }
    }
  }

  private async *_wrapResponsesStream(
    result: GenerateContentStreamResult
  ): AsyncIterable<Record<string, unknown>> {
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        yield { type: 'response.output_text.delta', delta: text };
      }
    }
    // Extract grounding metadata (citations) from the final response
    try {
      const finalResponse = await result.response;
      const groundingMetadata = finalResponse.candidates?.[0]?.groundingMetadata;
      const citations: { url: string; title: string }[] = [];
      if (groundingMetadata?.groundingChunks) {
        for (const chunk of groundingMetadata.groundingChunks) {
          if (chunk.web) {
            citations.push({ url: chunk.web.uri || '', title: chunk.web.title || chunk.web.uri || '' });
          }
        }
      }
      yield {
        type: 'response.completed',
        response: {
          output: citations.length > 0
            ? [{
                type: 'message',
                content: [{
                  annotations: citations.map(c => ({
                    type: 'url_citation',
                    url: c.url,
                    title: c.title,
                  })),
                }],
              }]
            : [],
        },
      };
    } catch {
      yield { type: 'response.completed', response: { output: [] } };
    }
  }
}

// ── Exports (same interface as before) ──────────────────────────────────────

let _compat: GeminiCompat | null = null;

export function getGemini(): GeminiCompat {
  if (_compat) return _compat;
  _compat = new GeminiCompat({ apiKey: config.gemini.apiKey });
  return _compat;
}

export { GeminiCompat };

export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!text || !text.trim()) return null;
  const client = getGemini();
  const response = await client.embeddings.create({
    model: config.gemini.embeddingModel,
    input: text.substring(0, config.gemini.maxEmbeddingChars),
  });
  return response.data[0].embedding;
}

export function getEmbeddingText(entity: Record<string, unknown>, type: 'thread' | 'node'): string {
  if (type === 'thread') {
    return [entity.title, entity.description, entity.content]
      .filter(Boolean)
      .join('\n')
      .substring(0, config.gemini.maxEmbeddingChars);
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
    .substring(0, config.gemini.maxEmbeddingChars);
}
