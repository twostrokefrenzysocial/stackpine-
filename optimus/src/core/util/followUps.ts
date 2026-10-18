import type { ChatMessage } from '../types';

/**
 * One-tap next steps under the latest reply, based on what it showed:
 * reply to the email, call back the missed call, add the event reminder.
 * Plain requests the user could have typed; tapping one just sends it.
 */
export function followUps(m: ChatMessage | undefined): string[] {
  if (!m || m.role !== 'assistant') return [];
  const out: string[] = [];
  const first = (s?: string) => (s ?? '').split(/[\s<@]/)[0];
  for (const c of m.cards) {
    if (c.type === 'emails' && c.emails[0]) out.push(`Reply to ${first(c.emails[0].fromName ?? c.emails[0].from)}`, 'Summarize these emails');
    else if (c.type === 'texts' && c.messages[0]?.contactName) out.push(`Reply to ${first(c.messages[0].contactName)}`);
    else if (c.type === 'calls') {
      const missed = c.calls.find((x) => x.type === 'missed');
      if (missed) out.push(`Call ${missed.contactName ?? missed.number} back`);
    } else if (c.type === 'events' && c.events[0]) out.push(`Remind me before ${c.events[0].title}`, 'What should I prepare?');
    else if (c.type === 'photos' && c.photos.length > 1) out.push('Show me more like these');
    else if (c.type === 'sources') out.push('Tell me more');
  }
  return [...new Set(out)].slice(0, 3);
}
