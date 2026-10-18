import type { Conn, OpenConn } from '../src/mail/conn';
import { buildMessage, icloudGet, icloudSearch, icloudSend, searchCriteria } from '../src/mail/icloud';
import { parseMail } from '../src/mail/mime';

const enc = new TextEncoder();
const bin = (s: string) => Uint8Array.from(enc.encode(s));

const MAIL_1 = [
  'From: =?UTF-8?B?Sm9zw6kgUnVpeg==?= <jose@example.com>',
  'To: chris@icloud.com',
  'Subject: Dinner Saturday?',
  'Date: Sat, 17 Oct 2026 18:30:00 -0400',
  'Message-ID: <abc123@example.com>',
  'Content-Type: multipart/alternative; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Are you guys coming to Mom=E2=80=99s birthday dinner? She wants a headcount.',
  '--b1',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Are you guys coming?</p>',
  '--b1--',
  '',
].join('\r\n');

/** A scripted IMAP server: answers each tagged command. */
function fakeImap(log: string[]): Conn {
  const queue: Uint8Array[] = [bin('* OK IMAP ready\r\n')];
  let waiting: ((v: Uint8Array | null) => void) | null = null;
  const push = (s: string) => {
    const b = bin(s);
    if (waiting) {
      const w = waiting;
      waiting = null;
      w(b);
    } else queue.push(b);
  };
  return {
    async read() {
      if (queue.length) return queue.shift()!;
      return new Promise((r) => (waiting = r));
    },
    async write(data) {
      log.push(data.trim());
      const [tag, ...rest] = data.trim().split(' ');
      const cmd = rest.join(' ');
      if (/^LOGIN/.test(cmd)) push(cmd.includes('"wrong"') ? `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n` : `${tag} OK logged in\r\n`);
      else if (/^SELECT/.test(cmd)) push(`* 2 EXISTS\r\n${tag} OK [READ-WRITE] done\r\n`);
      else if (/^UID SEARCH/.test(cmd)) push(`* SEARCH 41 42\r\n${tag} OK done\r\n`);
      else if (/^UID FETCH/.test(cmd)) {
        const bytes = enc.encode(MAIL_1).length;
        const uids = cmd.split(' ')[2].split(',');
        let out = '';
        uids.forEach((u, i) => (out += `* ${i + 1} FETCH (UID ${u} FLAGS (${u === '42' ? '' : '\\Seen'}) BODY[]<0> {${bytes}}\r\n${MAIL_1})\r\n`));
        push(`${out}${tag} OK done\r\n`);
      } else if (/^LOGOUT/.test(cmd)) push(`* BYE\r\n${tag} OK bye\r\n`);
      else push(`${tag} BAD unknown\r\n`);
    },
    async close() {},
  };
}

function fakeSmtp(log: string[]): Conn {
  const queue: string[] = ['220 smtp ready\r\n'];
  let waiting: ((v: Uint8Array | null) => void) | null = null;
  let inData = false;
  const push = (s: string) => {
    if (waiting) {
      const w = waiting;
      waiting = null;
      w(bin(s));
    } else queue.push(s);
  };
  const conn: Conn = {
    async read() {
      if (queue.length) return bin(queue.shift()!);
      return new Promise((r) => (waiting = r));
    },
    async write(data) {
      log.push(data);
      if (inData) {
        if (data.endsWith('\r\n.\r\n')) {
          inData = false;
          push('250 queued\r\n');
        }
        return;
      }
      const l = data.trim();
      if (l.startsWith('EHLO')) push('250-smtp.mail.me.com\r\n250 STARTTLS\r\n');
      else if (l === 'STARTTLS') push('220 go ahead\r\n');
      else if (l.startsWith('AUTH PLAIN')) push('235 ok\r\n');
      else if (l.startsWith('MAIL FROM') || l.startsWith('RCPT TO')) push('250 ok\r\n');
      else if (l === 'DATA') {
        inData = true;
        push('354 go\r\n');
      } else if (l === 'QUIT') push('221 bye\r\n');
    },
    async close() {},
    startTls() {
      log.push('<<TLS>>');
      return conn;
    },
  };
  return conn;
}

describe('iCloud Mail', () => {
  const creds = { user: 'chris@icloud.com', pass: 'abcd-efgh-ijkl-mnop' };

  it('parses MIME: encoded names, quoted-printable UTF-8, plain text preferred over HTML', () => {
    const m = parseMail(String.fromCharCode(...enc.encode(MAIL_1)));
    expect(m.headers.from).toBe('José Ruiz <jose@example.com>');
    expect(m.text).toBe('Are you guys coming to Mom’s birthday dinner? She wants a headcount.');
  });

  it('builds IMAP searches from the app’s filters', () => {
    expect(searchCriteria({ unreadOnly: true, since: '2026-10-16T00:00:00Z', from: 'jose@example.com', query: 'dinner' })).toBe('UNSEEN SINCE 16-Oct-2026 FROM "jose@example.com" TEXT "dinner"');
    expect(searchCriteria({})).toBe('ALL');
  });

  it('searches the inbox and returns readable messages, newest first, with unread flags', async () => {
    const log: string[] = [];
    const open: OpenConn = () => fakeImap(log);
    const list = await icloudSearch(open, creds, { unreadOnly: true, limit: 10 });
    expect(log.some((l) => /LOGIN "chris@icloud.com" "abcd-efgh-ijkl-mnop"/.test(l))).toBe(true);
    expect(log.some((l) => /UID SEARCH UNSEEN/.test(l))).toBe(true);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ account: 'icloud', from: 'jose@example.com', fromName: 'José Ruiz', subject: 'Dinner Saturday?' });
    expect(list.find((m) => m.id === 'icloud:42')?.unread).toBe(true);
    expect(list.find((m) => m.id === 'icloud:41')?.unread).toBe(false);
    const one = await icloudGet(open, creds, 'icloud:41');
    expect(one?.body).toMatch(/headcount/);
  });

  it('reports a rejected app-specific password', async () => {
    await expect(icloudSearch(() => fakeImap([]), { user: 'chris@icloud.com', pass: 'wrong' }, {})).rejects.toThrow(/AUTHENTICATIONFAILED/);
  });

  it('sends over SMTP with STARTTLS as a reply in the same thread', async () => {
    const imapLog: string[] = [];
    const smtpLog: string[] = [];
    const open: OpenConn = (host) => (host.startsWith('smtp') ? fakeSmtp(smtpLog) : fakeImap(imapLog));
    await icloudSend(open, creds, { to: ['jose@example.com'], subject: '', body: 'Count us in — 4 of us.', inReplyToId: 'icloud:41' });
    expect(smtpLog.indexOf('<<TLS>>')).toBeGreaterThan(smtpLog.findIndex((l) => l.startsWith('STARTTLS')));
    expect(smtpLog.some((l) => l.startsWith('RCPT TO:<jose@example.com>'))).toBe(true);
    const data = smtpLog.find((l) => l.includes('Subject:'))!;
    expect(data).toMatch(/Subject: Re: Dinner Saturday\?/);
    expect(data).toMatch(/In-Reply-To: <abc123@example.com>/);
  });

  it('strips header injection from what it sends', () => {
    const m = buildMessage({ from: 'a@icloud.com', to: ['b@x.com\r\nBcc: evil@x.com'], subject: 'Hi\r\nBcc: evil@x.com', body: 'x' });
    expect(m.split('\r\n\r\n')[0]).not.toMatch(/^Bcc:/m);
  });
});
