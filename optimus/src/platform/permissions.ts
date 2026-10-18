import * as Calendar from 'expo-calendar/legacy';
import * as Contacts from 'expo-contacts/legacy';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Notifications from 'expo-notifications';
import { PermissionsAndroid, Platform } from 'react-native';
import * as Native from '../../modules/optimus-android';

/** Each permission is requested on its own, after an explanation screen. */
export type PermissionKey = 'texts' | 'calls' | 'notifications' | 'calendar' | 'contacts' | 'photos' | 'location' | 'alerts';

export type PermissionStates = Record<PermissionKey, boolean>;

// PermissionsAndroid is undefined on web (preview only).
const P = (PermissionsAndroid?.PERMISSIONS ?? {}) as typeof PermissionsAndroid.PERMISSIONS;

async function safe(fn: () => Promise<boolean>): Promise<boolean> {
  try {
    return await fn();
  } catch {
    return false;
  }
}

export async function getPermissionStates(): Promise<PermissionStates> {
  const android = Platform.OS === 'android';
  const [texts, calls, calendar, contacts, photos, location, alerts] = await Promise.all([
    safe(async () => android && (await PermissionsAndroid.check(P.READ_SMS))),
    safe(async () => android && (await PermissionsAndroid.check(P.READ_CALL_LOG))),
    safe(async () => (await Calendar.getCalendarPermissionsAsync()).granted),
    safe(async () => (await Contacts.getPermissionsAsync()).granted),
    safe(async () => (await MediaLibrary.getPermissionsAsync()).granted),
    safe(async () => (await Location.getForegroundPermissionsAsync()).granted),
    safe(async () => (await Notifications.getPermissionsAsync()).granted),
  ]);
  return { texts, calls, calendar, contacts, photos, location, alerts, notifications: Native.getDeviceStatus()?.notificationAccessGranted ?? false };
}

const granted = (r: string) => r === PermissionsAndroid.RESULTS.GRANTED;

/** Requests one permission. Notification access opens system settings instead. */
export async function requestPermission(key: PermissionKey): Promise<boolean> {
  switch (key) {
    case 'texts': {
      if (Platform.OS !== 'android') return false;
      const r = await PermissionsAndroid.requestMultiple([P.READ_SMS, P.SEND_SMS]);
      return granted(r[P.READ_SMS]);
    }
    case 'calls': {
      if (Platform.OS !== 'android') return false;
      const r = await PermissionsAndroid.requestMultiple([P.READ_CALL_LOG, P.CALL_PHONE]);
      return granted(r[P.READ_CALL_LOG]);
    }
    case 'notifications':
      Native.openNotificationAccessSettings();
      return false; // the user returns from settings; we re-check on focus
    case 'calendar':
      return (await Calendar.requestCalendarPermissionsAsync()).granted;
    case 'contacts':
      return (await Contacts.requestPermissionsAsync()).granted;
    case 'photos':
      return (await MediaLibrary.requestPermissionsAsync(false)).granted;
    case 'location':
      return (await Location.requestForegroundPermissionsAsync()).granted;
    case 'alerts':
      return (await Notifications.requestPermissionsAsync()).granted;
  }
}
