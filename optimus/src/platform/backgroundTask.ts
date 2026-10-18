import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { ensureTodaysBrief } from './briefRunner';
import { boot } from './runtime';
import { syncNotifications } from './sync';

export const BACKGROUND_TASK = 'optimus-background';

/**
 * Runs when Android lets us (WorkManager, roughly every 15+ minutes; Samsung
 * may delay it): drains captured notifications, enforces retention, builds
 * the brief ahead of its notification, and processes quiet conversations.
 * Everything here is also done on app open, so a skipped run loses nothing.
 */
TaskManager.defineTask(BACKGROUND_TASK, async () => {
  try {
    const rt = await boot();
    await syncNotifications(rt).catch(() => 0);
    await ensureTodaysBrief(rt, { lead: true }).catch(() => null);
    await rt.engine.refillRoutines().catch(() => 0);
    await rt.engine.processIdleConversations().catch(() => 0);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundWork(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!(await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK))) {
    await BackgroundTask.registerTaskAsync(BACKGROUND_TASK, { minimumInterval: 15 });
  }
}
