import type { Db } from '../db/types';
import type { ChatCard, ChatMessage, ChatRole, Conversation, Episode } from '../types';
import { newId } from '../util/id';
import { parseJson } from '../util/json';
import { ftsQuery, likeSearch } from '../memory/text';

interface ConvRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  rolling_summary: string | null;
  summarized_through: string | null;
  processed_at: string | null;
}

interface MsgRow {
  id: string;
  conversation_id: string;
  seq: number;
  role: string;
  text: string;
  cards: string;
  api_content: string | null;
  created_at: string;
}

const toConv = (r: ConvRow): Conversation => ({
  id: r.id,
  title: r.title,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  rollingSummary: r.rolling_summary ?? undefined,
  summarizedThroughMessageId: r.summarized_through ?? undefined,
  processedAt: r.processed_at ?? undefined,
});

const toMsg = (r: MsgRow): ChatMessage => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role as ChatRole,
  text: r.text,
  cards: parseJson<ChatCard[]>(r.cards, []),
  createdAt: r.created_at,
  apiContent: parseJson<unknown>(r.api_content, undefined),
});

export class ConversationStore {
  constructor(private readonly db: Db) {}

  async create(title = 'New conversation', now = new Date()): Promise<Conversation> {
    const c: Conversation = { id: newId('conv_'), title, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    await this.db.run('INSERT INTO conversations(id, title, created_at, updated_at) VALUES(?,?,?,?)', [c.id, c.title, c.createdAt, c.updatedAt]);
    return c;
  }

  async get(id: string): Promise<Conversation | null> {
    const r = await this.db.get<ConvRow>('SELECT * FROM conversations WHERE id = ?', [id]);
    return r ? toConv(r) : null;
  }

  async list(limit = 100): Promise<Conversation[]> {
    const rows = await this.db.all<ConvRow>('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?', [limit]);
    return rows.map(toConv);
  }

  async rename(id: string, title: string): Promise<void> {
    await this.db.run('UPDATE conversations SET title = ? WHERE id = ?', [title.slice(0, 80), id]);
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run('DELETE FROM messages_fts WHERE conversation_id = ?', [id]);
      await this.db.run('DELETE FROM messages WHERE conversation_id = ?', [id]);
      await this.db.run('DELETE FROM conversations WHERE id = ?', [id]);
    });
  }

  async addMessage(
    conversationId: string,
    msg: { role: ChatRole; text: string; cards?: ChatCard[]; apiContent?: unknown },
    now = new Date(),
  ): Promise<ChatMessage> {
    const seqRow = await this.db.get<{ s: number | null }>('SELECT MAX(seq) AS s FROM messages WHERE conversation_id = ?', [conversationId]);
    const m: ChatMessage = {
      id: newId('msg_'),
      conversationId,
      role: msg.role,
      text: msg.text,
      cards: msg.cards ?? [],
      createdAt: now.toISOString(),
      apiContent: msg.apiContent,
    };
    await this.db.run(
      'INSERT INTO messages(id, conversation_id, seq, role, text, cards, api_content, created_at) VALUES(?,?,?,?,?,?,?,?)',
      [m.id, conversationId, (seqRow?.s ?? 0) + 1, m.role, m.text, JSON.stringify(m.cards), m.apiContent ? JSON.stringify(m.apiContent) : null, m.createdAt],
    );
    if (m.text.trim()) {
      await this.db.run('INSERT INTO messages_fts(text, conversation_id, message_id) VALUES(?,?,?)', [m.text, conversationId, m.id]);
    }
    await this.db.run('UPDATE conversations SET updated_at = ?, processed_at = NULL WHERE id = ?', [m.createdAt, conversationId]);
    return m;
  }

  async updateCards(messageId: string, cards: ChatCard[]): Promise<void> {
    await this.db.run('UPDATE messages SET cards = ? WHERE id = ?', [JSON.stringify(cards), messageId]);
  }

  async messages(conversationId: string): Promise<ChatMessage[]> {
    const rows = await this.db.all<MsgRow>('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq', [conversationId]);
    return rows.map(toMsg);
  }

  async setRollingSummary(id: string, summary: string, throughMessageId: string): Promise<void> {
    await this.db.run('UPDATE conversations SET rolling_summary = ?, summarized_through = ? WHERE id = ?', [summary, throughMessageId, id]);
  }

  async markProcessed(id: string, now = new Date()): Promise<void> {
    await this.db.run('UPDATE conversations SET processed_at = ? WHERE id = ?', [now.toISOString(), id]);
  }

  /** Conversations with new messages that background extraction hasn't seen. */
  async unprocessed(excludeId?: string): Promise<Conversation[]> {
    const rows = await this.db.all<ConvRow>(
      'SELECT * FROM conversations WHERE processed_at IS NULL AND id != ? ORDER BY updated_at',
      [excludeId ?? ''],
    );
    return rows.map(toConv);
  }

  async search(text: string, opts: { limit?: number; since?: string; until?: string } = {}): Promise<(ChatMessage & { conversationTitle: string })[]> {
    const q = ftsQuery(text);
    if (!q) return [];
    try {
      const rows = await this.db.all<MsgRow & { title: string }>(
        `SELECT m.*, c.title FROM messages_fts f
           JOIN messages m ON m.id = f.message_id
           JOIN conversations c ON c.id = m.conversation_id
          WHERE messages_fts MATCH ? AND m.created_at >= ? AND m.created_at <= ?
          ORDER BY bm25(messages_fts) LIMIT ?`,
        [q, opts.since ?? '0000', opts.until ?? '9999', opts.limit ?? 12],
      );
      return rows.map((r) => ({ ...toMsg(r), conversationTitle: r.title }));
    } catch {
      const like = likeSearch(text, ['m.text']);
      if (!like) return [];
      const rows = await this.db.all<MsgRow & { title: string }>(
        `SELECT m.*, c.title FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE ${like.where} AND m.created_at >= ? AND m.created_at <= ? ORDER BY m.created_at DESC LIMIT ?`,
        [...like.params, opts.since ?? '0000', opts.until ?? '9999', opts.limit ?? 12],
      );
      return rows.map((r) => ({ ...toMsg(r), conversationTitle: r.title }));
    }
  }
}

