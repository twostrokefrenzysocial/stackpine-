import { Reader, type Conn } from './conn';

export interface FetchedMessage {
  uid: number;
  flags: string[];
  raw: string;
}

/** IMAP quoted string. */
export function q(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ')}"`;
}

/**
 * The few IMAP commands Optimus needs: log in, open a mailbox, search, and
 * fetch messages (headers and the start of the body).
 */
export class Imap {
  private reader: Reader;
  private tag = 0;

  constructor(private conn: Conn) {
    this.reader = new Reader(conn);
  }

  async greeting(): Promise<void> {
    const l = await this.reader.line();
    if (!/^\* (OK|PREAUTH)/i.test(l)) throw new Error('Unexpected IMAP greeting');
  }

  /** Runs a command; returns untagged responses, each with any literals it carried. */
  async command(cmd: string): Promise<{ line: string; literals: string[] }[]> {
    const t = `A${++this.tag}`;
    await this.conn.write(`${t} ${cmd}\r\n`);
    const out: { line: string; literals: string[] }[] = [];
    for (;;) {
      let line = await this.reader.line();
      if (line.startsWith(`${t} `)) {
        if (!/^\S+ OK/i.test(line)) throw new ImapError(line.slice(t.length + 1));
        return out;
      }
      const literals: string[] = [];
      let m: RegExpMatchArray | null;
      while ((m = line.match(/\{(\d+)\}$/))) {
        literals.push(await this.reader.bytes(Number(m[1])));
        line = `${line}<<literal>>${await this.reader.line()}`;
      }
      out.push({ line, literals });
    }
  }

  async login(user: string, pass: string): Promise<void> {
    await this.command(`LOGIN ${q(user)} ${q(pass)}`);
  }

  async select(box = 'INBOX'): Promise<void> {
    await this.command(`SELECT ${q(box)}`);
  }

  async uidSearch(criteria: string): Promise<number[]> {
    const res = await this.command(`UID SEARCH ${criteria}`);
    const ids: number[] = [];
    for (const r of res) {
      const m = r.line.match(/^\* SEARCH ?(.*)$/i);
      if (m) ids.push(...m[1].split(/\s+/).filter(Boolean).map(Number));
    }
    return ids.sort((a, b) => a - b);
  }

  /** Fetches flags and up to `maxBytes` of each message. */
  async fetch(uids: number[], maxBytes: number): Promise<FetchedMessage[]> {
    if (!uids.length) return [];
    const res = await this.command(`UID FETCH ${uids.join(',')} (UID FLAGS BODY.PEEK[]<0.${maxBytes}>)`);
    const out: FetchedMessage[] = [];
    for (const r of res) {
      if (!/^\* \d+ FETCH/i.test(r.line)) continue;
      const uid = Number(r.line.match(/UID (\d+)/i)?.[1]);
      const flags = (r.line.match(/FLAGS \(([^)]*)\)/i)?.[1] ?? '').split(/\s+/).filter(Boolean);
      if (uid) out.push({ uid, flags, raw: r.literals[0] ?? '' });
    }
    return out;
  }

  async logout(): Promise<void> {
    await this.command('LOGOUT').catch(() => undefined);
    await this.conn.close().catch(() => undefined);
  }
}

export class ImapError extends Error {}

/** "18-Oct-2026" for SEARCH SINCE. */
export function imapDate(iso: string): string {
  const d = new Date(iso);
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${d.getUTCDate()}-${m}-${d.getUTCFullYear()}`;
}
