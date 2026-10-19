import type { Memory } from '../types';
import { estimateTokens } from './text';
import type { MemoryStore } from './store';

export interface MemoryContext {
  /** Stable "About Me" core facts; cached in the system prompt. */
  core: string;
  /** Per-turn relevant memories. */
  relevant: string;
  usedIds: string[];
  tokens: number;
}

export interface RetrievalInput {
  query: string;
  /** Recent conversation text, to bias toward the current thread. */
  recentText?: string;
  budgetTokens?: number;
  now?: Date;
}

const CORE_SHARE = 0.4;

function line(m: Memory): string {
  const who = m.category === 'People' && m.personName ? `${m.personName}: ` : '';
  return `- [${m.category}] ${who}${m.content}`;
}

/**
 * Rank: relevance first, then importance, then recency. Relevance is bucketed
 * so near-equal matches fall through to importance.
 */
export function rankMemories(items: { memory: Memory; relevance: number }[]): Memory[] {
  return [...items]
    .sort((a, b) => {
      const ra = Math.round(a.relevance * 5);
      const rb = Math.round(b.relevance * 5);
      if (ra !== rb) return rb - ra;
      if (a.memory.importance !== b.memory.importance) return b.memory.importance - a.memory.importance;
      return (b.memory.lastUsedAt ?? b.memory.updatedAt).localeCompare(a.memory.lastUsedAt ?? a.memory.updatedAt);
    })
    .map((x) => x.memory);
}

export async function buildMemoryContext(store: MemoryStore, input: RetrievalInput): Promise<MemoryContext> {
  const budget = input.budgetTokens ?? 1500;
  const used = new Set<string>();

  // Core About Me facts and the patterns learned over time, most important first, within ~40% of the budget.
  const about = [...(await store.list('About Me')), ...(await store.list('Patterns'))].sort((a, b) => b.importance - a.importance || a.createdAt.localeCompare(b.createdAt));
  const coreLines: string[] = [];
  let tokens = 0;
  for (const m of about) {
    const l = line(m);
    const t = estimateTokens(l);
    if (tokens + t > budget * CORE_SHARE) break;
    coreLines.push(l);
    used.add(m.id);
    tokens += t;
  }

  // Relevant memories from the question (weighted) and recent context.
  const byId = new Map<string, { memory: Memory; relevance: number }>();
  const add = (rows: { memory: Memory; relevance: number }[], weight: number) => {
    for (const r of rows) {
      if (used.has(r.memory.id)) continue;
      const prev = byId.get(r.memory.id);
      const rel = r.relevance * weight;
      if (!prev || prev.relevance < rel) byId.set(r.memory.id, { memory: r.memory, relevance: rel });
    }
  };
  add(await store.search(input.query, { limit: 25 }), 1);
  if (input.recentText) add(await store.search(input.recentText, { limit: 15 }), 0.6);

  // People mentioned by name or alias get their entry even if FTS missed it.
  for (const name of mentionedNames(input.query)) {
    const p = await store.findPerson(name);
    if (p && !used.has(p.id)) byId.set(p.id, { memory: p, relevance: 1 });
  }

  const relevantLines: string[] = [];
  for (const m of rankMemories([...byId.values()])) {
    const l = line(m);
    const t = estimateTokens(l);
    if (tokens + t > budget) continue;
    relevantLines.push(l);
    used.add(m.id);
    tokens += t;
  }

  const usedIds = [...used];
  await store.markUsed(usedIds, input.now);
  return { core: coreLines.join('\n'), relevant: relevantLines.join('\n'), usedIds, tokens };
}

/** Capitalized words and "my <relation>" phrases, as candidate person references. */
export function mentionedNames(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\bmy\s+(wife|husband|partner|mom|mother|dad|father|son|daughter|kids?|boss|sister|brother|friend|girlfriend|boyfriend|dentist|doctor)\b/gi)) {
    out.add(`my ${m[1].toLowerCase()}`);
  }
  for (const m of text.matchAll(/\b([A-Z][a-z]{2,})\b/g)) {
    if (!COMMON_CAPS.has(m[1])) out.add(m[1]);
  }
  return [...out];
}

const COMMON_CAPS = new Set(
  'The What When Where Who Why How Can Could Would Should Did Does Do Is Are Was Were Will Tell Show Find Remind Text Call Email Send Today Tomorrow Yesterday Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Optimus Please Thanks Hey Hi Hello Also And But Any Remember Forget Set Make Read Check'.split(
    ' ',
  ),
);
