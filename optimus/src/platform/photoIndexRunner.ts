import { AppState } from "react-native";
import { indexNextBatch, photoIndexStats } from "../core/photos/photoIndex";
import { proxyApi } from "./claude";
import type { Runtime } from "./runtime";
import { proxyToken } from "./secrets";

/** Background describing goes slowly so chat stays fast and the proxy's per-minute limit has room. */
const PAUSE_MS = 6000;
/** Stop describing once this share of the monthly cap is used; chat matters more. */
const BUDGET_SHARE = 0.8;

let running = false;
let stopRequested = false;

async function budgetOk(rt: Runtime): Promise<boolean> {
  const token = await proxyToken.get();
  if (!rt.settings.proxyUrl || !token) return false;
  try {
    const u = await proxyApi.usage(rt.settings.proxyUrl, token);
    return u.spentUsd < u.capUsd * BUDGET_SHARE;
  } catch {
    return false;
  }
}

function eligible(rt: Runtime): boolean {
  // The demo phone's photos come with descriptions, so they index offline.
  return (
    rt.settings.photoIndexEnabled &&
    (rt.settings.dataMode === "mock" || !rt.isDemoBrain())
  );
}

/**
 * Describes photos while the app is open, a batch every few seconds, until
 * the library is done, the app goes to the background, or the budget guard
 * trips. `maxBatches` bounds a background-task run.
 */
export async function runPhotoIndexing(
  rt: Runtime,
  opts: { maxBatches?: number; onProgress?: () => void } = {},
): Promise<void> {
  if (running || !eligible(rt)) return;
  running = true;
  stopRequested = false;
  try {
    const metered = rt.settings.dataMode === "real";
    if (metered && !(await budgetOk(rt))) return;
    for (let n = 0; !stopRequested && n < (opts.maxBatches ?? Infinity); n++) {
      if (
        !eligible(rt) ||
        (opts.maxBatches === undefined && AppState.currentState !== "active")
      )
        break;
      // Chat comes first: wait while a reply is in progress (and a few seconds after).
      if (rt.engine.activeTurns > 0) {
        await new Promise((r) => setTimeout(r, 3000));
        n--;
        continue;
      }
      const added = await indexNextBatch({
        db: rt.db,
        photos: rt.sources().photos,
        llm: rt.background(),
      }).catch(() => -1);
      if (added === 0) break;
      opts.onProgress?.();
      if (metered && n % 20 === 19 && !(await budgetOk(rt))) break;
      await new Promise((r) =>
        setTimeout(r, added < 0 ? PAUSE_MS * 5 : PAUSE_MS),
      );
    }
  } finally {
    running = false;
  }
}

export function stopPhotoIndexing() {
  stopRequested = true;
}

export { photoIndexStats };
