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

  openai: {
    apiKey: process.env.OPENAI_API_KEY!,
    timeout: 50_000,
    chatModel: 'gpt-5.2',
    embeddingModel: 'text-embedding-3-small',
    embeddingDimensions: 1536,
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
