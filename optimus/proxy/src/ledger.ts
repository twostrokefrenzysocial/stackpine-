/**
 * The `Ledger` Durable Object: a single global instance (see index.ts) that
 * owns the monthly spend and rate-limit state. All logic lives in
 * ledgerCore.ts; this class only adapts it to the Workers runtime and exposes
 * it over Durable Object RPC.
 *
 * This file imports `cloudflare:workers`, so unit tests must not import it.
 */

import { DurableObject } from 'cloudflare:workers';
import {
  LedgerCore,
  parsePositive,
  type CheckOptions,
  type CheckResult,
  type LedgerApi,
  type UsageSnapshot,
} from './ledgerCore';

export interface LedgerEnv {
  DEFAULT_CAP_USD?: string;
  RATE_LIMIT_PER_MINUTE?: string;
}

export class Ledger extends DurableObject<LedgerEnv> implements LedgerApi {
  private readonly core: LedgerCore;

  constructor(ctx: DurableObjectState, env: LedgerEnv) {
    super(ctx, env);
    this.core = new LedgerCore(ctx.storage, {
      defaultCapUsd: parsePositive(env.DEFAULT_CAP_USD, 20),
      rateLimitPerMinute: Math.floor(parsePositive(env.RATE_LIMIT_PER_MINUTE, 30)),
    });
  }

  check(options: CheckOptions): Promise<CheckResult> {
    return this.core.check(options);
  }

  record(costUsd: number): Promise<UsageSnapshot> {
    return this.core.record(costUsd);
  }

  usage(): Promise<UsageSnapshot> {
    return this.core.usage();
  }

  setCap(capUsd: number): Promise<UsageSnapshot> {
    return this.core.setCap(capUsd);
  }
}
