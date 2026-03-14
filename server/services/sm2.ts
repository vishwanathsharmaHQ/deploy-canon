/**
 * SM-2 spaced repetition algorithm.
 * Used by both review.ts (node review) and vocabulary.ts (word review).
 */

export interface SM2Result {
  easiness: number;
  interval: number;
  repetitions: number;
}

export function sm2(quality: number, repetitions: number, easiness: number, interval: number): SM2Result {
  let newEF = easiness + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (newEF < 1.3) newEF = 1.3;
  if (quality < 3) return { easiness: newEF, interval: 1, repetitions: 0 };
  const newReps = repetitions + 1;
  const newInterval = newReps === 1 ? 1 : newReps === 2 ? 6 : Math.round(interval * newEF);
  return { easiness: newEF, interval: newInterval, repetitions: newReps };
}

/**
 * Calculate the due date from today + interval days.
 * Returns ISO date string (YYYY-MM-DD).
 */
export function calculateDueDate(intervalDays: number): string {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + intervalDays);
  return dueDate.toISOString().split('T')[0];
}

/**
 * Get today's date as ISO string (YYYY-MM-DD).
 */
export function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}
