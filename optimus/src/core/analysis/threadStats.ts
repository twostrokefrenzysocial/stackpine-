import type { SmsMessage } from '../types';
import { DAY, HOUR } from '../util/time';

/**
 * Numbers about a whole text thread, computed on the phone so the model can
 * evaluate a relationship or a working pattern over months or years without
 * reading every message. Every message is counted; a spread of weeks is then
 * sampled for the model to read for tone. Nothing here leaves the phone except
 * what the tool returns.
 */

export interface PersonStats {
  messages: number;
  questions: number;
  avgChars: number;
  /** Conversations this person opened (first message after a quiet gap). */
  initiated: number;
  /** Median minutes to answer the other person, when they answered within a day. */
  medianReplyMinutes: number | null;
  /** Messages of 1-3 words that are only an acknowledgement ("ok", "sure", "k"). */
  flatReplies: number;
  phrases: Record<string, number>;
  /** Share of this person's messages sent between 10pm and 6am. */
  lateNightShare: number;
}

export interface MonthStats {
  month: string; // YYYY-MM
  me: number;
  them: number;
  /** Warm-phrase mentions per 100 messages. */
  warmthPer100: number;
}

export interface ThreadStats {
  contact: string;
  range: { from: string; to: string; days: number };
  total: number;
  kinds: Record<string, number>;
  me: PersonStats;
  them: PersonStats;
  months: MonthStats[];
  /** Longest stretch with no messages either way. */
  longestSilence: { days: number; from: string; to: string } | null;
  /** How many conversations (runs separated by quiet gaps). */
  conversations: number;
}

