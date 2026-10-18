import { analyzeThread, sampleWeeks } from '../analysis/threadStats';
import type { SmsMessage } from '../types';

function msg(date: string, direction: 'incoming' | 'outgoing', body: string, i: number): SmsMessage {
  return { id: `m${i}`, threadId: 't', address: '+15551234567', contactName: 'Miriam Lattimer', body, date, direction, read: true, kind: 'sms' };
}

/** Two people texting every few days for a year: warm at first, flat later. */
function year(): SmsMessage[] {
  const out: SmsMessage[] = [];
  let i = 0;
  for (let day = 0; day < 365; day += 3) {
    const base = Date.UTC(2025, 9, 1, 14, 0) + day * 86_400_000;
    const warm = day < 180;
    out.push(msg(new Date(base).toISOString(), 'outgoing', warm ? 'Morning babe, how are you? Love you' : 'Can you pick up Liza at 4?', i++));
    out.push(msg(new Date(base + 20 * 60_000).toISOString(), 'incoming', warm ? 'Love you too! Thinking of you ❤️' : 'ok', i++));
    out.push(msg(new Date(base + 25 * 60_000).toISOString(), 'outgoing', warm ? 'Dinner tonight?' : 'thanks', i++));
  }
  return out;
}

describe('thread analysis', () => {
  it('counts every message per person and tracks warmth month by month', () => {
    const s = analyzeThread('Miriam', year())!;
    expect(s.total).toBe(366);
    expect(s.me.messages).toBe(244);
    expect(s.them.messages).toBe(122);
    expect(s.me.questions).toBeGreaterThan(100);
    expect(s.me.initiated).toBe(122);
    expect(s.them.initiated).toBe(0);
    expect(s.them.medianReplyMinutes).toBe(20);
    expect(s.them.flatReplies).toBeGreaterThan(50);
    expect(s.me.phrases.love_you).toBe(60);
    expect(s.them.phrases.love_you).toBe(60);
    expect(s.months.length).toBe(12);
    expect(s.months[0].warmthPer100).toBeGreaterThan(s.months[11].warmthPer100);
    expect(s.conversations).toBe(122);
    expect(s.longestSilence?.days).toBe(3);
    expect(s.range.days).toBe(363);
  });

  it('samples weeks spread across the whole range, oldest and newest included', () => {
    const weeks = sampleWeeks(year(), { weeks: 10, them: 'Miriam' });
    expect(weeks).toHaveLength(10);
    expect(weeks[0].week <= '2025-10-01').toBe(true);
    expect(weeks[9].week >= '2026-09-20').toBe(true);
    expect(weeks[0].lines[0]).toMatch(/^2025-\d\d-\d\d \d\d:\d\d me: Morning babe/);
    expect(weeks[0].lines.some((l) => / Miriam: /.test(l))).toBe(true);
  });

  it('returns null for an empty thread', () => {
    expect(analyzeThread('x', [])).toBeNull();
  });
});
