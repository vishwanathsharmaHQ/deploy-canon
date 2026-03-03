const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { getNeo4j, toNum } = require('../db/driver');
const { getNextId } = require('../db/queries');
const { requireAuth } = require('../middleware/auth');
const { withSession } = require('../middleware/session');

const router = express.Router();

// POST /register - create a new user account
router.post(
  '/register',
  withSession(async (req, res) => {
    const { name, email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const session = req.neo4jSession;

    const existing = await session.run(
      'MATCH (u:User {email: $email}) RETURN u',
      { email }
    );
    if (existing.records.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 10);
    const id = await getNextId('user', session);
    const now = new Date().toISOString();

    await session.run(
      'CREATE (u:User {id: $id, name: $name, email: $email, password: $hash, created_at: $now})',
      { id: getNeo4j().int(id), name: name || '', email, hash, now }
    );

    const token = jwt.sign(
      { id, email, name: name || '' },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.json({ token, user: { id, email, name: name || '' } });
  })
);

// POST /login - authenticate an existing user
router.post(
  '/login',
  withSession(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const session = req.neo4jSession;

    const result = await session.run(
      'MATCH (u:User {email: $email}) RETURN u',
      { email }
    );
    if (!result.records.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const u = result.records[0].get('u').properties;
    const valid = await bcrypt.compare(password, u.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const id = toNum(u.id);
    const token = jwt.sign(
      { id, email: u.email, name: u.name || '' },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.json({ token, user: { id, email: u.email, name: u.name || '' } });
  })
);

// GET /me - return the authenticated user's info
router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

module.exports = router;
