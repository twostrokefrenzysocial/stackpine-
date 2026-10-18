import type { BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ActionStore } from '../actions/actions';
import type { ActivityLog } from '../activity/log';
import type { ConversationStore, EpisodeStore } from '../conversations/store';
import type { MemoryStore } from '../memory/store';
import type { ReminderStore } from '../reminders/reminders';
import type { DataSources } from '../sources/types';
import type { ChatCard } from '../types';
import type { SuspicionFinding } from '../safety/untrusted';

export type ToolResultContent = NonNullable<BetaToolResultBlockParam['content']>;

export interface ToolContext {
  sources: DataSources;
  memory: MemoryStore;
  conversations: ConversationStore;
  episodes: EpisodeStore;
  actions: ActionStore;
  activity: ActivityLog;
  reminders: ReminderStore;
  conversationId: string;
  now: () => Date;
  locationEnabled: boolean;
  /** Called when the user's own words in this turn include "remember". */
  userAskedToRemember: boolean;
}

export interface ToolOutcome {
  /** What the model sees. Third-party data must already be wrapped as untrusted. */
  content: ToolResultContent;
  isError?: boolean;
  cards?: ChatCard[];
  suspicious?: (SuspicionFinding & { source: string })[];
  /** One line for the Activity Log. */
  activity: string;
}

export interface ToolDef<I = Record<string, unknown>> {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  /** read = no side effects; propose = creates a confirmation card; memory = writes memory per memory rules. */
  kind: 'read' | 'propose' | 'memory';
  run(input: I, ctx: ToolContext): Promise<ToolOutcome>;
}
