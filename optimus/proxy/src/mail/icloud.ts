import type { OpenConn } from './conn';
import { imapDate, Imap, q } from './imap';
import { parseAddress, parseMail } from './mime';
import { smtpSend } from './smtp';

/**
 * iCloud Mail over IMAP (imap.mail.me.com) and SMTP (smtp.mail.me.com),
 * signed in with an app-specific password kept as a proxy secret. Apple
 * offers no sign-in API for third-party apps, so this is the supported way
 * mail apps connect.
 */

export const ICLOUD = { imap: { host: 'imap.mail.me.com', port: 993 }, smtp: { host: 'smtp.mail.me.com', port: 587 } };

export interface MailCreds {
  user: string;
  pass: string;
}

export interface MailItem {
  id: string;
  threadId: string;
  account: 'icloud';
  from: string;
  fromName?: string;
  to: string[];
  subject: string;
  snippet: string;
  body: string;
  date: string;
  unread: boolean;
  messageId?: string;
}

function toItem(uid: number, flags: string[], raw: string, bodyLimit: number): MailItem {
  const m = parseMail(raw);
  const from = parseAddress(m.headers.from ?? '');
  const date = Date.parse(m.headers.date ?? '');
  const body = m.text.slice(0, bodyLimit);
  return {
    id: `icloud:${uid}`,
    threadId: (m.headers['references'] ?? m.headers['in-reply-to'] ?? m.headers['message-id'] ?? `icloud:${uid}`).split(/\s+/)[0],
    account: 'icloud',
    from: from.address,
    fromName: from.name,
    to: (m.headers.to ?? '')
      .split(',')
      .map((a) => parseAddress(a).address)
      .filter(Boolean),
    subject: m.headers.subject ?? '(no subject)',
    snippet: body.replace(/\s+/g, ' ').slice(0, 200),
    body,
    date: Number.isFinite(date) ? new Date(date).toISOString() : new Date(0).toISOString(),
    unread: !flags.some((f) => /\\Seen/i.test(f)),
    messageId: m.headers['message-id'],
  };
}

async function session<T>(open: OpenConn, creds: MailCreds, fn: (imap: Imap) => Promise<T>): Promise<T> {
  const imap = new Imap(open(ICLOUD.imap.host, ICLOUD.imap.port, 'on'));
  try {
    await imap.greeting();
    await imap.login(creds.user, creds.pass);
    await imap.select('INBOX');
    return await fn(imap);
  } finally {
    await imap.logout();
  }
}

export function searchCriteria(qy: { query?: string; from?: string; unreadOnly?: boolean; since?: string; until?: string }): string {
  const parts: string[] = [];
  if (qy.unreadOnly) parts.push('UNSEEN');
  if (qy.since) parts.push(`SINCE ${imapDate(qy.since)}`);
  if (qy.until) parts.push(`BEFORE ${imapDate(new Date(Date.parse(qy.until) + 86_400_000).toISOString())}`);
  if (qy.from) parts.push(`FROM ${q(qy.from)}`);
  if (qy.query) parts.push(`TEXT ${q(qy.query)}`);
  return parts.length ? parts.join(' ') : 'ALL';
}

export async function icloudSearch(open: OpenConn, creds: MailCreds, qy: { query?: string; from?: string; unreadOnly?: boolean; since?: string; until?: string; limit?: number }): Promise<MailItem[]> {
  const limit = Math.min(Math.max(qy.limit ?? 15, 1), 30);
  return session(open, creds, async (imap) => {
    const uids = (await imap.uidSearch(searchCriteria(qy))).slice(-limit);
    const msgs = await imap.fetch(uids, 16_000);
    return msgs.map((m) => toItem(m.uid, m.flags, m.raw, 1500)).sort((a, b) => b.date.localeCompare(a.date));
  });
}

export async function icloudGet(open: OpenConn, creds: MailCreds, id: string): Promise<MailItem | null> {
  const uid = Number(id.replace(/^icloud:/, ''));
  if (!uid) return null;
  return session(open, creds, async (imap) => {
    const [m] = await imap.fetch([uid], 200_000);
    return m ? toItem(m.uid, m.flags, m.raw, 20_000) : null;
  });
}

const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

function utf8Base64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
}

export function buildMessage(d: { from: string; to: string[]; subject: string; body: string; inReplyTo?: string; now?: Date }): string {
  const subject = clean(d.subject);
  const encSubject = /^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${utf8Base64(subject)}?=`;
  const bodyB64 = utf8Base64(d.body)
    .match(/.{1,76}/g)
    ?.join('\r\n');
  const headers = [
    `From: ${clean(d.from)}`,
    `To: ${d.to.map(clean).join(', ')}`,
    `Subject: ${encSubject}`,
    `Date: ${(d.now ?? new Date()).toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@optimus.local>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    ...(d.inReplyTo ? [`In-Reply-To: ${clean(d.inReplyTo)}`, `References: ${clean(d.inReplyTo)}`] : []),
  ];
  return `${headers.join('\r\n')}\r\n\r\n${bodyB64 ?? ''}`;
}

export async function icloudSend(open: OpenConn, creds: MailCreds, d: { to: string[]; subject: string; body: string; inReplyToId?: string }): Promise<{ id: string }> {
  const to = d.to.map((a) => a.trim()).filter((a) => /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(a));
  if (!to.length) throw new Error('No valid recipient address');
  let inReplyTo: string | undefined;
  let subject = d.subject;
  if (d.inReplyToId) {
    const orig = await icloudGet(open, creds, d.inReplyToId).catch(() => null);
    inReplyTo = orig?.messageId;
    if (orig && !subject) subject = /^re:/i.test(orig.subject) ? orig.subject : `Re: ${orig.subject}`;
  }
  await smtpSend(open(ICLOUD.smtp.host, ICLOUD.smtp.port, 'starttls'), { user: creds.user, pass: creds.pass, from: creds.user, to, message: buildMessage({ from: creds.user, to, subject, body: d.body, inReplyTo }) });
  return { id: `icloud:sent:${Date.now()}` };
}
