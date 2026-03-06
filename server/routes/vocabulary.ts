import { Router } from 'express';
import { getNeo4j, toNum } from '../db/driver.js';
import { requireAuth } from '../middleware/auth.js';
import { withSession } from '../middleware/session.js';
import { aiTimeout } from '../middleware/aiTimeout.js';
import { getOpenAI } from '../services/openai.js';

const router = Router();

// ── SM-2 algorithm ───────────────────────────────────────────────────────────
function sm2(quality: number, repetitions: number, easiness: number, interval: number) {
  let newEF = easiness + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (newEF < 1.3) newEF = 1.3;
  if (quality < 3) return { easiness: newEF, interval: 1, repetitions: 0 };
  const newReps = repetitions + 1;
  const newInterval = newReps === 1 ? 1 : newReps === 2 ? 6 : Math.round(interval * newEF);
  return { easiness: newEF, interval: newInterval, repetitions: newReps };
}

// ── Look up a word/phrase definition ─────────────────────────────────────────
router.post('/lookup', requireAuth, aiTimeout, async (req, res) => {
  const { word, context } = req.body;
  if (!word?.trim()) return res.status(400).json({ error: 'word is required' });

  const openai = getOpenAI();
  const contextHint = context ? `\nThe word/phrase appears in this context: "${context}"` : '';

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a dictionary and vocabulary assistant. Given a word or phrase, provide a clear, concise definition.
Return JSON with this exact structure:
{
  "word": "<the word/phrase as given>",
  "definition": "<clear, concise definition>",
  "partOfSpeech": "<noun/verb/adjective/etc or 'phrase' for multi-word>",
  "pronunciation": "<IPA pronunciation if applicable, empty string for phrases>",
  "example": "<a good example sentence using the word>",
  "etymology": "<brief etymology or origin, 1 sentence max>"
}`,
      },
      {
        role: 'user',
        content: `Define: "${word.trim()}"${contextHint}`,
      },
    ],
  });

  const result = JSON.parse(completion.choices[0].message.content!);
  res.json(result);
});

// ── Save a word to vocabulary (auto-creates SRS card) ────────────────────────
router.post('/words', requireAuth, withSession(async (req, res) => {
  const { word, definition, partOfSpeech, pronunciation, example, etymology, context } = req.body;
  if (!word?.trim() || !definition?.trim()) {
    return res.status(400).json({ error: 'word and definition are required' });
  }

  const session = req.neo4jSession!;
  const userId = (req.user as { id: number }).id;
  const now = new Date().toISOString().split('T')[0];

  // Check if word already exists for this user
  const existing = await session.run(
    `MATCH (v:VocabWord {word_lower: $wordLower, created_by: $userId}) RETURN v`,
    { wordLower: word.trim().toLowerCase(), userId: getNeo4j().int(userId) }
  );

  if (existing.records.length > 0) {
    const props = existing.records[0].get('v').properties;
    return res.json({
      id: toNum(props.id),
      word: props.word,
      definition: props.definition,
      alreadyExists: true,
    });
  }

  // Get next ID
  const idResult = await session.run(
    `MATCH (v:VocabWord) RETURN COALESCE(MAX(v.id), 0) + 1 AS nextId`
  );
  const nextId = toNum(idResult.records[0].get('nextId')) || 1;

  await session.run(
    `CREATE (v:VocabWord {
      id: $id,
      word: $word,
      word_lower: $wordLower,
      definition: $definition,
      part_of_speech: $partOfSpeech,
      pronunciation: $pronunciation,
      example_sentence: $example,
      etymology: $etymology,
      context: $context,
      created_by: $userId,
      created_at: $now,
      review_easiness: 2.5,
      review_interval: 0,
      review_repetitions: 0,
      review_due_date: $now,
      review_last_date: null,
      review_quality: null
    })`,
    {
      id: getNeo4j().int(nextId),
      word: word.trim(),
      wordLower: word.trim().toLowerCase(),
      definition: definition.trim(),
      partOfSpeech: partOfSpeech || '',
      pronunciation: pronunciation || '',
      example: example || '',
      etymology: etymology || '',
      context: context || '',
      userId: getNeo4j().int(userId),
      now,
    }
  );

  res.json({ id: nextId, word: word.trim(), definition: definition.trim(), created: true });
}));

// ── Get all vocabulary words for the current user ────────────────────────────
router.get('/words', requireAuth, withSession(async (req, res) => {
  const session = req.neo4jSession!;
  const userId = (req.user as { id: number }).id;

  const result = await session.run(
    `MATCH (v:VocabWord {created_by: $userId})
     RETURN v ORDER BY v.created_at DESC`,
    { userId: getNeo4j().int(userId) }
  );

  const words = result.records.map(r => {
    const p = r.get('v').properties;
    return {
      id: toNum(p.id),
      word: p.word,
      definition: p.definition,
      partOfSpeech: p.part_of_speech || '',
      pronunciation: p.pronunciation || '',
      exampleSentence: p.example_sentence || '',
      etymology: p.etymology || '',
      context: p.context || '',
      createdAt: p.created_at,
      reviewDueDate: p.review_due_date,
      reviewInterval: toNum(p.review_interval) || 0,
      reviewEasiness: p.review_easiness || 2.5,
      reviewRepetitions: toNum(p.review_repetitions) || 0,
    };
  });

  res.json(words);
}));

// ── Delete a vocabulary word ─────────────────────────────────────────────────
router.delete('/words/:id', requireAuth, withSession(async (req, res) => {
  const session = req.neo4jSession!;
  const userId = (req.user as { id: number }).id;
  const wordId = parseInt(req.params.id);

  await session.run(
    `MATCH (v:VocabWord {id: $id, created_by: $userId}) DELETE v`,
    { id: getNeo4j().int(wordId), userId: getNeo4j().int(userId) }
  );

  res.json({ ok: true });
}));

// ── Get words due for review ─────────────────────────────────────────────────
router.get('/due', requireAuth, withSession(async (req, res) => {
  const session = req.neo4jSession!;
  const userId = (req.user as { id: number }).id;
  const today = new Date().toISOString().split('T')[0];

  const result = await session.run(
    `MATCH (v:VocabWord {created_by: $userId})
     WHERE v.review_due_date IS NOT NULL AND v.review_due_date <= $today
     RETURN v ORDER BY v.review_due_date ASC`,
    { userId: getNeo4j().int(userId), today }
  );

  const words = result.records.map(r => {
    const p = r.get('v').properties;
    return {
      id: toNum(p.id),
      word: p.word,
      definition: p.definition,
      partOfSpeech: p.part_of_speech || '',
      pronunciation: p.pronunciation || '',
      exampleSentence: p.example_sentence || '',
      etymology: p.etymology || '',
      context: p.context || '',
      createdAt: p.created_at,
      reviewDueDate: p.review_due_date,
      reviewInterval: toNum(p.review_interval) || 0,
      reviewRepetitions: toNum(p.review_repetitions) || 0,
    };
  });

  res.json(words);
}));

// ── Submit a review for a vocabulary word ────────────────────────────────────
router.post('/review', requireAuth, withSession(async (req, res) => {
  const { wordId, quality } = req.body;
  if (quality < 0 || quality > 5) return res.status(400).json({ error: 'Quality must be 0-5' });

  const session = req.neo4jSession!;
  const userId = (req.user as { id: number }).id;

  const wordResult = await session.run(
    'MATCH (v:VocabWord {id: $id, created_by: $userId}) RETURN v',
    { id: getNeo4j().int(parseInt(wordId)), userId: getNeo4j().int(userId) }
  );
  if (!wordResult.records.length) return res.status(404).json({ error: 'Word not found' });
  const props = wordResult.records[0].get('v').properties;

  const result = sm2(
    quality,
    props.review_repetitions ? toNum(props.review_repetitions)! : 0,
    props.review_easiness || 2.5,
    props.review_interval ? toNum(props.review_interval)! : 0
  );

  const today = new Date();
  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + result.interval);

  await session.run(
    `MATCH (v:VocabWord {id: $id, created_by: $userId})
     SET v.review_easiness = $easiness, v.review_interval = $interval,
         v.review_repetitions = $reps, v.review_due_date = $due,
         v.review_last_date = $last, v.review_quality = $quality`,
    {
      id: getNeo4j().int(parseInt(wordId)),
      userId: getNeo4j().int(userId),
      easiness: result.easiness,
      interval: getNeo4j().int(result.interval),
      reps: getNeo4j().int(result.repetitions),
      due: dueDate.toISOString().split('T')[0],
      last: today.toISOString().split('T')[0],
      quality: getNeo4j().int(quality),
    }
  );

  res.json({ ...result, dueDate: dueDate.toISOString().split('T')[0] });
}));

// ── Get review stats ─────────────────────────────────────────────────────────
router.get('/stats', requireAuth, withSession(async (req, res) => {
  const session = req.neo4jSession!;
  const userId = (req.user as { id: number }).id;
  const today = new Date().toISOString().split('T')[0];

  const result = await session.run(
    `MATCH (v:VocabWord {created_by: $userId})
     WITH count(v) AS total,
          count(CASE WHEN v.review_due_date <= $today AND v.review_due_date IS NOT NULL THEN 1 END) AS due,
          count(CASE WHEN v.review_repetitions >= 5 THEN 1 END) AS mastered,
          count(CASE WHEN v.review_last_date IS NOT NULL THEN 1 END) AS reviewed
     RETURN total, due, mastered, reviewed`,
    { userId: getNeo4j().int(userId), today }
  );

  const r = result.records[0];
  res.json({
    total: toNum(r.get('total')),
    due: toNum(r.get('due')),
    mastered: toNum(r.get('mastered')),
    reviewed: toNum(r.get('reviewed')),
  });
}));

export default router;
