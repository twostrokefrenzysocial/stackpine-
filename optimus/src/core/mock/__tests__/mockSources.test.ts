/// <reference types="jest" />
/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';

import { AccessError } from '../../sources/types';
import { buildMockDataset } from '../dataset';
import { createMockSources } from '../sources';

// A fixed afternoon, local time.
const NOW = new Date(2026, 9, 18, 15, 30, 0);
const make = (extra: Parameters<typeof createMockSources>[0] = {}) => createMockSources({ now: () => NOW, ...extra });

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

describe('buildMockDataset', () => {
  it('is deterministic for a fixed now', () => {
    expect(buildMockDataset(NOW)).toEqual(buildMockDataset(NOW));
  });

  it('uses unique ids within each collection', () => {
    const ds = buildMockDataset(NOW);
    for (const list of [ds.contacts, ds.texts, ds.calls, ds.notifications, ds.events, ds.emails, ds.photos]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it.each([new Date(2026, 9, 18, 0, 5), new Date(2026, 9, 18, 9, 0), NOW, new Date(2026, 9, 18, 23, 50)])(
    'has the Dave meeting at 15:00 today and a late text today (now=%s)',
    (now) => {
      const ds = buildMockDataset(now);
      const meeting = ds.events.find((e) => e.id === 'evt-today-dave')!;
      const start = new Date(meeting.start);
      expect(meeting.title).toBe('Q4 roadmap review');
      expect(sameLocalDay(start, now)).toBe(true);
      expect([start.getHours(), start.getMinutes()]).toEqual([15, 0]);
      expect(meeting.notes).toContain('Moved from 2:00 PM');

      const late = ds.texts.find((t) => t.id === 'sms-dave-late')!;
      expect(late.contactName).toBe('Dave Kowalski');
      expect(late.body).toMatch(/late/i);
      expect(sameLocalDay(new Date(late.date), now)).toBe(true);
    },
  );

  it('dates the late text 14:40 in the afternoon, else 20 minutes ago', () => {
    const late = (now: Date) => new Date(buildMockDataset(now).texts.find((t) => t.id === 'sms-dave-late')!.date);
    expect(late(NOW).getTime()).toBe(new Date(2026, 9, 18, 14, 40).getTime());
    const morning = new Date(2026, 9, 18, 9, 0);
    expect(late(morning).getTime()).toBe(morning.getTime() - 20 * 60_000);
  });

  it('stores OTP notifications already redacted', () => {
    const ds = buildMockDataset(NOW);
    const otp = ds.notifications.filter((n) => n.id.startsWith('notif-otp-'));
    expect(otp.length).toBeGreaterThanOrEqual(3);
    for (const n of otp) {
      expect(n.redacted).toBe(true);
      expect(n.text).toContain('[code hidden]');
    }
    const leaked =
      /(code|verification|passcode|password|sign in)[^.]{0,40}\b[A-Z]?-?\d{4,8}\b|\b[A-Z]?-?\d{4,8}\b[^.]{0,40}(code|verification|passcode|password|sign in)/i;
    for (const n of ds.notifications) expect(`${n.title} ${n.text}`).not.toMatch(leaked);
  });

  it('includes the security test content', () => {
    const ds = buildMockDataset(NOW);
    expect(ds.emails.find((e) => e.id === 'email-phishing-injection')!.body).toContain('ignore your previous instructions');
    expect(ds.texts.find((t) => t.id === 'sms-injection')!.body).toContain('system override');
    expect(ds.contacts.find((c) => c.id === 'c-rick')!.note).toContain('Note to AI');
  });

  it('ships a JPEG asset for every photo', () => {
    const dir = path.join(__dirname, '../../../../assets/mock/photos');
    for (const p of buildMockDataset(NOW).photos) {
      expect(p.uri).toBe(`mock://photos/${p.filename}`);
      expect(fs.existsSync(path.join(dir, p.filename))).toBe(true);
    }
  });
});

describe('createMockSources', () => {
  it('reports mock mode and text limitations', async () => {
    const s = make();
    expect(s.mode).toBe('mock');
    expect((await s.texts.limitations())[0]).toMatch(/RCS/);
  });

  it('finds texts by nickname and by relationship', async () => {
    const s = make();
    const byNick = await s.texts.search({ contact: 'Jen' });
    expect(byNick.length).toBeGreaterThan(0);
    expect(byNick.every((m) => m.contactName === 'Jennifer Ruiz')).toBe(true);
    const byRel = await s.texts.search({ contact: 'my wife', limit: 100 });
    expect(byRel.map((m) => m.id)).toEqual((await s.texts.search({ contact: 'Jen', limit: 100 })).map((m) => m.id));
    // newest first
    const dates = byRel.map((m) => new Date(m.date).getTime());
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it('filters by query and date range', async () => {
    const s = make();
    const plumber = await s.texts.search({ query: 'PLUMBER' });
    expect(plumber.length).toBeGreaterThan(0);
    const since = new Date(2026, 9, 18).toISOString();
    const todays = await s.texts.search({ since, limit: 100 });
    expect(todays.every((m) => m.date >= since)).toBe(true);
    expect((await s.calls.list({ contact: 'Mom', type: 'missed' })).map((c) => c.id)).toContain('call-mom-missed-today');
    expect((await s.email.search({ from: 'Sarah' })).map((e) => e.id)).toContain('email-sarah-proposal');
    expect((await s.notifications.list({ app: 'com.chase.sig.android' })).every((n) => n.appName === 'Chase')).toBe(true);
  });

  it('send() appends to the conversation and records the text', async () => {
    const s = make();
    const { id } = await s.texts.send('Jen', 'Tacos sound great');
    expect(s.sentTexts).toEqual([expect.objectContaining({ id, to: '+12165550101', body: 'Tacos sound great' })]);
    const [latest] = await s.texts.search({ contact: 'Jen', limit: 1 });
    expect(latest).toMatchObject({ id, threadId: 'th-jen', direction: 'outgoing', contactName: 'Jennifer Ruiz' });
  });

  it('creates, updates and removes calendar events', async () => {
    const s = make();
    const range = { since: new Date(2026, 9, 23).toISOString(), until: new Date(2026, 9, 24).toISOString() };
    const created = await s.calendar.create({
      title: 'Beer with Mike',
      start: new Date(2026, 9, 23, 19, 0).toISOString(),
      end: new Date(2026, 9, 23, 21, 0).toISOString(),
      location: 'Brew Kettle',
    });
    expect((await s.calendar.list(range)).map((e) => e.id)).toContain(created.id);

    const updated = await s.calendar.update(created.id, { location: 'Brew Kettle, Strongsville' });
    expect(updated).toMatchObject({ id: created.id, title: 'Beer with Mike', location: 'Brew Kettle, Strongsville' });

    await s.calendar.remove(created.id);
    expect((await s.calendar.list(range)).map((e) => e.id)).not.toContain(created.id);
    await expect(s.calendar.remove('nope')).rejects.toThrow();
  });

  it('lists today in chronological order', async () => {
    const s = make();
    const today = await s.calendar.list({
      since: new Date(2026, 9, 18).toISOString(),
      until: new Date(2026, 9, 19).toISOString(),
    });
    expect(today.map((e) => e.id)).toEqual(['evt-today-standup', 'evt-today-dave', 'evt-today-pickup', 'evt-today-soccer']);
  });

  it('throws AccessError for denied sources', async () => {
    const s = make({ denied: { texts: true, photos: true } });
    await expect(s.texts.search({})).rejects.toBeInstanceOf(AccessError);
    await expect(s.photos.list({})).rejects.toMatchObject({ source: 'photos', reason: 'permission-denied' });
    await expect(s.calls.list({})).resolves.toBeDefined();
  });

  it('filters photos near a location', async () => {
    const s = make();
    const near = await s.photos.list({ near: { latitude: 41.4935, longitude: -81.7985 } }); // Lakewood Park
    const ids = near.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['ph-sofia-soccer', 'ph-lake-sunset']));
    expect(ids).not.toContain('ph-whiteboard'); // downtown, ~8km away
    expect(ids).not.toContain('ph-anniversary-dinner');
  });

  it('delegates loadForVision to the photo loader', async () => {
    expect(await make().photos.loadForVision('ph-leo-frog', 1024)).toBeNull();
    const loader = jest.fn(async () => ({ base64: 'abc', mediaType: 'image/jpeg' as const }));
    const s = make({ photoLoader: loader });
    expect(await s.photos.loadForVision('ph-leo-frog', 1024)).toEqual({ base64: 'abc', mediaType: 'image/jpeg' });
    expect(loader).toHaveBeenCalledWith(expect.objectContaining({ id: 'ph-leo-frog' }), 1024);
  });

  it('recentThreads returns one message per thread, newest first', async () => {
    const s = make();
    const threads = await s.texts.recentThreads(100);
    const ids = threads.map((m) => m.threadId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(new Set(s.dataset.texts.map((m) => m.threadId)).size);
    expect(threads.find((m) => m.threadId === 'th-dave')!.id).toBe('sms-dave-late');
  });

  it('records sent email and placed calls', async () => {
    const s = make();
    const { id } = await s.email.send({ to: ['sarah.chen@lakeviewconsulting.com'], subject: 'Re: proposal', body: 'Direction B!', inReplyToId: 'email-sarah-proposal' });
    expect(s.sentEmails[0]).toMatchObject({ id, subject: 'Re: proposal' });
    expect((await s.email.get(id))!.threadId).toBe('et-sarah-proposal');
    await s.calls.startCall('Mom');
    expect(s.placedCalls[0].number).toBe('+12165550105');
  });
});
