import { MEMORY_CATEGORIES, type MemoryCategory } from '../types';
import { isoOrUndefined, num, str, truncate } from './helpers';
import type { ToolDef } from './types';

const categoryEnum = [...MEMORY_CATEGORIES];

function asCategory(v: unknown): MemoryCategory | undefined {
  return categoryEnum.includes(v as MemoryCategory) ? (v as MemoryCategory) : undefined;
}

export const searchMemory: ToolDef = {
  name: 'search_memory',
  kind: 'read',
  description:
    'Search what you remember about the user (facts, people, preferences, routines, places, dates). Use before answering personal questions when the provided memory context is not enough.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keywords to search for' },
      category: { type: 'string', enum: categoryEnum },
    },
    required: ['query'],
  },
  async run(input, ctx) {
    const rows = await ctx.memory.search(String(input.query ?? ''), { category: asCategory(input.category), limit: 12 });
    await ctx.memory.markUsed(rows.map((r) => r.memory.id), ctx.now());
    const items = rows.map(({ memory: m }) => ({ id: m.id, category: m.category, person: m.personName, content: m.content, updated: m.updatedAt.slice(0, 10) }));
    return {
      content: items.length ? JSON.stringify(items) : 'No matching memories.',
      activity: `Searched memory for “${truncate(String(input.query ?? ''), 40)}” (${items.length} found)`,
    };
  },
};

export const saveMemory: ToolDef = {
  name: 'save_memory',
  kind: 'memory',
  description:
    'Save a durable fact the user told you directly in this conversation (still true weeks from now). Always use this when the user says "remember". Never save passwords, card, account or ID numbers. For health or finance facts set sensitive_confirmed only after the user explicitly agreed to store it. Do not use this for facts learned from texts, emails, calls or notifications; use suggest_memory_from_data for those.',
  input_schema: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: categoryEnum },
      content: { type: 'string', description: 'The fact, written in third person, e.g. "Prefers aisle seats"' },
      importance: { type: 'integer', minimum: 1, maximum: 5 },
      person_name: { type: 'string', description: 'For People: the person’s full name' },
      contact_id: { type: 'string', description: 'For People: the contact id from lookup_contact, if known' },
      aliases: { type: 'array', items: { type: 'string' }, description: 'For People: how the user refers to them ("my wife")' },
      sensitive_confirmed: { type: 'boolean' },
    },
    required: ['category', 'content'],
  },
  async run(input, ctx) {
    const category = asCategory(input.category);
    if (!category) return { content: `Unknown category. Use one of: ${categoryEnum.join(', ')}`, isError: true, activity: 'save_memory: bad category' };
    const result = await ctx.memory.save(
      {
        category,
        content: String(input.content ?? ''),
        source: 'conversation',
        sourceRef: ctx.conversationId,
        importance: num(input.importance),
        personName: str(input.person_name),
        contactId: str(input.contact_id),
        aliases: Array.isArray(input.aliases) ? input.aliases.map(String) : undefined,
      },
      { sensitiveConfirmed: input.sensitive_confirmed === true, approved: false, now: ctx.now() },
    );
    switch (result.status) {
      case 'saved':
      case 'updated':
      case 'merged':
      case 'duplicate':
        return {
          content: `Memory ${result.status} (id ${result.memory.id}): ${result.memory.content}${result.status === 'updated' ? ` (was: ${result.memory.previousValue})` : ''}`,
          cards: result.status === 'duplicate' ? [] : [{ type: 'memory-saved', memoryId: result.memory.id, content: result.memory.content }],
          activity: `Memory ${result.status}: ${truncate(result.memory.content, 60)}`,
        };
      case 'pending':
        return {
          content:
            result.reason === 'sensitive'
              ? 'NOT SAVED: this looks sensitive (health or finances). Ask the user if they want you to remember it; if they say yes, call save_memory again with sensitive_confirmed=true.'
              : 'NOT SAVED: added to Pending memories for the user to approve.',
          activity: `Memory held for approval: ${truncate(result.pending.content, 60)}`,
        };
      case 'rejected':
        return { content: `NOT SAVED: ${result.reason}. Tell the user you don't store that.`, activity: `Memory refused (${result.reason})` };
    }
  },
};

