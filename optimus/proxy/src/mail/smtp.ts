import { Reader, type Conn } from './conn';

async function reply(reader: Reader): Promise<{ code: number; text: string }> {
  let text = '';
  for (;;) {
    const l = await reader.line();
    text += `${l.slice(4)}\n`;
    if (/^\d{3} /.test(l) || /^\d{3}$/.test(l)) return { code: Number(l.slice(0, 3)), text };
  }
}

/** Sends one message: EHLO, STARTTLS, AUTH PLAIN, MAIL, RCPT, DATA. */
export async function smtpSend(
  conn: Conn,
  opts: { user: string; pass: string; from: string; to: string[]; message: string; heloName?: string },
): Promise<void> {
  const reader = new Reader(conn);
  let c = conn;
  const expect = async (want: number) => {
    const r = await reply(reader);
    if (r.code !== want) throw new Error(`SMTP ${r.code}: ${r.text.trim().slice(0, 200)}`);
    return r;
  };
  const send = async (line: string, want: number) => {
    await c.write(`${line}\r\n`);
    return expect(want);
  };
  await expect(220);
  const helo = opts.heloName ?? 'optimus-proxy';
  await send(`EHLO ${helo}`, 250);
  if (c.startTls) {
    await send('STARTTLS', 220);
    c = c.startTls();
    reader.setConn(c);
    await send(`EHLO ${helo}`, 250);
  }
  await send(`AUTH PLAIN ${btoa(`\u0000${opts.user}\u0000${opts.pass}`)}`, 235);
  await send(`MAIL FROM:<${opts.from}>`, 250);
  for (const r of opts.to) await send(`RCPT TO:<${r}>`, 250);
  await send('DATA', 354);
  // Dot-stuff lines starting with "." and end with <CRLF>.<CRLF>.
  const body = opts.message.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  await c.write(`${body}\r\n.\r\n`);
  await expect(250);
  await c.write('QUIT\r\n').catch(() => undefined);
  await c.close().catch(() => undefined);
}
