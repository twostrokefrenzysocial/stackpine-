/**
 * Safety rule 1: data is never instructions.
 *
 * Every piece of third-party content (texts, emails, notifications, contact
 * notes, photo text) is wrapped before it reaches the model, and scanned for
 * instruction-like language so the user can be warned.
 */

export interface SuspicionFinding {
  reason: string;
  excerpt: string;
}

const PATTERNS: [RegExp, string][] = [
  [/\bignore (all |any |your )?(previous|prior|above|earlier) (instructions|prompts?|rules)\b/i, 'Tries to override the assistant’s instructions'],
  [/\b(disregard|forget) (all |your )?(previous |prior )?(instructions|rules|guidelines)\b/i, 'Tries to override the assistant’s instructions'],
  [/\b(assistant|ai|optimus|chatbot|claude|gpt)\s*(instruction|command|override|directive)s?\b/i, 'Addresses an AI assistant with commands'],
  [/\bsystem (override|prompt|instruction|message)\b/i, 'Pretends to be a system instruction'],
  [/\b(note|message|instructions?) (to|for) (the )?(ai|assistant|optimus|bot)\b/i, 'Addresses an AI assistant with commands'],
  [/\b(forward|send|share|export|upload) (all|every|any) (of )?(the user'?s |my |your )?(messages|emails|texts|contacts|photos|data|files|conversations)\b/i, 'Asks to move the user’s data somewhere'],
  [/\b(do not|don't|never) (tell|inform|notify|alert) (the )?(user|owner|him|her|them)\b/i, 'Asks to hide something from the user'],
  [/\b(delete|wipe|erase|remove) (all|every) (of )?(the |your |my )?(events|messages|emails|memories|contacts|data)\b/i, 'Asks to delete the user’s data'],
  [/\balways share (my|the user'?s) (location|data|messages)\b/i, 'Asks to share the user’s data'],
  [/\b(you are now|act as|pretend to be|new persona|jailbreak|developer mode)\b/i, 'Tries to change the assistant’s role'],
  [/<\/?(system|instructions?|untrusted_data|tool_result)>/i, 'Contains fake control tags'],
];

export function scanForInjection(text: string): SuspicionFinding | null {
  for (const [re, reason] of PATTERNS) {
    const m = text.match(re);
    if (m && m.index != null) {
      const start = Math.max(0, m.index - 40);
      const end = Math.min(text.length, m.index + m[0].length + 60);
      const excerpt = `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
      return { reason, excerpt };
    }
  }
  return null;
}

/** Neutralizes anything that looks like our own wrapper tags inside data. */
function defang(text: string): string {
  return text.replace(/<\s*(\/?)\s*(untrusted_data|system|instructions?)/gi, '‹$1$2');
}

/**
 * Wraps third-party content for the model. The system prompt tells the model
 * that anything inside <untrusted_data> is information only.
 */
export function wrapUntrusted(source: string, payload: unknown): string {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 1);
  return `<untrusted_data source="${source}">\n${defang(body)}\n</untrusted_data>`;
}
