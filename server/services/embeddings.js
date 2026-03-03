const config = require('../config');
const { getDriver, getNeo4j } = require('../db/driver');
const { generateEmbedding, getEmbeddingText } = require('./openai');

let _indexesEnsured = false;

async function ensureVectorIndexes() {
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
  } catch (err) {
    console.warn('Vector index auto-setup failed (non-fatal):', err.message);
  } finally {
    await session.close();
  }
}

async function backfillEmbeddings() {
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
      } catch (e) { /* skip */ }
    }

    const nodeResult = await session.run(
      `MATCH (n:Node) WHERE n.embedding IS NULL RETURN n LIMIT ${config.limits.backfillNodes}`
    );
    for (const record of nodeResult.records) {
      const props = record.get('n').properties;
      const text = getEmbeddingText({ title: props.title, content: props.content, node_type: props.node_type }, 'node');
      if (!text.trim()) continue;
      try {
        const embedding = await generateEmbedding(text);
        if (embedding) {
          await session.run(
            `MATCH (n:Node {id: $id}) SET n.embedding = $embedding, n.embedding_text = $text`,
            { id: props.id, embedding, text }
          );
        }
      } catch (e) { /* skip */ }
    }
  } catch (err) {
    console.warn('Embedding backfill failed (non-fatal):', err.message);
  } finally {
    await session.close();
  }
}

module.exports = { ensureVectorIndexes, backfillEmbeddings };
