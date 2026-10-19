import { refreshInsights, takeUnnotified, type Insight } from '../core/insights/insights';
import { knowledgeDigest } from '../core/memory/consolidate';
import { notifyInsight } from './notify';
import type { Runtime } from './runtime';

let inFlight: Promise<Insight[]> | null = null;

/**
 * Refreshes proactive suggestions (at most every couple of hours) and, from
 * the background, notifies up to two urgent ones the user hasn't seen.
 */
export function ensureInsights(rt: Runtime, opts: { notify?: boolean; force?: boolean } = {}): Promise<Insight[]> {
  inFlight ??= (async () => {
    try {
      const about = await knowledgeDigest(rt.engine.memory, rt.engine.episodes).catch(() => '');
      const items = await refreshInsights({ db: rt.db, sources: rt.sources(), llm: rt.background(), aboutUser: about || undefined, force: opts.force });
      if (opts.notify) for (const i of await takeUnnotified(rt.db)) await notifyInsight(i).catch(() => undefined);
      return items;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
