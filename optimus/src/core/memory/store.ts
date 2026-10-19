import type { Db } from '../db/types';
import {
  MEMORY_CATEGORIES,
  type Memory,
  type MemoryCategory,
  type MemorySourceKind,
  type PendingMemory,
} from '../types';
import { newId } from '../util/id';
import { parseJson } from '../util/json';
import { findForbidden, sensitiveTopic } from './sensitive';
import { factSlot, ftsQuery, likeSearch, normalize, similarity } from './text';

export interface MemoryInput {
  category: MemoryCategory;
  content: string;
  source: MemorySourceKind;
  sourceRef?: string;
  importance?: number;
  personName?: string;
  contactId?: string;
  aliases?: string[];
  derivedFrom?: string[];
}

export interface SaveOptions {
  /** User approved this (pending approval, confirm card, or explicit "remember this"). */
  approved?: boolean;
  /** User explicitly agreed to store a sensitive (health/finance) fact. */
  sensitiveConfirmed?: boolean;
  now?: Date;
}

export type SaveResult =
  | { status: 'saved' | 'updated' | 'merged'; memory: Memory }
  | { status: 'duplicate'; memory: Memory }
  | { status: 'pending'; pending: PendingMemory; reason: 'from-data' | 'sensitive' }
  | { status: 'rejected'; reason: string };

/** Sources whose facts the user stated directly. Everything else needs approval. */
const DIRECT_SOURCES: MemorySourceKind[] = ['conversation', 'manual', 'import', 'derived'];

const DUPLICATE_THRESHOLD = 0.8;

interface MemoryRow {
  id: string;
  category: string;
  content: string;
  source: string;
  source_ref: string | null;
  contact_id: string | null;
  person_name: string | null;
  aliases: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  importance: number;
  previous_value: string | null;
  sensitive: number;
  derived_from: string;
}

function clampImportance(n: number | undefined): Memory['importance'] {
  const v = Math.round(n ?? 3);
  return Math.min(5, Math.max(1, v)) as Memory['importance'];
}

function toMemory(r: MemoryRow): Memory {
  return {
    id: r.id,
    category: r.category as MemoryCategory,
    content: r.content,
    source: r.source as MemorySourceKind,
    sourceRef: r.source_ref ?? undefined,
    contactId: r.contact_id ?? undefined,
    personName: r.person_name ?? undefined,
    aliases: parseJson<string[]>(r.aliases, []),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastUsedAt: r.last_used_at ?? undefined,
    importance: clampImportance(r.importance),
    previousValue: r.previous_value ?? undefined,
    sensitive: r.sensitive === 1,
    derivedFrom: parseJson<string[]>(r.derived_from, []),
  };
}

function isCategory(c: string): c is MemoryCategory {
  return (MEMORY_CATEGORIES as readonly string[]).includes(c);
}

export class MemoryStore {
  constructor(private readonly db: Db) {}

  // ---------- reads ----------

  async get(id: string): Promise<Memory | null> {
    const row = await this.db.get<MemoryRow>('SELECT * FROM memories WHERE id = ?', [id]);
    return row ? toMemory(row) : null;
  }

  async list(category?: MemoryCategory): Promise<Memory[]> {
    const rows = category
      ? await this.db.all<MemoryRow>('SELECT * FROM memories WHERE category = ? ORDER BY importance DESC, updated_at DESC', [category])
      : await this.db.all<MemoryRow>('SELECT * FROM memories ORDER BY category, importance DESC, updated_at DESC');
    return rows.map(toMemory);
  }

  async count(): Promise<number> {
    const r = await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM memories');
    return r?.n ?? 0;
  }

  /**
   * Full-text search. Returns memories with a relevance score in (0, 1],
   * higher is better.
   */
  async search(text: string, opts: { category?: MemoryCategory; limit?: number } = {}): Promise<{ memory: Memory; relevance: number }[]> {
    const q = ftsQuery(text);
    if (!q) return [];
    const limit = opts.limit ?? 20;
    try {
      const rows = await this.db.all<MemoryRow & { rank: number }>(
        `SELECT m.*, bm25(memories_fts, 1.0, 2.0, 2.0) AS rank
           FROM memories_fts JOIN memories m ON m.id = memories_fts.memory_id
          WHERE memories_fts MATCH ? ${opts.category ? 'AND m.category = ?' : ''}
          ORDER BY rank LIMIT ?`,
        opts.category ? [q, opts.category, limit] : [q, limit],
      );
      // bm25 is negative; more negative = better. Map to (0, 1].
      return rows.map((r) => ({ memory: toMemory(r), relevance: 1 / (1 + Math.exp(r.rank + 2)) }));
    } catch {
      return this.searchWithoutFts(text, opts.category, limit);
    }
  }

