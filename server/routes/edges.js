const router = require('express').Router();
const { getNeo4j } = require('../db/driver');
const { requireAuth } = require('../middleware/auth');
const { withSession } = require('../middleware/session');

router.post('/', requireAuth, withSession(async (req, res) => {
  const { sourceId, targetId } = req.body;
  const session = req.neo4jSession;
  await session.run(
    `MATCH (a:Node {id: $src}), (b:Node {id: $tgt})
     CREATE (a)-[:PARENT_OF]->(b)`,
    { src: getNeo4j().int(sourceId), tgt: getNeo4j().int(targetId) }
  );
  res.json({ source_id: sourceId, target_id: targetId, relationship_type: 'parent-child' });
}));

module.exports = router;