export const PHRASES: Record<string, RegExp> = {
  love_you: /\b(i )?love (you|u|ya)\b|\blove you\b|❤️|😘|🥰/i,
  miss_you: /\bmiss (you|u)\b/i,
  sorry: /\b(sorry|apologi[sz]e|my bad|my fault)\b/i,
  thanks: /\b(thanks?|thank you|thx|ty|appreciate)\b/i,
  pet_names: /\b(babe|baby|honey|hon|sweetheart|sweetie|love|darling|dear|my love|beautiful|handsome)\b/i,
  laughter: /\b(lol|lmao|haha+|hehe)\b|😂|🤣/i,
  stress: /\b(stressed|exhausted|overwhelmed|tired|frustrated|annoyed|upset|angry|mad|sick of)\b/i,
  plans_logistics: /\b(pick ?up|drop ?off|appointment|appt|schedule|dinner|grocer|school|practice|dentist|doctor|bill|rent|errand)\b/i,
  affection_check_in: /\b(how (are|r) (you|u)|how's your day|thinking of you|proud of you|you okay|you ok)\b/i,
};

const WARM = ['love_you', 'miss_you', 'pet_names', 'thanks', 'affection_check_in', 'laughter'];
const FLAT = /^(ok(ay)?|k|kk|sure|fine|yep|yup|yes|no|nope|alright|got it|sounds good|np|whatever)[.!]?$/i;
const GAP_MS = 4 * HOUR;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

function person(msgs: SmsMessage[], mine: boolean, all: SmsMessage[]): PersonStats {
  const own = msgs.filter((m) => (m.direction === 'outgoing') === mine);
  const phrases: Record<string, number> = {};
  for (const [k, re] of Object.entries(PHRASES)) phrases[k] = own.filter((m) => re.test(m.body)).length;
  const replies: number[] = [];
  let initiated = 0;
  let prev: SmsMessage | null = null;
  for (const m of all) {
    const isMine = m.direction === 'outgoing';
    const t = Date.parse(m.date);
    if (isMine === mine) {
      if (!prev || t - Date.parse(prev.date) > GAP_MS) initiated++;
      else if ((prev.direction === 'outgoing') !== mine) {
        const mins = (t - Date.parse(prev.date)) / 60_000;
        if (mins <= 24 * 60) replies.push(mins);
      }
    }
    prev = m;
  }
  const late = own.filter((m) => {
    const h = new Date(m.date).getHours();
    return h >= 22 || h < 6;
  }).length;
  return {
    messages: own.length,
    questions: own.filter((m) => m.body.includes('?')).length,
    avgChars: own.length ? Math.round(own.reduce((s, m) => s + m.body.length, 0) / own.length) : 0,
    initiated,
    medianReplyMinutes: median(replies) == null ? null : Math.round(median(replies)!),
    flatReplies: own.filter((m) => FLAT.test(m.body.trim())).length,
    phrases,
    lateNightShare: own.length ? Math.round((late / own.length) * 100) / 100 : 0,
  };
}

/** Counts everything in the thread. `messages` may be in any order. */
export function analyzeThread(contact: string, messages: SmsMessage[]): ThreadStats | null {
  const all = [...messages].sort((a, b) => a.date.localeCompare(b.date));
  if (!all.length) return null;
  const first = all[0].date;
  const last = all[all.length - 1].date;
  const kinds: Record<string, number> = {};
  for (const m of all) kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;

  const byMonth = new Map<string, SmsMessage[]>();
  for (const m of all) {
    const k = m.date.slice(0, 7);
    byMonth.set(k, [...(byMonth.get(k) ?? []), m]);
  }
  const months: MonthStats[] = [...byMonth.entries()].map(([month, ms]) => {
    const warm = ms.filter((m) => WARM.some((k) => PHRASES[k].test(m.body))).length;
    return { month, me: ms.filter((m) => m.direction === 'outgoing').length, them: ms.filter((m) => m.direction === 'incoming').length, warmthPer100: Math.round((warm / ms.length) * 100) };
  });

  let longest: ThreadStats['longestSilence'] = null;
  let conversations = 1;
  for (let i = 1; i < all.length; i++) {
    const gap = Date.parse(all[i].date) - Date.parse(all[i - 1].date);
    if (gap > GAP_MS) conversations++;
    if (!longest || gap > longest.days * DAY) longest = { days: Math.round((gap / DAY) * 10) / 10, from: all[i - 1].date, to: all[i].date };
  }
  if (longest && longest.days < 1) longest = null;

  return {
    contact,
    range: { from: first, to: last, days: Math.max(1, Math.round((Date.parse(last) - Date.parse(first)) / DAY)) },
    total: all.length,
    kinds,
    me: person(all, true, all),
    them: person(all, false, all),
    months,
    longestSilence: longest,
    conversations,
  };
}

export interface SampledWeek {
  week: string; // start date YYYY-MM-DD
  lines: string[];
}

/**
 * Picks whole weeks spread evenly across the range (always including the
 * first and the last) so the model reads tone over time, not just lately.
 * Each line: "YYYY-MM-DD HH:MM me|them: text".
 */
export function sampleWeeks(messages: SmsMessage[], opts: { weeks?: number; maxMessages?: number; maxChars?: number; them?: string } = {}): SampledWeek[] {
  const all = [...messages].sort((a, b) => a.date.localeCompare(b.date));
  if (!all.length) return [];
  const weekOf = (iso: string) => {
    const d = new Date(iso);
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay()));
    return day.toISOString().slice(0, 10);
  };
  const byWeek = new Map<string, SmsMessage[]>();
  for (const m of all) {
    const k = weekOf(m.date);
    byWeek.set(k, [...(byWeek.get(k) ?? []), m]);
  }
  const weeks = [...byWeek.keys()];
  const want = Math.min(opts.weeks ?? 20, weeks.length);
  const picked = new Set<string>();
  for (let i = 0; i < want; i++) picked.add(weeks[Math.round((i * (weeks.length - 1)) / Math.max(1, want - 1))]);
  const maxMessages = opts.maxMessages ?? 600;
  const perWeek = Math.max(8, Math.floor(maxMessages / picked.size));
  const maxChars = opts.maxChars ?? 200;
  const them = opts.them ?? 'them';
  const out: SampledWeek[] = [];
  for (const w of weeks) {
    if (!picked.has(w)) continue;
    const ms = byWeek.get(w)!;
    // Keep a contiguous slice from the middle of busy weeks so exchanges read in order.
    const start = Math.max(0, Math.floor((ms.length - perWeek) / 2));
    const slice = ms.slice(start, start + perWeek);
    out.push({
      week: w,
      lines: slice.map((m) => {
        const d = new Date(m.date);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const text = m.body.replace(/\s+/g, ' ').trim();
        return `${m.date.slice(0, 10)} ${hh}:${mm} ${m.direction === 'outgoing' ? 'me' : them}: ${text.length > maxChars ? `${text.slice(0, maxChars)}…` : text}`;
      }),
    });
  }
  return out;
}