  private async searchWithoutFts(text: string, category: MemoryCategory | undefined, limit: number) {
    const like = likeSearch(text, ['content', 'person_name', 'aliases']);
    if (!like) return [];
    const rows = await this.db.all<MemoryRow>(
      `SELECT * FROM memories WHERE ${like.where} ${category ? 'AND category = ?' : ''} LIMIT 200`,
      category ? [...like.params, category] : like.params,
    );
    return rows
      .map((r) => ({ memory: toMemory(r), relevance: like.score(`${r.content} ${r.person_name ?? ''} ${r.aliases}`) }))
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
  }

  /** Finds the People entry for a name, alias ("my wife") or contact id. */
  async findPerson(nameOrAlias: string, contactId?: string): Promise<Memory | null> {
    if (contactId) {
      const row = await this.db.get<MemoryRow>('SELECT * FROM memories WHERE contact_id = ?', [contactId]);
      if (row) return toMemory(row);
    }
    const needle = normalize(nameOrAlias).replace(/^(my|the)\s+/, '');
    if (!needle) return null;
    const people = await this.list('People');
    return (
      people.find((p) => {
        const names = [p.personName ?? '', ...(p.aliases ?? [])].map((n) => normalize(n).replace(/^(my|the)\s+/, ''));
        return names.some((n) => n === needle || (n.split(' ')[0] === needle && needle.length > 2));
      }) ?? null
    );
  }

  // ---------- writes ----------

  async save(input: MemoryInput, opts: SaveOptions = {}): Promise<SaveResult> {
    const now = (opts.now ?? new Date()).toISOString();
    const content = input.content.trim().replace(/\s+/g, ' ');
    if (!content) return { status: 'rejected', reason: 'empty' };
    if (!isCategory(input.category)) return { status: 'rejected', reason: `unknown category "${input.category}"` };

    const forbidden = findForbidden(content);
    if (forbidden) return { status: 'rejected', reason: `contains a ${forbidden.replace('-', ' ')}, which Optimus never stores` };

    const topic = sensitiveTopic(content);
    const fromData = !DIRECT_SOURCES.includes(input.source);
    if (fromData && !opts.approved) {
      return { status: 'pending', reason: 'from-data', pending: await this.addPending(input, `Learned from ${input.source}`, now) };
    }
    if (topic && !opts.sensitiveConfirmed && !opts.approved) {
      return { status: 'pending', reason: 'sensitive', pending: await this.addPending(input, `Sensitive (${topic})`, now) };
    }

    return this.db.transaction(async () => {
      // People: exactly one entry per person, merged.
      if (input.category === 'People' && (input.personName || input.contactId)) {
        const existing = await this.findPerson(input.personName ?? '', input.contactId);
        if (existing) return this.mergePerson(existing, { ...input, content }, now);
      }

      const candidates = await this.candidates(input.category, content);
      for (const c of candidates) {
        if (similarity(c.content, content) >= DUPLICATE_THRESHOLD) {
          const importance = Math.max(c.importance, clampImportance(input.importance));
          await this.db.run('UPDATE memories SET updated_at = ?, importance = ? WHERE id = ?', [now, importance, c.id]);
          return { status: 'duplicate' as const, memory: { ...c, updatedAt: now, importance: clampImportance(importance) } };
        }
      }

      // Contradiction: same slot, different value -> update in place, keep previous value.
      const slot = factSlot(content);
      if (slot) {
        const clash = candidates.find((c) => {
          const s = factSlot(c.content);
          return s && s.slot === slot.slot && normalize(s.value) !== normalize(slot.value);
        });
        if (clash) {
          const updated = await this.update(clash.id, content, { now: opts.now, source: input.source, sensitive: !!topic });
          if (updated) return { status: 'updated' as const, memory: updated };
        }
      }

      const memory: Memory = {
        id: newId('mem_'),
        category: input.category,
        content,
        source: input.source,
        sourceRef: input.sourceRef,
        contactId: input.contactId,
        personName: input.personName,
        aliases: dedupeStrings(input.aliases ?? []),
        createdAt: now,
        updatedAt: now,
        importance: clampImportance(input.importance),
        sensitive: !!topic,
        derivedFrom: input.derivedFrom ?? [],
      };
      await this.insert(memory);
      return { status: 'saved' as const, memory };
    });
  }

