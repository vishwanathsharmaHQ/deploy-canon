import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { toNum } from '../db/driver.js';
import { requireAuth } from '../middleware/auth.js';
import { withSession } from '../middleware/session.js';

const router = Router();

// POST /register - disabled (registration closed)
router.post('/register', (_req, res) => {
  res.status(403).json({ error: 'Registration is currently disabled' });
});

// POST /login - authenticate an existing user
router.post(
  '/login',
  withSession(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const session = req.neo4jSession!;

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

export default router;
