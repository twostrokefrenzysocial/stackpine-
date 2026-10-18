import { ActionStore } from './actions/actions';
import { createActionHandlers } from './actions/handlers';
import { ActivityLog } from './activity/log';
import { ConversationStore, EpisodeStore } from './conversations/store';
import type { Db } from './db/types';
import { runTurn, type TurnEvent, type TurnResult } from './llm/agent';
import { maybeRollSummary, processConversation, unsummarizedMessages, type BackgroundLlm } from './llm/background';
import type { LlmTransport } from './llm/transport';
import { MemoryStore } from './memory/store';
import { NotificationStore } from './notifications/store';
import { ReminderStore, type ReminderScheduler } from './reminders/reminders';
import type { DataSources, SourceName } from './sources/types';
import type { ChatMessage } from './types';

export interface EngineDeps {
  db: Db;
  sources: () => DataSources;
  transport: () => LlmTransport;
  background: () => BackgroundLlm;
  scheduler?: ReminderScheduler;
  now?: () => Date;
  locationEnabled?: () => boolean;
  /** Sources the user hasn't granted (shown to the model so it can say what it can't see). */
  unavailableSources?: () => Promise<SourceName[]>;
}

/**
 * The app's brain, independent of React Native: stores, the agent loop and
 * background processing. The UI holds one instance.
 */
export class OptimusEngine {
  readonly memory: MemoryStore;
  readonly conversations: ConversationStore;
  readonly episodes: EpisodeStore;
  readonly actions: ActionStore;
  readonly activity: ActivityLog;
  readonly reminders: ReminderStore;
  readonly notifications: NotificationStore;
  private readonly now: () => Date;

  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? (() => new Date());
    this.memory = new MemoryStore(deps.db);
    this.conversations = new ConversationStore(deps.db);
    this.episodes = new EpisodeStore(deps.db);
    this.activity = new ActivityLog(deps.db);
    this.reminders = new ReminderStore(deps.db, deps.scheduler);
    this.notifications = new NotificationStore(deps.db);
    this.actions = new ActionStore(deps.db);
    this.actions.setHandlers(createActionHandlers({ sources: deps.sources, memory: this.memory, reminders: this.reminders }));
  }

  get db(): Db {
    return this.deps.db;
  }

  /**
   * Sends a user message and streams the reply. Saves both sides, so the
   * conversation survives restarts even if the request fails.
   */
  async send(
    conversationId: string,
    text: string,
    onEvent: (e: TurnEvent) => void,
    signal?: AbortSignal,
  ): Promise<{ user: ChatMessage; assistant: ChatMessage; result: TurnResult }> {
    const conv = await this.conversations.get(conversationId);
    if (!conv) throw new Error('Conversation not found');
    const prior = unsummarizedMessages(conv, await this.conversations.messages(conversationId));
    const user = await this.conversations.addMessage(conversationId, { role: 'user', text }, this.now());

    const result = await runTurn({
      userText: text,
      history: prior,
      rollingSummary: conv.rollingSummary,
      transport: this.deps.transport(),
      ctx: {
        sources: this.deps.sources(),
        memory: this.memory,
        conversations: this.conversations,
        episodes: this.episodes,
        actions: this.actions,
        activity: this.activity,
        reminders: this.reminders,
        conversationId,
        now: this.now,
        locationEnabled: this.deps.locationEnabled?.() ?? false,
        userAskedToRemember: /\bremember\b/i.test(text),
      },
      actions: this.actions,
      unavailableSources: (await this.deps.unavailableSources?.()) ?? [],
      onEvent,
      signal,
    });

    const assistant = await this.conversations.addMessage(
      conversationId,
      { role: 'assistant', text: result.text, cards: result.cards, apiContent: result.apiContent },
      this.now(),
    );
    if (conv.title === 'New conversation') await this.conversations.rename(conversationId, text.slice(0, 48));
    // Fold old messages into the rolling summary in the background.
    maybeRollSummary({ llm: this.deps.background(), conversations: this.conversations }, conversationId).catch(() => undefined);
    return { user, assistant, result };
  }

  /** Background memory extraction for conversations that have gone quiet. */
  async processIdleConversations(activeConversationId?: string): Promise<number> {
    let n = 0;
    for (const conv of await this.conversations.unprocessed(activeConversationId)) {
      try {
        const r = await processConversation(
          { llm: this.deps.background(), memory: this.memory, conversations: this.conversations, episodes: this.episodes },
          conv,
          this.now(),
        );
        if (r) {
          n++;
          if (r.saved || r.pending) {
            await this.activity.add({ kind: 'memory', summary: `Learned from “${conv.title}”: ${r.saved} saved, ${r.pending} awaiting approval` });
          }
        }
      } catch (e) {
        await this.activity.add({ kind: 'error', summary: `Memory extraction failed for “${conv.title}”`, detail: e instanceof Error ? e.message : String(e) });
      }
    }
    return n;
  }

  /** "Wipe all local data": every table, including memories. */
  async wipeAll(): Promise<void> {
    const tables = [
      'messages_fts',
      'messages',
      'conversations',
      'memories_fts',
      'memories',
      'pending_memories',
      'episodes_fts',
      'episodes',
      'actions',
      'activity',
      'notifications',
      'reminders',
      'briefs',
      'sync_state',
      'kv',
    ];
    await this.deps.db.transaction(async () => {
      for (const t of tables) await this.deps.db.run(`DELETE FROM ${t}`);
    });
  }
}
