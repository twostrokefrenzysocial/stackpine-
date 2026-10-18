import { LedgerCore, monthOf, parsePositive } from '../src/ledgerCore';
import { fakeClock, MemoryStorage } from './helpers';

function makeLedger(start = '2026-10-18T12:00:00Z', config = { defaultCapUsd: 20, rateLimitPerMinute: 3 }) {
  const clock = fakeClock(start);
  const storage = new MemoryStorage();
  return { ledger: new LedgerCore(storage, config, clock.now), clock, storage };
}

describe('LedgerCore', () => {
  it('reports an empty month with the default cap', async () => {
    const { ledger } = makeLedger();
    await expect(ledger.usage()).resolves.toEqual({
      month: '2026-10',
      spentUsd: 0,
      capUsd: 20,
      requests: 0,
      remainingUsd: 20,
      rateLimitPerMinute: 3,
    });
  });

  it('accumulates spend and request counts', async () => {
    const { ledger } = makeLedger();
    await ledger.record(1.25);
    const snap = await ledger.record(0.5);
    expect(snap).toMatchObject({ spentUsd: 1.75, requests: 2, remainingUsd: 18.25 });
  });

  it('blocks billable requests once spend reaches the cap, but not count_tokens', async () => {
    const { ledger } = makeLedger();
    await ledger.record(20);
    await expect(ledger.check({ enforceCap: true })).resolves.toEqual({
      ok: false,
      reason: 'spending_cap',
      spentUsd: 20,
      capUsd: 20,
    });
    await expect(ledger.check({ enforceCap: false })).resolves.toEqual({ ok: true });
  });

  it('resets spend when the UTC month changes and keeps the cap', async () => {
    const { ledger, clock } = makeLedger('2026-10-31T23:59:59Z');
    await ledger.setCap(5);
    await ledger.record(5);
    expect((await ledger.check({ enforceCap: true })).ok).toBe(false);

    clock.set('2026-11-01T00:00:00Z');
    expect(await ledger.usage()).toMatchObject({ month: '2026-11', spentUsd: 0, requests: 0, capUsd: 5 });
    expect((await ledger.check({ enforceCap: true })).ok).toBe(true);

    clock.set('2026-10-31T23:00:00Z'); // the old month's history is still there
    expect((await ledger.usage()).spentUsd).toBe(5);
  });

  it('enforces a sliding one-minute rate limit with an accurate retry-after', async () => {
    const { ledger, clock } = makeLedger();
    expect((await ledger.check({ enforceCap: true })).ok).toBe(true); // t=0
    clock.advance(10_000);
    expect((await ledger.check({ enforceCap: true })).ok).toBe(true); // t=10s
    clock.advance(10_000);
    expect((await ledger.check({ enforceCap: false })).ok).toBe(true); // t=20s

    clock.advance(5_000); // t=25s; the first slot frees at t=60s
    await expect(ledger.check({ enforceCap: true })).resolves.toEqual({
      ok: false,
      reason: 'rate_limited',
      retryAfterSeconds: 35,
    });

    clock.advance(35_000); // t=60s
    expect((await ledger.check({ enforceCap: true })).ok).toBe(true);
  });

  it('does not consume a rate-limit slot for a request rejected by the cap', async () => {
    const { ledger, storage } = makeLedger();
    await ledger.record(25);
    await ledger.check({ enforceCap: true });
    expect(storage.data.get('rate:log')).toBeUndefined();
  });

  it('validates setCap', async () => {
    const { ledger } = makeLedger();
    await expect(ledger.setCap(0)).rejects.toThrow(RangeError);
    await expect(ledger.setCap(1000.01)).rejects.toThrow(RangeError);
    await expect(ledger.setCap(1000)).resolves.toMatchObject({ capUsd: 1000 });
  });

  it('ignores negative or non-finite costs but still counts the request', async () => {
    const { ledger } = makeLedger();
    expect(await ledger.record(-3)).toMatchObject({ spentUsd: 0, requests: 1 });
    expect(await ledger.record(NaN)).toMatchObject({ spentUsd: 0, requests: 2 });
  });
});

describe('helpers', () => {
  it('monthOf uses UTC', () => {
    expect(monthOf(Date.parse('2026-12-31T23:30:00-05:00'))).toBe('2027-01');
  });

  it('parsePositive falls back on bad input', () => {
    expect(parsePositive('12.5', 20)).toBe(12.5);
    expect(parsePositive('', 20)).toBe(20);
    expect(parsePositive('-1', 20)).toBe(20);
    expect(parsePositive('abc', 20)).toBe(20);
    expect(parsePositive(undefined, 30)).toBe(30);
  });
});
