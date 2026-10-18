import type { EmailMessage } from '../types';

/** Pure helpers for Gmail and Microsoft Graph payloads (unit tested). */

// UTF-8 by hand: TextDecoder isn't guaranteed on the phone's JS engine.
function utf8Encode(s: string): string {
  return unescape(encodeURIComponent(s));
}
function utf8Decode(bin: string): string {
  try {
    return decodeURIComponent(escape(bin));
  } catch {
    return bin;
  }
}

export function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return utf8Decode(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
}

export function b64urlEncode(s: string): string {
  return btoa(utf8Encode(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, all) => l || (i > 0 && all[i - 1]))
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function parseAddress(v: string): { email: string; name?: string } {
  const m = v.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: v.trim() };
}

export interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
}

function findPart(part: GmailPart | undefined, mime: string): GmailPart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mime && part.body?.data) return part;
  for (const p of part.parts ?? []) {
    const hit = findPart(p, mime);
    if (hit) return hit;
  }
  return undefined;
}

/** Prefers text/plain anywhere in the tree; falls back to stripped HTML. */
export function gmailText(part: GmailPart | undefined): string {
  const plain = findPart(part, 'text/plain');
  if (plain?.body?.data) return b64urlDecode(plain.body.data);
  const html = findPart(part, 'text/html');
  return html?.body?.data ? htmlToText(b64urlDecode(html.body.data)) : '';
}

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate: string;
  labelIds?: string[];
  payload?: GmailPart;
}

export function fromGmail(m: GmailMessage): EmailMessage & { messageIdHeader?: string } {
  const h = (name: string) => (m.payload?.headers ?? []).find((x) => x.name.toLowerCase() === name)?.value ?? '';
  const from = parseAddress(h('from'));
  return {
    id: `gmail:${m.id}`,
    threadId: m.threadId,
    account: 'gmail',
    from: from.email,
    fromName: from.name,
    to: h('to')
      .split(',')
      .map((x) => parseAddress(x).email)
      .filter(Boolean),
    subject: h('subject') || '(no subject)',
    snippet: m.snippet ?? '',
    body: gmailText(m.payload),
    date: new Date(Number(m.internalDate)).toISOString(),
    unread: (m.labelIds ?? []).includes('UNREAD'),
    important: (m.labelIds ?? []).includes('IMPORTANT'),
    labels: m.labelIds,
    messageIdHeader: h('message-id') || undefined,
  };
}

/** Gmail search syntax for our query shape. */
export function gmailQuery(q: { query?: string; from?: string; unreadOnly?: boolean; since?: string; until?: string }): string {
  return [
    q.query,
    q.from ? `from:${q.from}` : '',
    q.unreadOnly ? 'is:unread' : '',
    q.since ? `after:${Math.floor(Date.parse(q.since) / 1000)}` : '',
    q.until ? `before:${Math.floor(Date.parse(q.until) / 1000)}` : '',
    'in:inbox',
  ]
    .filter(Boolean)
    .join(' ');
}

/** RFC 822 message for Gmail's messages.send, threaded when replying. Header injection is stripped. */
export function buildRfc822(draft: { to: string[]; subject: string; body: string }, replyTo?: { messageIdHeader?: string }): string {
  const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
  const subject = clean(draft.subject);
  const encodedSubject = /^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${b64urlEncode(subject).replace(/-/g, '+').replace(/_/g, '/')}?=`;
  const headers = [
    `To: ${draft.to.map(clean).join(', ')}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    ...(replyTo?.messageIdHeader ? [`In-Reply-To: ${clean(replyTo.messageIdHeader)}`, `References: ${clean(replyTo.messageIdHeader)}`] : []),
  ];
  return `${headers.join('\r\n')}\r\n\r\n${draft.body}`;
}

export interface GraphMessage {
  id: string;
  conversationId: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string; contentType?: string };
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  receivedDateTime: string;
  isRead: boolean;
  importance?: string;
}

export function fromGraph(m: GraphMessage): EmailMessage {
  return {
    id: `outlook:${m.id}`,
    threadId: m.conversationId,
    account: 'outlook',
    from: m.from?.emailAddress?.address ?? '',
    fromName: m.from?.emailAddress?.name,
    to: (m.toRecipients ?? []).map((r) => r.emailAddress?.address ?? '').filter(Boolean),
    subject: m.subject || '(no subject)',
    snippet: m.bodyPreview ?? '',
    body: m.body?.contentType?.toLowerCase() === 'html' ? htmlToText(m.body.content ?? '') : (m.body?.content ?? ''),
    date: m.receivedDateTime,
    unread: !m.isRead,
    important: m.importance === 'high',
  };
}
