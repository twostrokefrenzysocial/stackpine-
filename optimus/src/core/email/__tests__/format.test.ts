import { b64urlDecode, b64urlEncode, buildRfc822, fromGmail, fromGraph, gmailQuery, htmlToText, parseAddress } from '../format';

describe('email format helpers', () => {
  it('round-trips base64url with UTF-8', () => {
    const s = 'Café ☕ — résumé';
    expect(b64urlDecode(b64urlEncode(s))).toBe(s);
    expect(b64urlEncode(s)).not.toMatch(/[+/=]/);
  });

  it('parses addresses', () => {
    expect(parseAddress('"Sarah Chen" <sarah@x.com>')).toEqual({ name: 'Sarah Chen', email: 'sarah@x.com' });
    expect(parseAddress('bob@x.com')).toEqual({ email: 'bob@x.com' });
  });

  it('maps a Gmail message, preferring text/plain', () => {
    const m = fromGmail({
      id: 'abc',
      threadId: 't1',
      snippet: 'Hi there',
      internalDate: String(Date.parse('2026-10-17T10:00:00Z')),
      labelIds: ['UNREAD', 'IMPORTANT', 'INBOX'],
      payload: {
        mimeType: 'multipart/alternative',
        headers: [
          { name: 'From', value: 'Sarah Chen <sarah@x.com>' },
          { name: 'To', value: 'me@x.com' },
          { name: 'Subject', value: 'Proposal' },
          { name: 'Message-ID', value: '<m1@x.com>' },
        ],
        parts: [
          { mimeType: 'text/html', body: { data: b64urlEncode('<p>HTML</p>') } },
          { mimeType: 'text/plain', body: { data: b64urlEncode('Plain body') } },
        ],
      },
    });
    expect(m).toMatchObject({ id: 'gmail:abc', from: 'sarah@x.com', fromName: 'Sarah Chen', subject: 'Proposal', body: 'Plain body', unread: true, important: true, messageIdHeader: '<m1@x.com>' });
  });

  it('builds Gmail queries', () => {
    expect(gmailQuery({ query: 'proposal', from: 'sarah@x.com', unreadOnly: true, since: '2026-10-17T00:00:00Z' })).toBe(
      `proposal from:sarah@x.com is:unread after:${Date.parse('2026-10-17T00:00:00Z') / 1000} in:inbox`,
    );
  });

  it('builds a threaded reply and blocks header injection', () => {
    const raw = buildRfc822({ to: ['sarah@x.com'], subject: 'Re: Proposal\r\nBcc: evil@x.com', body: 'Looks great.' }, { messageIdHeader: '<m1@x.com>' });
    const headers = raw.split('\r\n\r\n')[0].split('\r\n');
    expect(headers.some((h) => h.startsWith('Bcc:'))).toBe(false);
    expect(headers).toContain('In-Reply-To: <m1@x.com>');
    expect(raw.endsWith('Looks great.')).toBe(true);
  });

  it('maps Graph messages and strips HTML', () => {
    const m = fromGraph({ id: 'g1', conversationId: 'c1', subject: 'Hello', body: { contentType: 'html', content: '<div>Hi&nbsp;<b>there</b></div><br>Bye' }, from: { emailAddress: { address: 'd@x.com', name: 'Dave' } }, receivedDateTime: '2026-10-17T10:00:00Z', isRead: false, importance: 'high' });
    expect(m).toMatchObject({ id: 'outlook:g1', fromName: 'Dave', unread: true, important: true });
    expect(m.body).toBe('Hi there\nBye');
    expect(htmlToText('<script>x()</script><p>A</p><p>B</p>')).toBe('A\nB');
  });
});
