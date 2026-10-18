import type { MemoryStore } from '../memory/store';
import type { ReminderStore } from '../reminders/reminders';
import type { RoutineStore } from '../routines/routines';
import type { DataSources } from '../sources/types';
import { dayPhrase } from '../util/time';
import type { ActionHandlers } from './actions';

const s = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * The side effects behind each confirmation card. Each returns a short,
 * truthful result line; failures throw and are reported as failed.
 */
export function createActionHandlers(deps: { sources: () => DataSources; memory: MemoryStore; reminders: ReminderStore; routines: RoutineStore; onRoutinesChanged?: () => Promise<unknown> }): ActionHandlers {
  return {
    async send_text(d) {
      await deps.sources().texts.send(s(d.to), s(d.body));
      return `Text sent to ${s(d.toName) || s(d.to)}.`;
    },
    async start_call(d) {
      await deps.sources().calls.startCall(s(d.to));
      return `Calling ${s(d.toName) || s(d.to)}…`;
    },
    async create_event(d) {
      const e = await deps.sources().calendar.create({
        title: s(d.title),
        start: s(d.start),
        end: s(d.end),
        location: s(d.location) || undefined,
        notes: s(d.notes) || undefined,
        allDay: d.allDay === true,
      });
      return `Added “${e.title}” ${dayPhrase(e.start)}.`;
    },
    async edit_event(d) {
      const e = await deps.sources().calendar.update(s(d.eventId), {
        title: s(d.title) || undefined,
        start: s(d.start) || undefined,
        end: s(d.end) || undefined,
        location: s(d.location) || undefined,
        notes: s(d.notes) || undefined,
      });
      return `Updated “${e.title}”.`;
    },
    async delete_event(d) {
      await deps.sources().calendar.remove(s(d.eventId));
      return `Deleted “${s(d.title)}”.`;
    },
    async send_email(d) {
      const to = Array.isArray(d.to) ? d.to.map(String) : [s(d.to)];
      await deps.sources().email.send({ to, subject: s(d.subject), body: s(d.body), inReplyToId: s(d.inReplyToId) || undefined });
      return `Email sent to ${to.join(', ')}.`;
    },
    async save_memory_from_data(d) {
      const r = await deps.memory.approvePending(s(d.pendingId), s(d.content));
      if (r.status === 'rejected') throw new Error(`Couldn't save: ${r.reason}`);
      return 'Remembered.';
    },
    async delete_memory(d) {
      const { deleted } = await deps.memory.forget(s(d.memoryId));
      if (!deleted.length) throw new Error('That memory was already gone.');
      return deleted.length > 1 ? `Forgotten, along with ${deleted.length - 1} related memory.` : 'Forgotten.';
    },
    async create_reminder(d) {
      const r = await deps.reminders.create({ text: s(d.text), dueAt: s(d.dueAt) });
      return `Reminder set for ${dayPhrase(r.dueAt)}.`;
    },
    async create_routine(d) {
      const r = await deps.routines.create({ title: s(d.title), instruction: s(d.instruction), time: s(d.time) });
      // Write and schedule the first week now; failures here are retried on the next app open.
      await deps.onRoutinesChanged?.().catch(() => undefined);
      return `Daily routine “${r.title}” is on: a new one arrives every day at ${r.time}.`;
    },
    async delete_routine(d) {
      if (!(await deps.routines.remove(s(d.routineId)))) throw new Error('That routine was already stopped.');
      return `Stopped “${s(d.title)}”.`;
    },
  };
}
