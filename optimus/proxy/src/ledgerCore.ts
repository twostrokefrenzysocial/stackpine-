/**
 * Spending-cap and rate-limit bookkeeping, independent of the Workers runtime.
 *
 * `LedgerCore` is the whole implementation; the `Ledger` Durable Object in
 * ledger.ts is a thin wrapper that hands it `ctx.storage`. Keeping the logic
 * here lets unit tests drive it with an in-memory storage and a fake clock.
 *
 * Storage layout (Durable Object KV API):
 *   cap              number       monthly cap in USD, persists across months
 *   spend:YYYY-MM    MonthTotals  spend for one UTC calendar month
 *   rate:log         number[]     epoch-ms timestamps of recent admitted requests
 *
 * Old `spend:` keys are deliberately kept as a tiny monthly history.
 *
 * Concurrency: a Durable Object processes one event at a time while a storage
 * operation is in flight (input gates), and every await below is a storage
 * call, so each method's read-modify-write runs atomically.
 */

/** The subset of DurableObjectStorage this module needs. */
export interface KvStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export interface LedgerConfig {
  defaultCapUsd: number;
  rateLimitPerMinute: number;
}

export interface UsageSnapshot {
  month: string;
  spentUsd: number;
  capUsd: number;
  requests: number;
  remainingUsd: number;
  rateLimitPerMinute: number;
}

export type CheckResult =
  | { ok: true }
  | { ok: false; reason: 'spending_cap'; spentUsd: number; capUsd: number }
  | { ok: false; reason: 'rate_limited'; retryAfterSeconds: number };

export interface CheckOptions {
  /** Enforce the monthly cap (true for billable /v1/messages calls). */
  enforceCap: boolean;
}

/** The ledger operations the request handler depends on. */
export interface LedgerApi {
  /** Admits or rejects a request; an admitted request consumes a rate-limit slot. */
  check(options: CheckOptions): Promise<CheckResult>;
  /** Adds a completed request's cost to the current month. */
  record(costUsd: number): Promise<UsageSnapshot>;
  usage(): Promise<UsageSnapshot>;
  setCap(capUsd: number): Promise<UsageSnapshot>;
  /** Overwrites this month's spend, e.g. to match the provider's own bill. */
  setSpent(spentUsd: number): Promise<UsageSnapshot>;
}

interface MonthTotals {
  spentUsd: number;
  requests: number;
}

export const RATE_WINDOW_MS = 60_000;
export const MAX_CAP_USD = 1000;

const CAP_KEY = 'cap';
const RATE_KEY = 'rate:log';
const spendKey = (month: string) => `spend:${month}`;

/** UTC calendar month, e.g. "2026-10". */
export function monthOf(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 7);
}

/** Parses a positive number from an env var string, else returns `fallback`. */
export function parsePositive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isValidCap(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_CAP_USD;
}

/** Rounds to micro-dollars to keep floating-point noise out of responses. */
const roundUsd = (usd: number) => Math.round(usd * 1e6) / 1e6;

export class LedgerCore implements LedgerApi {
  constructor(
    private readonly storage: KvStorage,
    private readonly config: LedgerConfig,
    private readonly now: () => number = Date.now,
  ) {}

  async check({ enforceCap }: CheckOptions): Promise<CheckResult> {
    const now = this.now();

    // Cap first: a capped request should not burn a rate-limit slot.
    if (enforceCap) {
      const [capUsd, totals] = await Promise.all([this.cap(), this.totals(monthOf(now))]);
      if (totals.spentUsd >= capUsd) {
        return { ok: false, reason: 'spending_cap', spentUsd: roundUsd(totals.spentUsd), capUsd };
      }
    }

    // Sliding-window log: at most `limit` admissions in any 60 s span.
    const limit = this.config.rateLimitPerMinute;
    const windowStart = now - RATE_WINDOW_MS;
    const log = ((await this.storage.get<number[]>(RATE_KEY)) ?? []).filter((t) => t > windowStart);

    if (log.length >= limit) {
      // The oldest entries leave the window first; wait until enough have left.
      const freesAt = log[log.length - limit] + RATE_WINDOW_MS;
      const retryAfterSeconds = Math.max(1, Math.ceil((freesAt - now) / 1000));
      await this.storage.put(RATE_KEY, log); // persist the pruned log
      return { ok: false, reason: 'rate_limited', retryAfterSeconds };
    }

    log.push(now);
    await this.storage.put(RATE_KEY, log);
    return { ok: true };
  }

  async record(costUsd: number): Promise<UsageSnapshot> {
    const month = monthOf(this.now());
    const totals = await this.totals(month);
    const cost = Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0;
    const next: MonthTotals = { spentUsd: totals.spentUsd + cost, requests: totals.requests + 1 };
    await this.storage.put(spendKey(month), next);
    return this.snapshot(month, next, await this.cap());
  }

  async usage(): Promise<UsageSnapshot> {
    const month = monthOf(this.now());
    const [totals, capUsd] = await Promise.all([this.totals(month), this.cap()]);
    return this.snapshot(month, totals, capUsd);
  }

  async setCap(capUsd: number): Promise<UsageSnapshot> {
    if (!isValidCap(capUsd)) {
      throw new RangeError(`capUsd must be a number in (0, ${MAX_CAP_USD}]`);
    }
    await this.storage.put(CAP_KEY, capUsd);
    const month = monthOf(this.now());
    return this.snapshot(month, await this.totals(month), capUsd);
  }

  async setSpent(spentUsd: number): Promise<UsageSnapshot> {
    if (typeof spentUsd !== 'number' || !Number.isFinite(spentUsd) || spentUsd < 0 || spentUsd > MAX_CAP_USD) {
      throw new RangeError(`spentUsd must be a number in [0, ${MAX_CAP_USD}]`);
    }
    const month = monthOf(this.now());
    const totals = await this.totals(month);
    const next: MonthTotals = { spentUsd, requests: totals.requests };
    await this.storage.put(spendKey(month), next);
    return this.snapshot(month, next, await this.cap());
  }

  private async cap(): Promise<number> {
    const stored = await this.storage.get<number>(CAP_KEY);
    return isValidCap(stored) ? stored : this.config.defaultCapUsd;
  }

  private async totals(month: string): Promise<MonthTotals> {
    return (await this.storage.get<MonthTotals>(spendKey(month))) ?? { spentUsd: 0, requests: 0 };
  }

  private snapshot(month: string, totals: MonthTotals, capUsd: number): UsageSnapshot {
    return {
      month,
      spentUsd: roundUsd(totals.spentUsd),
      capUsd,
      requests: totals.requests,
      remainingUsd: roundUsd(Math.max(0, capUsd - totals.spentUsd)),
      rateLimitPerMinute: this.config.rateLimitPerMinute,
    };
  }
}