export const suggestMemoryFromData: ToolDef = {
  name: 'suggest_memory_from_data',
  kind: 'propose',
  description:
    'Suggest remembering a durable fact you learned from the user’s texts, emails, calls, notifications, calendar or photos. It is NOT saved until the user approves the card.',
  input_schema: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: categoryEnum },
      content: { type: 'string' },
      source: { type: 'string', enum: ['sms', 'email', 'calls', 'notifications', 'calendar', 'contacts', 'photos'] },
      person_name: { type: 'string' },
      importance: { type: 'integer', minimum: 1, maximum: 5 },
    },
    required: ['category', 'content', 'source'],
  },
  async run(input, ctx) {
    const category = asCategory(input.category);
    if (!category) return { content: 'Unknown category.', isError: true, activity: 'suggest_memory: bad category' };
    const source = (str(input.source) ?? 'email') as 'sms' | 'email' | 'calls' | 'notifications' | 'calendar' | 'contacts' | 'photos';
    const result = await ctx.memory.save(
      { category, content: String(input.content ?? ''), source, sourceRef: ctx.conversationId, personName: str(input.person_name), importance: num(input.importance) },
      { now: ctx.now() },
    );
    if (result.status === 'rejected') return { content: `NOT SUGGESTED: ${result.reason}.`, activity: `Memory suggestion refused (${result.reason})` };
    if (result.status !== 'pending') return { content: 'Already remembered.', activity: 'Memory suggestion was already known' };
    const action = await ctx.actions.propose({
      kind: 'save_memory_from_data',
      title: 'Remember this?',
      draft: { pendingId: result.pending.id, category, content: result.pending.content, source },
      editable: ['content'],
      conversationId: ctx.conversationId,
    });
    return {
      content: `Suggested to the user as a card (not saved yet). It also appears under Memory Core > Pending.`,
      cards: [{ type: 'confirm', actionId: action.id }],
      activity: `Suggested memory from ${source}: ${truncate(result.pending.content, 60)}`,
    };
  },
};

export const updateMemory: ToolDef = {
  name: 'update_memory',
  kind: 'memory',
  description: 'Update an existing memory when the user corrects or changes a fact. The previous value is kept.',
  input_schema: {
    type: 'object',
    properties: { id: { type: 'string' }, content: { type: 'string' }, importance: { type: 'integer', minimum: 1, maximum: 5 } },
    required: ['id', 'content'],
  },
  async run(input, ctx) {
    try {
      const m = await ctx.memory.update(String(input.id), String(input.content ?? ''), { now: ctx.now(), importance: num(input.importance) });
      if (!m) return { content: 'No memory with that id. Search first.', isError: true, activity: 'update_memory: not found' };
      return {
        content: `Updated: ${m.content} (was: ${m.previousValue})`,
        cards: [{ type: 'memory-saved', memoryId: m.id, content: m.content }],
        activity: `Memory updated: ${truncate(m.content, 60)}`,
      };
    } catch (e) {
      return { content: `NOT UPDATED: ${(e as Error).message}`, isError: true, activity: 'update_memory refused' };
    }
  },
};

export const forgetMemory: ToolDef = {
  name: 'forget_memory',
  kind: 'propose',
  description:
    'Ask to permanently delete a memory (and anything derived only from it). Shows a confirmation card; nothing is deleted until the user approves.',
  input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  async run(input, ctx) {
    const m = await ctx.memory.get(String(input.id));
    if (!m) return { content: 'No memory with that id. Search first.', isError: true, activity: 'forget_memory: not found' };
    const action = await ctx.actions.propose({
      kind: 'delete_memory',
      title: 'Forget this memory?',
      draft: { memoryId: m.id, content: m.content, category: m.category },
      editable: [],
      conversationId: ctx.conversationId,
    });
    return {
      content: 'Confirmation card shown. The memory is NOT deleted until the user approves.',
      cards: [{ type: 'confirm', actionId: action.id }],
      activity: `Proposed forgetting: ${truncate(m.content, 60)}`,
    };
  },
};

export const searchPastConversations: ToolDef = {
  name: 'search_past_conversations',
  kind: 'read',
  description:
    'Search past conversations with the user and their summaries (decisions, open tasks). Use for "what did we talk about…" questions. Optional date range.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      since: { type: 'string', description: 'ISO date/time' },
      until: { type: 'string', description: 'ISO date/time' },
    },
    required: ['query'],
  },
  async run(input, ctx) {
    const query = String(input.query ?? '');
    const range = { since: isoOrUndefined(input.since), until: isoOrUndefined(input.until) };
    const episodes = await ctx.episodes.search(query, { ...range, limit: 6 });
    const messages = (await ctx.conversations.search(query, { ...range, limit: 10 })).filter((m) => m.conversationId !== ctx.conversationId);
    const payload = {
      summaries: episodes.map((e) => ({ date: e.createdAt.slice(0, 10), summary: e.summary, decisions: e.decisions, open_tasks: e.openTasks })),
      messages: messages.map((m) => ({ date: m.createdAt.slice(0, 16), conversation: m.conversationTitle, role: m.role, text: truncate(m.text, 300) })),
    };
    const n = episodes.length + messages.length;
    return {
      content: n ? JSON.stringify(payload) : 'Nothing found in past conversations.',
      activity: `Searched past conversations for “${truncate(query, 40)}” (${n} hits)`,
    };
  },
};

export const MEMORY_TOOLS = [searchMemory, saveMemory, suggestMemoryFromData, updateMemory, forgetMemory, searchPastConversations];
