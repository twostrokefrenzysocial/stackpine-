// Push subscription helpers. iOS only allows this once the PWA is installed to
// the home screen, so the UI checks isStandalone before offering it.

import { api } from './api.js';

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function enablePush() {
  if (!pushSupported()) {
    throw new Error('This browser does not support web push.');
  }
  if (isIOS() && !isStandalone()) {
    throw new Error(
      'On iPhone, add Academy Ready to the home screen first. Push only works from the installed app.'
    );
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications were not allowed for this device.');
  }

  const { key, configured } = await api.vapidKey();
  if (!configured || !key) {
    throw new Error('The server does not have VAPID keys set yet.');
  }

  const reg = await navigator.serviceWorker.ready;
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }

  await api.subscribePush(subscription.toJSON(), navigator.userAgent.slice(0, 120));
  return subscription;
}

export async function disablePush() {
  const subscription = await currentSubscription();
  if (!subscription) return false;
  await api.unsubscribePush(subscription.endpoint);
  await subscription.unsubscribe();
  return true;
}
