/**
 * A tiny Markdown subset for assistant replies: headings, bullet and
 * numbered lists, paragraphs, and inline bold / italic / code. Models
 * (OpenAI ones especially) use it even when asked for plain text, so the
 * chat renders it instead of showing raw asterisks. Links render as their
 * text only; nothing becomes tappable.
 */

export type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean };
export type MdBlock =
  | { kind: 'heading'; spans: Span[] }
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'bullet'; spans: Span[]; marker: string; depth: number };

export function parseInline(text: string): Span[] {
  // Links → their text; keep bare URLs as plain text.
  const src = text.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1');
  const out: Span[] = [];
  // Group 1 is the character before an italic marker (no lookbehind, for older engines).
  const re = /(\*\*|__)(.+?)\1|`([^`]+)`|(^|[^\w*])\*(?!\s)([^*]+?)\*(?![\w*])|(^|[^\w_])_(?!\s)([^_]+?)_(?![\w_])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const lead = m[4] ?? m[6] ?? '';
    const start = m.index + lead.length;
    if (start > last) out.push({ text: src.slice(last, start) });
    if (m[2] !== undefined) out.push({ text: m[2], bold: true });
    else if (m[3] !== undefined) out.push({ text: m[3], code: true });
    else out.push({ text: (m[5] ?? m[7])!, italic: true });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out.length ? out : [{ text: '' }];
}

export function parseMarkdown(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'paragraph', spans: parseInline(para.join('\n')) });
    para = [];
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flush(); // horizontal rule: just a break
      continue;
    }
    const h = line.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*$/);
    if (h) {
      flush();
      blocks.push({ kind: 'heading', spans: parseInline(h[1].replace(/^\*\*(.*)\*\*$/, '$1')) });
      continue;
    }
    const b = line.match(/^(\s*)([-*•]|\d{1,3}[.)])\s+(.*)$/);
    if (b) {
      flush();
      const marker = /\d/.test(b[2]) ? b[2].replace(')', '.') : '•';
      blocks.push({ kind: 'bullet', spans: parseInline(b[3]), marker, depth: Math.min(2, Math.floor(b[1].replace(/\t/g, '  ').length / 2)) });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}
