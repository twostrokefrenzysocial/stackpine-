import type { Db } from '../db/types';
import { kvGet, kvSet } from '../settings/settings';
import { DAY } from '../util/time';

/**
 * How much Optimus has learned, as one number the brain can show. It grows
 * with what compounds over time: memories and the people in them, patterns
 * derived from them, past conversations it can draw on, photos it has
 * described, actions it has carried out, and days spent with the user.
 * Diminishing returns keep it meaningful: early learning moves it fast, a
 * mature brain still thickens but slowly.
 */

export interface Growth {
  memories: number;
  people: number;
  patterns: number;
  episodes: number;
  photosIndexed: number;
  actions: number;
  daysKnown: number;
  /** 0..1 */
  level: number;
  stage: GrowthStage;
}

export type GrowthStage = 'Forming' | 'Learning you' | 'Knows you' | 'Fluent' | 'Deep';

export const STAGES: { min: number; stage: GrowthStage }[] = [
  { min: 0.85, stage: 'Deep' },
  { min: 0.6, stage: 'Fluent' },
  { min: 0.35, stage: 'Knows you' },
  { min: 0.12, stage: 'Learning you' },
  { min: 0, stage: 'Forming' },
];

const FIRST_SEEN = 'growth.firstSeen';

export function growthLevel(g: Omit<Growth, 'level' | 'stage'>): number {
  const points = g.memories * 2 + g.people * 3 + g.patterns * 8 + g.episodes * 1.5 + g.actions * 2 + Math.min(g.photosIndexed, 5000) / 40 + Math.min(g.daysKnown, 365) * 0.8;
  return Math.round((1 - Math.exp(-points / 500)) * 1000) / 1000;
}

export function stageFor(level: number): GrowthStage {
  return STAGES.find((s) => level >= s.min)?.stage ?? 'Forming';
}

export async function measureGrowth(db: Db, now = new Date()): Promise<Growth> {
  const count = async (sql: string) => (await db.get<{ n: number }>(sql).catch(() => null))?.n ?? 0;
  const [memories, people, patterns, episodes, photosIndexed, actions] = await Promise.all([
    count('SELECT COUNT(*) AS n FROM memories'),
    count(`SELECT COUNT(*) AS n FROM memories WHERE category = 'People'`),
    count(`SELECT COUNT(*) AS n FROM memories WHERE category = 'Patterns'`),
    count('SELECT COUNT(*) AS n FROM episodes'),
    count('SELECT COUNT(*) AS n FROM photo_index'),
    count(`SELECT COUNT(*) AS n FROM activity WHERE kind = 'action'`),
  ]);
  let first = await kvGet(db, FIRST_SEEN);
  if (!first) {
    first = now.toISOString();
    await kvSet(db, FIRST_SEEN, first);
  }
  const daysKnown = Math.max(0, Math.floor((now.getTime() - Date.parse(first)) / DAY));
  const base = { memories, people, patterns, episodes, photosIndexed, actions, daysKnown };
  const level = growthLevel(base);
  return { ...base, level, stage: stageFor(level) };
}
