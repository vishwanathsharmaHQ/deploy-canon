const { getNeo4j, toNum } = require('./driver');

const NODE_TYPES = ['ROOT', 'EVIDENCE', 'REFERENCE', 'CONTEXT', 'EXAMPLE', 'COUNTERPOINT', 'SYNTHESIS'];

async function getNextId(label, runner) {
  const result = await runner.run(
    `MERGE (c:Counter {name: $label})
     ON CREATE SET c.seq = 1
     ON MATCH SET c.seq = c.seq + 1
     RETURN c.seq AS id`,
    { label }
  );
  return result.records[0].get('id').toNumber();
}

async function vectorQuery(session, indexName, k, embedding) {
  try {
    return await session.run(
      `CALL db.index.vector.queryNodes($indexName, $k, $embedding) YIELD node, score RETURN node, score ORDER BY score DESC`,
      { indexName, k: getNeo4j().int(k), embedding }
    );
  } catch (err) {
    if (
      err.message &&
      (err.message.includes('no such vector schema index') ||
        err.message.includes('There is no such index') ||
        err.message.includes('IndexNotFoundError')) ||
      err.code === 'Neo.ClientError.Procedure.ProcedureCallFailed'
    ) {
      return { records: [] };
    }
    throw err;
  }
}

function formatThread(props) {
  return {
    id: toNum(props.id),
    title: props.title,
    description: props.description,
    content: props.content,
    metadata: {
      title: props.title,
      description: props.description,
      ...(props.metadata ? JSON.parse(props.metadata) : {}),
    },
    created_at: props.created_at,
    updated_at: props.updated_at,
    nodes: [],
  };
}

function formatNode(props, parentId) {
  return {
    id: toNum(props.id),
    title: props.title,
    content: props.content,
    node_type: props.node_type,
    parent_id: toNum(parentId),
    metadata: {
      title: props.title,
      description: props.content ? String(props.content).substring(0, 100) : '',
      ...(props.metadata ? JSON.parse(props.metadata) : {}),
    },
    created_at: props.created_at,
    updated_at: props.updated_at,
    type: NODE_TYPES.indexOf(props.node_type),
  };
}

module.exports = { getNextId, vectorQuery, formatThread, formatNode, NODE_TYPES };
