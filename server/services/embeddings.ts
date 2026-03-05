import config from '../config.js';
import { getDriver, getNeo4j } from '../db/driver.js';
import { generateEmbedding, getEmbeddingText } from './openai.js';

let _indexesEnsured = false;

export async function ensureVectorIndexes(): Promise<void> {
  if (_indexesEnsured) return;
  const session = getDriver().session({ database: config.neo4j.database });
  try {
    await session.run(`
      CREATE VECTOR INDEX thread_embedding IF NOT EXISTS
      FOR (t:Thread) ON (t.embedding)
      OPTIONS {indexConfig: {
        \`vector.dimensions\`: ${config.openai.embeddingDimensions},
        \`vector.similarity_function\`: 'cosine'
      }}
    `);
    await session.run(`
      CREATE VECTOR INDEX node_embedding IF NOT EXISTS
      FOR (n:Node) ON (n.embedding)
      OPTIONS {indexConfig: {
        \`vector.dimensions\`: ${config.openai.embeddingDimensions},
        \`vector.similarity_function\`: 'cosine'
      }}
    `);
    _indexesEnsured = true;
    console.log('Vector indexes ensured.');
  } catch (err: unknown) {
    console.warn('Vector index auto-setup failed (non-fatal):', (err as Error).message);
  } finally {
    await session.close();
  }
}

export async function backfillEmbeddings(): Promise<void> {
  const session = getDriver().session({ database: config.neo4j.database });
  try {
    const threadResult = await session.run(
      `MATCH (t:Thread) WHERE t.embedding IS NULL RETURN t LIMIT ${config.limits.backfillThreads}`
    );
    for (const record of threadResult.records) {
      const props = record.get('t').properties;
      const text = getEmbeddingText({ title: props.title, description: props.description, content: props.content }, 'thread');
      if (!text.trim()) continue;
      try {
        const embedding = await generateEmbedding(text);
        if (embedding) {
          await session.run(
            `MATCH (t:Thread {id: $id}) SET t.embedding = $embedding, t.embedding_text = $text`,
            { id: props.id, embedding, text }
          );
        }
      } catch { /* skip */ }
    }

    const nodeResult = await session.run(
      `MATCH (n:Node) WHERE n.embedding IS NULL RETURN n LIMIT ${config.limits.backfillNodes}`
    );
    for (const record of nodeResult.records) {
      const props = record.get('n').properties;
      const text = getEmbeddingText({ title: props.title, content: props.content, entity_type: props.entity_type }, 'node');
      if (!text.trim()) continue;
      try {
        const embedding = await generateEmbedding(text);
        if (embedding) {
          await session.run(
            `MATCH (n:Node {id: $id}) SET n.embedding = $embedding, n.embedding_text = $text`,
            { id: props.id, embedding, text }
          );
        }
      } catch { /* skip */ }
    }
  } catch (err: unknown) {
    console.warn('Embedding backfill failed (non-fatal):', (err as Error).message);
  } finally {
    await session.close();
  }
}
