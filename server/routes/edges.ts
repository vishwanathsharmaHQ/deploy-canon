import { Router } from 'express';
import { getNeo4j } from '../db/driver.js';
import { requireAuth } from '../middleware/auth.js';
import { withSession } from '../middleware/session.js';

const router = Router();

router.post('/', requireAuth, withSession(async (req, res) => {
  const { sourceId, targetId } = req.body;
  const session = req.neo4jSession!;
  await session.run(
    `MATCH (a:Node {id: $src}), (b:Node {id: $tgt})
     CREATE (a)-[:PARENT_OF]->(b)`,
    { src: getNeo4j().int(sourceId), tgt: getNeo4j().int(targetId) }
  );
  res.json({ source_id: sourceId, target_id: targetId, relationship_type: 'parent-child' });
}));

export default router;
