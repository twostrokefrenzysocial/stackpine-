import { AppState } from "react-native";
import * as Native from "../../modules/optimus-android";
import { takeUnnotified } from "../core/insights/insights";
import { triageNotifications } from "../core/insights/triage";
import { knowledgeDigest } from "../core/memory/consolidate";
import { kvSet } from "../core/settings/settings";
import { notifyInsight } from "./notify";
import type { Runtime } from "./runtime";

/**
 * Incremental sync: only items the listener queued since the last drain are
 * ingested (redacted, excluded apps dropped), then retention is enforced.
 */
export async function syncNotifications(rt: Runtime): Promise<number> {
  const policy = {
    excludedPackages: rt.settings.excludedNotificationApps,
    allowedPackages:
      rt.settings.notificationApps === "approved"
        ? rt.settings.approvedNotificationApps
        : [],
    retentionDays: rt.settings.notificationRetentionDays,
  };
  let stored = 0;
  if (Native.isAvailable()) {
    const items = await Native.drainCapturedNotifications();
    if (items.length) {
      const ids: string[] = [];
      stored = await rt.engine.notifications.ingest(
        items,
        policy,
        new Date(),
        ids,
      );
      await kvSet(
        rt.db,
        "notifications.listenerSeen",
        new Date().toISOString(),
      );
      if (ids.length) await triageIncoming(rt, ids).catch(() => undefined);
    }
  }
  await rt.engine.notifications.prune(policy);
  await rt.engine.activity.prune(90);
  return stored;
}

/**
 * Reads what just arrived and suggests actions for anything important: on
 * Home right away, and as a notification when urgent and the app isn't open.
 */
async function triageIncoming(rt: Runtime, ids: string[]): Promise<void> {
  if (rt.isDemoBrain()) return;
  const fresh = await rt.engine.notifications.byIds(ids);
  if (!fresh.length) return;
  const knowledge = await knowledgeDigest(
    rt.engine.memory,
    rt.engine.episodes,
    { facts: 12 },
  ).catch(() => "");
  const added = await triageNotifications({
    db: rt.db,
    llm: rt.background(),
    items: fresh,
    knowledge: knowledge || undefined,
  });
  if (added.length)
    await rt.engine.activity.add({
      kind: "read",
      summary: `Noticed ${added.length} thing${added.length === 1 ? "" : "s"} worth acting on in new notifications`,
    });
  if (AppState.currentState === "active") return;
  for (const i of await takeUnnotified(rt.db))
    await notifyInsight({ title: i.title, why: i.why, ask: i.ask }).catch(
      () => undefined,
    );
}
