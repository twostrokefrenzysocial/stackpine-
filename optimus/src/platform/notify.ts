import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ReminderScheduler } from '../core/reminders/reminders';
import type { RoutineScheduler } from '../core/routines/routines';

export const CHANNELS = { reminders: 'reminders', brief: 'brief' } as const;

let ready = false;

export async function setupNotifications(): Promise<void> {
  if (ready || Platform.OS === 'web') return;
  ready = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    // eslint-disable-next-line import/namespace -- AndroidImportance is a re-exported enum the import plugin can't see
    await Notifications.setNotificationChannelAsync(CHANNELS.reminders, { name: 'Reminders', importance: Notifications.AndroidImportance.HIGH, lightColor: '#E31937' });
    // eslint-disable-next-line import/namespace
    await Notifications.setNotificationChannelAsync(CHANNELS.brief, { name: 'Daily brief', importance: Notifications.AndroidImportance.DEFAULT, lightColor: '#E31937' });
  }
}

/** Reminders become scheduled local notifications. */
export const notificationScheduler: ReminderScheduler = {
  async schedule(r) {
    if (Platform.OS === 'web') return `web-${r.id}`;
    await setupNotifications();
    return Notifications.scheduleNotificationAsync({
      content: { title: 'Reminder', body: r.text, data: { url: 'optimus://home', reminderId: r.id } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(r.dueAt), channelId: CHANNELS.reminders },
    });
  },
  async cancel(id) {
    if (Platform.OS !== 'web') await Notifications.cancelScheduledNotificationAsync(id);
  },
};

/** Daily routine messages: each day's pre-written text, scheduled for its time. */
export const routineScheduler: RoutineScheduler = {
  async schedule(n) {
    if (Platform.OS === 'web') return `web-${n.routineId}-${n.at.getTime()}`;
    await setupNotifications();
    return Notifications.scheduleNotificationAsync({
      content: { title: n.title, body: n.body, data: { url: 'optimus://home', routineId: n.routineId } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: n.at, channelId: CHANNELS.reminders },
    });
  },
  async cancel(id) {
    if (Platform.OS !== 'web') await Notifications.cancelScheduledNotificationAsync(id);
  },
};

const BRIEF_ID = 'optimus-daily-brief';

/**
 * The morning brief notification: a daily local alarm at the chosen time.
 * The background task builds the brief shortly before; if Samsung delayed
 * it, opening the notification builds it instantly.
 */
export async function scheduleDailyBrief(enabled: boolean, time: string): Promise<void> {
  if (Platform.OS === 'web') return;
  await setupNotifications();
  await Notifications.cancelScheduledNotificationAsync(BRIEF_ID).catch(() => undefined);
  if (!enabled) return;
  const [hour, minute] = time.split(':').map(Number);
  await Notifications.scheduleNotificationAsync({
    identifier: BRIEF_ID,
    content: { title: 'Your brief is ready', body: 'Schedule, people waiting on you, and anything you missed.', data: { url: 'optimus://brief' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: hour || 7, minute: minute || 0, channelId: CHANNELS.brief },
  });
}

/** Opens the screen a tapped notification points at. Returns an unsubscribe. */
export function routeNotificationTaps(go: (href: string) => void): () => void {
  if (Platform.OS === 'web') return () => undefined;
  const open = (url: unknown) => {
    if (typeof url !== 'string') return;
    go(url.includes('voice') ? '/voice' : '/');
  };
  const last = Notifications.getLastNotificationResponse();
  if (last) open(last.notification.request.content.data?.url);
  const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data?.url));
  return () => sub.remove();
}

/** Fires immediately: used when the background task finishes today's brief. */
export async function notifyBriefReady(headline: string): Promise<void> {
  if (Platform.OS === 'web') return;
  await setupNotifications();
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Your brief is ready', body: headline, data: { url: 'optimus://brief' } },
    trigger: null,
  });
}

/** An urgent proactive suggestion; tapping it opens Home, where it can be done in one tap. */
export async function notifyInsight(i: { title: string; why: string }): Promise<void> {
  if (Platform.OS === 'web') return;
  await setupNotifications();
  await Notifications.scheduleNotificationAsync({
    content: { title: i.title, body: i.why, data: { url: 'optimus://home' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1, channelId: CHANNELS.reminders },
  });
}
