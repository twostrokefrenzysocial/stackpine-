export const RELOCK_AFTER_MS = 5 * 60_000;

/** Lock again after 5 minutes in the background. */
export function shouldRelock(backgroundedAt: number | null, now: number): boolean {
  return backgroundedAt != null && now - backgroundedAt >= RELOCK_AFTER_MS;
}
