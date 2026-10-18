const STOPWORDS = new Set(
  (
    'a an and are as at be been but by do does for from had has have he her hers him his i im ' +
    'in is it its me my of on or our she so that the their them they this to us was we were ' +
    'what when where which who will with you your about into than then there these those just ' +
    'really very also any can could would should user users'
  ).split(' '),
);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function keywords(text: string): string[] {
  return normalize(text)
    .split(' ')
    .map((w) => w.replace(/'s$/, '').replace(/'/g, ''))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Token-set Jaccard similarity in [0, 1]. */
export function similarity(a: string, b: string): number {
  const A = new Set(keywords(a));
  const B = new Set(keywords(b));
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Builds a safe FTS5 MATCH expression from free text: each keyword becomes a
 * quoted prefix term, OR-ed together. Returns null when nothing is searchable.
 */
export function ftsQuery(text: string, max = 12): string | null {
  const words = [...new Set(keywords(text))].slice(0, max);
  if (words.length === 0) return null;
  return words.map((w) => `"${w.replace(/"/g, '')}"*`).join(' OR ');
}

/**
 * The "slot" a fact talks about, used to detect contradictions:
 * "My favorite color is blue" and "My favorite color is green" share the
 * slot "favorite color". Returns null when the fact has no clear slot.
 */
export function factSlot(content: string): { slot: string; value: string } | null {
  const t = normalize(content).replace(/^(the user's|users|user's|my|i)\s+/, '');
  const patterns: RegExp[] = [
    /^(.{3,60}?)\s+(?:is|are|was)\s+(?:now\s+)?(.+)$/,
    /^(?:i\s+)?(live|lives|living)\s+(?:in|at)\s+(.+)$/,
    /^(?:i\s+)?(work|works|working)\s+(?:at|for)\s+(.+)$/,
    /^(?:i\s+)?(drive|drives)\s+(?:a|an)?\s*(.+)$/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const slot = keywords(m[1]).join(' ');
      if (!slot) continue;
      const canonical = slot.replace(/^(lives|living)$/, 'live').replace(/^(works|working)$/, 'work').replace(/^drives$/, 'drive');
      return { slot: canonical, value: m[2].trim() };
    }
  }
  return null;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Fallback when FTS5 is unavailable: a LIKE clause matching any keyword in
 * any of the given columns, plus a JS scorer (keyword hit ratio in (0, 1]).
 */
export function likeSearch(text: string, columns: string[], max = 8): { where: string; params: string[]; score: (haystack: string) => number } | null {
  const words = [...new Set(keywords(text))].slice(0, max);
  if (!words.length) return null;
  const where = `(${words.map(() => `(${columns.map((c) => `LOWER(${c}) LIKE ?`).join(' OR ')})`).join(' OR ')})`;
  const params = words.flatMap((w) => columns.map(() => `%${w}%`));
  const score = (h: string) => {
    const hay = h.toLowerCase();
    return words.filter((w) => hay.includes(w)).length / words.length;
  };
  return { where, params, score };
}
