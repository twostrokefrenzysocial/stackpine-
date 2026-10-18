import type { Db } from '../db/types';
import type { ActionKind, ActionStatus, PendingAction } from '../types';
import { newId } from '../util/id';
import { parseJson } from '../util/json';

/**
 * Safety rule 2: confirm before acting.
 *
 * Tools can only *propose* actions. A proposal is stored as a PendingAction and
 * rendered as a confirmation card. The side effect runs only through
 * `ActionStore.approve`, which the UI calls when the user taps Approve. The
 * model has no path to `approve`.
 */

export type ActionHandler = (draft: Record<string, unknown>) => Promise<string>;
export type ActionHandlers = Partial<Record<ActionKind, ActionHandler>>;

export type ActionListener = (action: PendingAction) => void;

interface Row {
  id: string;
  conversation_id: string | null;
  kind: string;
  title: string;
  draft: string;
  editable: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  result_message: string | null;
}

const toAction = (r: Row): PendingAction => ({
  id: r.id,
  conversationId: r.conversation_id ?? undefined,
  kind: r.kind as ActionKind,
  title: r.title,
  draft: parseJson<Record<string, unknown>>(r.draft, {}),
  editable: parseJson<string[]>(r.editable, []),
  status: r.status as ActionStatus,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at ?? undefined,
  resultMessage: r.result_message ?? undefined,
});

export class ActionStore {
  private listeners = new Set<ActionListener>();
  private inFlight = new Set<string>();

  constructor(
    private readonly db: Db,
    private handlers: ActionHandlers = {},
  ) {}

  setHandlers(handlers: ActionHandlers): void {
    this.handlers = handlers;
  }

  subscribe(fn: ActionListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(a: PendingAction) {
    for (const l of this.listeners) l(a);
  }

  async propose(p: {
    kind: ActionKind;
    title: string;
    draft: Record<string, unknown>;
    editable: string[];
    conversationId?: string;
  }): Promise<PendingAction> {
    const a: PendingAction = {
      id: newId('actn_'),
      conversationId: p.conversationId,
      kind: p.kind,
      title: p.title,
      draft: p.draft,
      editable: p.editable,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await this.db.run(
      'INSERT INTO actions(id, conversation_id, kind, title, draft, editable, status, created_at) VALUES(?,?,?,?,?,?,?,?)',
      [a.id, a.conversationId ?? null, a.kind, a.title, JSON.stringify(a.draft), JSON.stringify(a.editable), a.status, a.createdAt],
    );
    this.emit(a);
    return a;
  }

  async get(id: string): Promise<PendingAction | null> {
    const r = await this.db.get<Row>('SELECT * FROM actions WHERE id = ?', [id]);
    return r ? toAction(r) : null;
  }

  async listPending(): Promise<PendingAction[]> {
    const rows = await this.db.all<Row>("SELECT * FROM actions WHERE status = 'pending' ORDER BY created_at DESC");
    return rows.map(toAction);
  }

  /** User edits from the card. Only fields marked editable may change. */
  async edit(id: string, patch: Record<string, unknown>): Promise<PendingAction> {
    const a = await this.get(id);
    if (!a) throw new Error('Action not found');
    if (a.status !== 'pending') throw new Error('This action is no longer pending');
    const disallowed = Object.keys(patch).filter((k) => !a.editable.includes(k));
    if (disallowed.length) throw new Error(`Not editable: ${disallowed.join(', ')}`);
    const draft = { ...a.draft, ...patch };
    await this.db.run('UPDATE actions SET draft = ? WHERE id = ?', [JSON.stringify(draft), id]);
    const next = { ...a, draft };
    this.emit(next);
    return next;
  }

  async cancel(id: string): Promise<PendingAction> {
    const a = await this.get(id);
    if (!a) throw new Error('Action not found');
    if (a.status !== 'pending') return a;
    return this.finish(a, 'cancelled', 'Cancelled');
  }

  /**
   * Runs the action. Called only by the UI's Approve button. Idempotent: a
   * second tap while running, or after it ran, does nothing.
   */
  async approve(id: string): Promise<PendingAction> {
    const a = await this.get(id);
    if (!a) throw new Error('Action not found');
    if (a.status !== 'pending' || this.inFlight.has(id)) return a;
    const handler = this.handlers[a.kind];
    if (!handler) return this.finish(a, 'failed', `Optimus can't do "${a.kind}" yet.`);
    this.inFlight.add(id);
    try {
      await this.db.run("UPDATE actions SET status = 'approved' WHERE id = ?", [id]);
      const message = await handler(a.draft);
      return await this.finish(a, 'executed', message);
    } catch (e) {
      // Safety rule 4: report failures plainly.
      return await this.finish(a, 'failed', e instanceof Error ? e.message : String(e));
    } finally {
      this.inFlight.delete(id);
    }
  }

  private async finish(a: PendingAction, status: ActionStatus, message: string): Promise<PendingAction> {
    const resolvedAt = new Date().toISOString();
    await this.db.run('UPDATE actions SET status = ?, resolved_at = ?, result_message = ? WHERE id = ?', [status, resolvedAt, message, a.id]);
    const next = { ...a, status, resolvedAt, resultMessage: message };
    this.emit(next);
    return next;
  }
}
