import * as Native from '../../modules/optimus-android';
import { kvSet } from '../core/settings/settings';
import type { Runtime } from './runtime';

/**
 * Incremental sync: only items the listener queued since the last drain are
 * ingested (redacted, excluded apps dropped), then retention is enforced.
 */
export async function syncNotifications(rt: Runtime): Promise<number> {
  const policy = { excludedPackages: rt.settings.excludedNotificationApps, retentionDays: rt.settings.notificationRetentionDays };
  let stored = 0;
  if (Native.isAvailable()) {
    const items = await Native.drainCapturedNotifications();
    if (items.length) {
      stored = await rt.engine.notifications.ingest(items, policy);
      await kvSet(rt.db, 'notifications.listenerSeen', new Date().toISOString());
    }
  }
  await rt.engine.notifications.prune(policy);
  await rt.engine.activity.prune(90);
  return stored;
}
