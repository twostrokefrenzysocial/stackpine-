import { wrapUntrusted } from '../safety/untrusted';
import type { DataSources } from '../sources/types';
import { DAY, HOUR, formatTime } from '../util/time';

function quick<T>(p: Promise<T>, ms = 1500): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

/**
 * A short picture of the user's day for every turn: what's next on the
 * calendar, who has been in touch, missed calls, unread mail. It lets
 * Optimus notice things and connect dots without spending tool calls, and
 * makes answers like "anything I should know?" instant. Names and titles are
 * third-party data, so they go in an untrusted block. Every source is
 * optional and time-boxed so a slow one never delays the reply.
 */
export async function buildSituation(sources: DataSources, now: Date): Promise<string> {
  const [events, texts, calls, emails] = await Promise.all([
    quick(sources.calendar.list({ since: now.toISOString(), until: new Date(now.getTime() + DAY).toISOString() })),
    quick(sources.texts.recentThreads(8)),
    quick(sources.calls.list({ type: 'missed', since: new Date(now.getTime() - 12 * HOUR).toISOString(), limit: 5 })),
    quick(sources.email.search({ unreadOnly: true, since: new Date(now.getTime() - DAY).toISOString(), limit: 10 })),
  ]);
  const facts: Record<string, unknown> = {};
  if (events?.length) facts.next_24h = events.slice(0, 4).map((e) => `${formatTime(e.start)} ${e.title}${e.location ? ` @ ${e.location}` : ''}`);
  const since = now.getTime() - 6 * HOUR;
  const recent = (texts ?? []).filter((t) => t.direction === 'incoming' && Date.parse(t.date) >= since);
  if (recent.length) facts.texted_you_last_6h = recent.slice(0, 5).map((t) => t.contactName ?? t.address);
  if (calls?.length) facts.missed_calls_12h = calls.map((c) => c.contactName ?? c.number);
  if (emails?.length) facts.unread_email_24h = { count: emails.length, important_from: emails.filter((e) => e.important).slice(0, 3).map((e) => e.fromName ?? e.from) };
  if (!Object.keys(facts).length) return '';
  return `# Situation (a quick look at the phone; use tools for details)\n${wrapUntrusted('situation', facts)}`;
}
