import 'dotenv/config';

const config = {
  server: {
    port: process.env.PORT || 3001,
    jsonLimit: '10mb',
    corsOrigins: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',')
      : undefined, // undefined = allow all in dev
  },

  jwt: {
    secret: process.env.JWT_SECRET!,
    expiresIn: '7d',
  },

  neo4j: {
    uri: process.env.NEO4J_URI!,
    username: process.env.NEO4J_USERNAME!,
    password: process.env.NEO4J_PASSWORD!,
    database: process.env.NEO4J_DATABASE,
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY!,
    timeout: 50_000,
    chatModel: 'gemini-2.5-flash',
    // Fallback cascade: best → cheapest. On 429 rate-limit, try the next model.
    modelCascade: [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
    ] as readonly string[],
    embeddingModel: 'text-embedding-004',
    embeddingDimensions: 768,
    maxEmbeddingChars: 8_000,
  },

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY!,
    privateKey: process.env.VAPID_PRIVATE_KEY!,
    email: process.env.VAPID_EMAIL || 'mailto:admin@canonthread.com',
  },

  limits: {
    backfillThreads: 20,
    backfillNodes: 50,
    searchDefault: 20,
    textTruncation: 100,
    batchNodeMax: 50,
  },
} as const;

export default config;