export class EpisodeStore {
  constructor(private readonly db: Db) {}

  async upsertForConversation(e: Omit<Episode, 'id' | 'createdAt'>, now = new Date()): Promise<Episode> {
    const existing = await this.db.get<{ id: string; created_at: string }>('SELECT id, created_at FROM episodes WHERE conversation_id = ?', [e.conversationId]);
    const ep: Episode = { ...e, id: existing?.id ?? newId('ep_'), createdAt: existing?.created_at ?? now.toISOString() };
    await this.db.transaction(async () => {
      await this.db.run('DELETE FROM episodes WHERE id = ?', [ep.id]);
      await this.db.run('DELETE FROM episodes_fts WHERE episode_id = ?', [ep.id]);
      await this.db.run(
        'INSERT INTO episodes(id, conversation_id, summary, decisions, open_tasks, topics, created_at) VALUES(?,?,?,?,?,?,?)',
        [ep.id, ep.conversationId, ep.summary, JSON.stringify(ep.decisions), JSON.stringify(ep.openTasks), JSON.stringify(ep.topics), ep.createdAt],
      );
      await this.db.run('INSERT INTO episodes_fts(summary, topics, episode_id) VALUES(?,?,?)', [
        [ep.summary, ...ep.decisions, ...ep.openTasks].join(' '),
        ep.topics.join(' '),
        ep.id,
      ]);
    });
    return ep;
  }

  async search(text: string, opts: { since?: string; until?: string; limit?: number } = {}): Promise<Episode[]> {
    const q = ftsQuery(text);
    const params = [opts.since ?? '0000', opts.until ?? '9999', opts.limit ?? 8];
    const recent = () => this.db.all<Record<string, string>>('SELECT * FROM episodes WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC LIMIT ?', params);
    if (!q) return (await recent()).map(toEpisode);
    try {
      const rows = await this.db.all<Record<string, string>>(
        `SELECT e.* FROM episodes_fts f JOIN episodes e ON e.id = f.episode_id
          WHERE episodes_fts MATCH ? AND e.created_at >= ? AND e.created_at <= ? ORDER BY bm25(episodes_fts) LIMIT ?`,
        [q, ...params],
      );
      return rows.map(toEpisode);
    } catch {
      const like = likeSearch(text, ['summary', 'topics', 'open_tasks', 'decisions']);
      if (!like) return [];
      const rows = await this.db.all<Record<string, string>>(
        `SELECT * FROM episodes WHERE ${like.where} AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC LIMIT ?`,
        [...like.params, ...params],
      );
      return rows.map(toEpisode);
    }
  }

  async recent(limit = 10): Promise<Episode[]> {
    const rows = await this.db.all<Record<string, string>>('SELECT * FROM episodes ORDER BY created_at DESC LIMIT ?', [limit]);
    return rows.map(toEpisode);
  }

  async openTasks(limit = 10): Promise<{ task: string; episodeId: string; at: string }[]> {
    const eps = await this.recent(30);
    const out: { task: string; episodeId: string; at: string }[] = [];
    for (const e of eps) for (const t of e.openTasks) out.push({ task: t, episodeId: e.id, at: e.createdAt });
    return out.slice(0, limit);
  }

  async removeTask(episodeId: string, task: string): Promise<void> {
    const row = await this.db.get<Record<string, string>>('SELECT * FROM episodes WHERE id = ?', [episodeId]);
    if (!row) return;
    const ep = toEpisode(row);
    await this.upsertForConversation({ ...ep, openTasks: ep.openTasks.filter((t) => t !== task) });
  }
}

function toEpisode(r: Record<string, string>): Episode {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    summary: r.summary,
    decisions: parseJson<string[]>(r.decisions, []),
    openTasks: parseJson<string[]>(r.open_tasks, []),
    topics: parseJson<string[]>(r.topics, []),
    createdAt: r.created_at,
  };
}
