import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { DATA_TOOLS } from './dataTools';
import { MEMORY_TOOLS } from './memoryTools';
import type { ToolDef } from './types';

/** Every tool, in a fixed order so the prompt cache prefix stays stable. */
export const ALL_TOOLS: ToolDef[] = [...MEMORY_TOOLS, ...DATA_TOOLS];

export function toolByName(name: string): ToolDef | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

export function apiTools(tools: ToolDef[] = ALL_TOOLS): BetaTool[] {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}