  async update(
    id: string,
    content: string,
    opts: { now?: Date; source?: MemorySourceKind; importance?: number; sensitive?: boolean } = {},
  ): Promise<Memory | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const forbidden = findForbidden(content);
    if (forbidden) throw new Error(`That contains a ${forbidden.replace('-', ' ')}, which Optimus never stores.`);
    const now = (opts.now ?? new Date()).toISOString();
    const next: Memory = {
      ...existing,
      content: content.trim(),
      previousValue: existing.content,
      updatedAt: now,
      importance: opts.importance != null ? clampImportance(opts.importance) : existing.importance,
      sensitive: opts.sensitive ?? existing.sensitive,
    };
    await this.db.run(
      'UPDATE memories SET content = ?, previous_value = ?, updated_at = ?, importance = ?, sensitive = ? WHERE id = ?',
      [next.content, next.previousValue ?? null, now, next.importance, next.sensitive ? 1 : 0, id],
    );
    await this.reindex(next);
    return next;
  }

  async setImportance(id: string, importance: number): Promise<void> {
    await this.db.run('UPDATE memories SET importance = ? WHERE id = ?', [clampImportance(importance), id]);
  }

  /**
   * Deletes a memory completely, plus anything derived only from it. Memories
   * derived from several facts just lose the reference.
   */
  async forget(id: string): Promise<{ deleted: string[] }> {
    return this.db.transaction(async () => {
      const deleted: string[] = [];
      const queue = [id];
      while (queue.length) {
        const current = queue.shift()!;
        const row = await this.get(current);
        if (!row) continue;
        await this.db.run('DELETE FROM memories WHERE id = ?', [current]);
        await this.db.run('DELETE FROM memories_fts WHERE memory_id = ?', [current]);
        deleted.push(current);
        const dependents = await this.db.all<MemoryRow>(`SELECT * FROM memories WHERE derived_from LIKE ?`, [`%"${current}"%`]);
        for (const dep of dependents.map(toMemory)) {
          const remaining = (dep.derivedFrom ?? []).filter((d) => d !== current);
          if (remaining.length === 0) queue.push(dep.id);
          else await this.db.run('UPDATE memories SET derived_from = ? WHERE id = ?', [JSON.stringify(remaining), dep.id]);
        }
      }
      return { deleted };
    });
  }

  async markUsed(ids: string[], now = new Date()): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    await this.db.run(`UPDATE memories SET last_used_at = ? WHERE id IN (${placeholders})`, [now.toISOString(), ...ids]);
  }

  // ---------- pending (suggested) memories ----------

  async listPending(): Promise<PendingMemory[]> {
    const rows = await this.db.all<Record<string, unknown>>("SELECT * FROM pending_memories WHERE status = 'pending' ORDER BY created_at DESC");
    return rows.map(toPending);
  }

  async getPending(id: string): Promise<PendingMemory | null> {
    const row = await this.db.get<Record<string, unknown>>('SELECT * FROM pending_memories WHERE id = ?', [id]);
    return row ? toPending(row) : null;
  }

  async approvePending(id: string, editedContent?: string, now = new Date()): Promise<SaveResult> {
    const p = await this.getPending(id);
    if (!p || p.status !== 'pending') return { status: 'rejected', reason: 'no longer pending' };
    const result = await this.save(
      {
        category: p.category,
        content: editedContent?.trim() || p.content,
        source: p.source,
        sourceRef: p.sourceRef,
        importance: p.importance,
        personName: p.personName,
        contactId: p.contactId,
      },
      { approved: true, sensitiveConfirmed: true, now },
    );
    if (result.status !== 'rejected') await this.db.run("UPDATE pending_memories SET status = 'approved' WHERE id = ?", [id]);
    return result;
  }

  async rejectPending(id: string): Promise<void> {
    await this.db.run("UPDATE pending_memories SET status = 'rejected' WHERE id = ?", [id]);
  }

  // ---------- internals ----------

  private async addPending(input: MemoryInput, reason: string, now: string): Promise<PendingMemory> {
    // Don't suggest the same thing twice.
    const open = await this.listPending();
    const dup = open.find((p) => p.category === input.category && similarity(p.content, input.content) >= DUPLICATE_THRESHOLD);
    if (dup) return dup;
    const pending: PendingMemory = {
      id: newId('pmem_'),
      category: input.category,
      content: input.content.trim(),
      source: input.source,
      sourceRef: input.sourceRef,
      reason,
      personName: input.personName,
      contactId: input.contactId,
      importance: clampImportance(input.importance),
      createdAt: now,
      status: 'pending',
    };
    await this.db.run(
      `INSERT INTO pending_memories(id, category, content, source, source_ref, reason, person_name, contact_id, importance, created_at, status)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [
        pending.id,
        pending.category,
        pending.content,
        pending.source,
        pending.sourceRef ?? null,
        pending.reason,
        pending.personName ?? null,
        pending.contactId ?? null,
        pending.importance,
        now,
        'pending',
      ],
    );
    return pending;
  }

  private async candidates(category: MemoryCategory, content: string): Promise<Memory[]> {
    const viaSearch = (await this.search(content, { category, limit: 15 })).map((r) => r.memory);
    const seen = new Set(viaSearch.map((m) => m.id));
    // Slot matches may share few keywords with the new value ("color is blue" vs "green"),
    // so also scan the category when it's small.
    const rest = (await this.list(category)).filter((m) => !seen.has(m.id)).slice(0, 200);
    return [...viaSearch, ...rest];
  }

  private async mergePerson(existing: Memory, input: MemoryInput & { content: string }, now: string): Promise<SaveResult> {
    const aliases = dedupeStrings([...(existing.aliases ?? []), ...(input.aliases ?? [])]);
    const facts = splitFacts(existing.content);
    const incoming = splitFacts(input.content);
    let changed = false;
    for (const fact of incoming) {
      if (facts.some((f) => similarity(f, fact) >= DUPLICATE_THRESHOLD || normalize(f).includes(normalize(fact)))) continue;
      // Replace a contradicting fact about the same slot.
      const slot = factSlot(fact);
      const clashIdx = slot ? facts.findIndex((f) => factSlot(f)?.slot === slot.slot) : -1;
      if (clashIdx >= 0) facts[clashIdx] = fact;
      else facts.push(fact);
      changed = true;
    }
    const content = facts.join('. ').replace(/\.\./g, '.');
    const contactId = existing.contactId ?? input.contactId;
    const personName = existing.personName ?? input.personName;
    const aliasesChanged = aliases.length !== (existing.aliases ?? []).length;
    if (!changed && !aliasesChanged && contactId === existing.contactId) {
      return { status: 'duplicate', memory: existing };
    }
    const next: Memory = {
      ...existing,
      content,
      aliases,
      contactId,
      personName,
      previousValue: changed ? existing.content : existing.previousValue,
      updatedAt: now,
      importance: clampImportance(Math.max(existing.importance, input.importance ?? 0)),
    };
    await this.db.run(
      'UPDATE memories SET content = ?, aliases = ?, contact_id = ?, person_name = ?, previous_value = ?, updated_at = ?, importance = ? WHERE id = ?',
      [next.content, JSON.stringify(aliases), contactId ?? null, personName ?? null, next.previousValue ?? null, now, next.importance, next.id],
    );
    await this.reindex(next);
    return { status: 'merged', memory: next };
  }

  private async insert(m: Memory): Promise<void> {
    await this.db.run(
      `INSERT INTO memories(id, category, content, source, source_ref, contact_id, person_name, aliases, created_at, updated_at,
                            last_used_at, importance, previous_value, sensitive, derived_from)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        m.id,
        m.category,
        m.content,
        m.source,
        m.sourceRef ?? null,
        m.contactId ?? null,
        m.personName ?? null,
        JSON.stringify(m.aliases ?? []),
        m.createdAt,
        m.updatedAt,
        m.lastUsedAt ?? null,
        m.importance,
        m.previousValue ?? null,
        m.sensitive ? 1 : 0,
        JSON.stringify(m.derivedFrom ?? []),
      ],
    );
    await this.reindex(m);
  }

  private async reindex(m: Memory): Promise<void> {
    await this.db.run('DELETE FROM memories_fts WHERE memory_id = ?', [m.id]);
    await this.db.run('INSERT INTO memories_fts(content, person_name, aliases, memory_id) VALUES(?,?,?,?)', [
      m.content,
      m.personName ?? '',
      (m.aliases ?? []).join(' '),
      m.id,
    ]);
  }
}

function toPending(r: Record<string, unknown>): PendingMemory {
  return {
    id: String(r.id),
    category: r.category as MemoryCategory,
    content: String(r.content),
    source: r.source as MemorySourceKind,
    sourceRef: (r.source_ref as string) ?? undefined,
    reason: String(r.reason),
    personName: (r.person_name as string) ?? undefined,
    contactId: (r.contact_id as string) ?? undefined,
    importance: clampImportance(Number(r.importance)),
    createdAt: String(r.created_at),
    status: r.status as PendingMemory['status'],
  };
}

function dedupeStrings(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const k = normalize(s);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s.trim());
  }
  return out;
}

function splitFacts(content: string): string[] {
  return content
    .split(/(?<=[.;])\s+|;\s*/)
    .map((s) => s.replace(/[.;]\s*$/, '').trim())
    .filter(Boolean);
}
