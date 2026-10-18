/**
 * A byte stream to a mail server. In the Worker it wraps a TCP socket
 * (cloudflare:sockets); in tests it is a scripted fake.
 */
export interface Conn {
  read(): Promise<Uint8Array | null>;
  write(data: string): Promise<void>;
  close(): Promise<void>;
  /** Switch a plain connection to TLS (SMTP STARTTLS). */
  startTls?(): Conn;
}

export type OpenConn = (host: string, port: number, tls: 'on' | 'starttls') => Conn;

/** Line and byte reads over a Conn, as "binary strings" (one char per byte). */
export class Reader {
  private buf = new Uint8Array(0);
  constructor(private conn: Conn) {}

  setConn(conn: Conn) {
    this.conn = conn;
    this.buf = new Uint8Array(0);
  }

  private async fill(): Promise<boolean> {
    const chunk = await this.conn.read();
    if (!chunk) return false;
    const next = new Uint8Array(this.buf.length + chunk.length);
    next.set(this.buf);
    next.set(chunk, this.buf.length);
    this.buf = next;
    return true;
  }

  private take(n: number): string {
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    let s = '';
    for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode(...out.subarray(i, i + 8192));
    return s;
  }

  async line(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf(10);
      if (i >= 0) {
        const s = this.take(i + 1);
        return s.replace(/\r?\n$/, '');
      }
      if (!(await this.fill())) throw new Error('Mail server closed the connection');
    }
  }

  async bytes(n: number): Promise<string> {
    while (this.buf.length < n) if (!(await this.fill())) throw new Error('Mail server closed the connection');
    return this.take(n);
  }
}
