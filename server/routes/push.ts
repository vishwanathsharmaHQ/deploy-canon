import { Router } from 'express';
import webpush from 'web-push';
import config from '../config.js';
import { getNeo4j, toNum } from '../db/driver.js';
import { requireAuth } from '../middleware/auth.js';
import { withSession } from '../middleware/session.js';

const router = Router();

// Configure web-push with VAPID keys
webpush.setVapidDetails(
  config.vapid.email,
  config.vapid.publicKey,
  config.vapid.privateKey
);

// GET /vapid-key — public key for the frontend to subscribe
router.get('/vapid-key', (_req, res) => {
  res.json({ publicKey: config.vapid.publicKey });
});

// POST /subscribe — save a push subscription for the authenticated user
router.post('/subscribe', requireAuth, withSession(async (req, res) => {
  const userId = (req as any).user.id;
  const { subscription } = req.body;
  if (!subscription?.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }

  const session = req.neo4jSession!;
  const subJson = JSON.stringify(subscription);

  // Upsert: one subscription per endpoint per user
  await session.run(
    `MATCH (u:User {id: $userId})
     MERGE (s:PushSubscription {endpoint: $endpoint})
     SET s.subscription = $sub, s.updated_at = $now
     MERGE (u)-[:HAS_PUSH]->(s)`,
    {
      userId: getNeo4j().int(userId),
      endpoint: subscription.endpoint,
      sub: subJson,
      now: new Date().toISOString(),
    }
  );

  res.json({ success: true });
}));

// DELETE /subscribe — remove a push subscription
router.delete('/subscribe', requireAuth, withSession(async (req, res) => {
  const userId = (req as any).user.id;
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });

  await req.neo4jSession!.run(
    `MATCH (u:User {id: $userId})-[:HAS_PUSH]->(s:PushSubscription {endpoint: $endpoint})
     DETACH DELETE s`,
    { userId: getNeo4j().int(userId), endpoint }
  );

  res.json({ success: true });
}));

// POST /send-test — send a test notification (for debugging)
router.post('/send-test', requireAuth, withSession(async (req, res) => {
  const userId = (req as any).user.id;
  const session = req.neo4jSession!;

  const result = await session.run(
    `MATCH (u:User {id: $userId})-[:HAS_PUSH]->(s:PushSubscription)
     RETURN s.subscription AS sub`,
    { userId: getNeo4j().int(userId) }
  );

  let sent = 0;
  for (const record of result.records) {
    const sub = JSON.parse(record.get('sub'));
    try {
      await webpush.sendNotification(sub, JSON.stringify({
        title: 'Canon Thread',
        body: 'Notifications are working!',
        url: '/',
      }));
      sent++;
    } catch (err: any) {
      if (err.statusCode === 410) {
        // Subscription expired — clean up
        await session.run(
          'MATCH (s:PushSubscription {endpoint: $endpoint}) DETACH DELETE s',
          { endpoint: sub.endpoint }
        );
      }
    }
  }

  res.json({ sent });
}));

// ── Vocab review reminder — called by cron or manual trigger ────────────────

export async function sendVocabReminders() {
  const { withSessionAsync } = await import('../middleware/session.js');

  await withSessionAsync(async (session) => {
    // Find users with due vocab words
    const now = new Date().toISOString();
    const result = await session.run(
      `MATCH (u:User)-[:CREATED]->(w:VocabWord)
       WHERE w.review_next_date <= $now
       WITH u, count(w) AS dueCount
       WHERE dueCount > 0
       MATCH (u)-[:HAS_PUSH]->(s:PushSubscription)
       RETURN u.id AS userId, u.name AS name, dueCount, collect(s.subscription) AS subs`,
      { now }
    );

    for (const record of result.records) {
      const dueCount = toNum(record.get('dueCount'));
      const name = record.get('name') || '';
      const subs = record.get('subs') as string[];

      const payload = JSON.stringify({
        title: 'Vocab Review Time',
        body: `${name ? name + ', y' : 'Y'}ou have ${dueCount} word${dueCount !== 1 ? 's' : ''} due for review.`,
        url: '/?view=review',
      });

      for (const subStr of subs) {
        const sub = JSON.parse(subStr);
        try {
          await webpush.sendNotification(sub, payload);
        } catch (err: any) {
          if (err.statusCode === 410) {
            await session.run(
              'MATCH (s:PushSubscription {endpoint: $endpoint}) DETACH DELETE s',
              { endpoint: sub.endpoint }
            );
          }
        }
      }
    }
  });
}

// POST /check-reminders — manual trigger for vocab reminders
router.post('/check-reminders', requireAuth, async (_req, res) => {
  try {
    await sendVocabReminders();
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to send reminders:', err);
    res.status(500).json({ error: 'Failed to send reminders' });
  }
});

export default router;
