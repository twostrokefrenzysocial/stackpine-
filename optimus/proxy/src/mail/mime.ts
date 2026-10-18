/**
 * Just enough MIME to read email: headers (folded, RFC 2047 encoded words),
 * multipart bodies, base64 and quoted-printable, common charsets. Prefers
 * text/plain and falls back to text/html stripped to text. Tolerates a
 * message cut off part-way (we fetch only the first part of big emails).
 *
 * Input is a "binary string": one char per byte, exactly as IMAP sent it.
 */

/** One char per byte → the bytes. */
export function binaryBytes(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
}

/** Raw 8-bit header text is almost always UTF-8. */
function utf8IfBinary(s: string): string {
  return /[\x80-\xff]/.test(s) ? decodeBytes(binaryBytes(s), 'utf-8') : s;
}

export interface ParsedMail {
  headers: Record<string, string>;
  text: string;
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  const cs = charset.toLowerCase().replace(/^"|"$/g, '') || 'utf-8';
  try {
    return new TextDecoder(cs === 'us-ascii' ? 'utf-8' : cs).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function base64Bytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, '');
  const trimmed = clean.slice(0, clean.length - (clean.length % 4));
  try {
    const bin = atob(trimmed);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

function qpBytes(s: string, header = false): Uint8Array {
  const src = header ? s.replace(/_/g, ' ') : s.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) {
      out.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(src.charCodeAt(i) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** =?utf-8?B?...?= and =?iso-8859-1?Q?...?= in headers. */
export function decodeWords(v: string): string {
  return v
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, cs: string, enc: string, data: string) => decodeBytes(enc.toUpperCase() === 'B' ? base64Bytes(data) : qpBytes(data, true), cs));
}

export function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    if (!(key in headers)) headers[key] = decodeWords(utf8IfBinary(line.slice(i + 1).trim()));
  }
  return headers;
}

function param(header: string | undefined, name: string): string {
  const m = header?.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, 'i'));
  return m ? (m[2] ?? m[1]) : '';
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

function splitHeaderBody(raw: string): [string, string] {
  const m = raw.match(/\r?\n\r?\n/);
  if (!m || m.index === undefined) return [raw, ''];
  return [raw.slice(0, m.index), raw.slice(m.index + m[0].length)];
}

/** Returns the best text of a part: { plain, html } found so far. */
function walk(raw: string, depth = 0): { plain?: string; html?: string } {
  const [head, body] = splitHeaderBody(raw);
  const h = parseHeaders(head);
  const type = (h['content-type'] ?? 'text/plain').toLowerCase();
  if (type.startsWith('multipart/') && depth < 6) {
    const boundary = param(h['content-type'], 'boundary');
    if (!boundary) return {};
    const parts = body.split(`--${boundary}`).slice(1);
    const found: { plain?: string; html?: string } = {};
    for (const p of parts) {
      if (p.startsWith('--')) break;
      const r = walk(p.replace(/^\r?\n/, ''), depth + 1);
      found.plain ??= r.plain;
      found.html ??= r.html;
    }
    return found;
  }
  if (/attachment/i.test(h['content-disposition'] ?? '')) return {};
  const enc = (h['content-transfer-encoding'] ?? '').toLowerCase();
  const charset = param(h['content-type'], 'charset') || 'utf-8';
  const bytes = enc === 'base64' ? base64Bytes(body) : enc === 'quoted-printable' ? qpBytes(body) : binaryBytes(body);
  const text = decodeBytes(bytes, charset);
  if (type.startsWith('text/plain')) return { plain: text };
  if (type.startsWith('text/html')) return { html: text };
  return {};
}

export function parseMail(raw: string): ParsedMail {
  const [head] = splitHeaderBody(raw);
  const r = walk(raw);
  const text = (r.plain ?? (r.html ? htmlToText(r.html) : '')).replace(/\r\n/g, '\n').trim();
  return { headers: parseHeaders(head), text };
}

/** "Name <a@b.c>" → { name, address }. */
export function parseAddress(v: string): { name?: string; address: string } {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  if (m) return { name: m[1].trim() || undefined, address: m[2].trim() };
  return { address: v.trim() };
}
