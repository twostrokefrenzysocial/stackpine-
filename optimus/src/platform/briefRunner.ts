import { BriefStore, briefDue, generateBrief } from '../core/brief/brief';
import type { DailyBrief } from '../core/types';
import { isoDay } from '../core/util/time';
import { notifyBriefReady } from './notify';
import type { Runtime } from './runtime';

let inFlight: Promise<DailyBrief | null> | null = null;

/**
 * Generates today's brief if it's past the chosen time and none exists.
 * Called by the background task and, as the Samsung-proof fallback, every
 * time the app opens.
 */
export function ensureTodaysBrief(rt: Runtime, opts: { notify?: boolean; force?: boolean } = {}): Promise<DailyBrief | null> {
  inFlight ??= (async () => {
    try {
      if (!rt.settings.briefEnabled && !opts.force) return null;
      const store = new BriefStore(rt.db);
      const now = new Date();
      const existing = await store.forDate(isoDay(now));
      if (!opts.force && !briefDue(rt.settings.briefTime, now, existing)) return existing;
      const brief = await generateBrief({
        sources: rt.sources(),
        episodes: rt.engine.episodes,
        reminders: rt.engine.reminders,
        llm: rt.isDemoBrain() ? undefined : rt.background(),
        now,
      });
      await store.save(brief);
      await rt.engine.activity.add({ kind: 'system', summary: `Daily brief generated${opts.notify ? ' in the background' : ' on open'}`, detail: brief.unavailable.length ? `Couldn't see: ${brief.unavailable.join(', ')}` : undefined });
      if (opts.notify) await notifyBriefReady(brief.headline);
      return brief;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
