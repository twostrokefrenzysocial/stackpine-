// Config plugin: Android permissions, launcher <queries>, and the notification
// listener <service> for the Optimus native module. Safe to run repeatedly.
const { withAndroidManifest } = require('expo/config-plugins');

const PERMISSIONS = [
  'android.permission.READ_SMS',
  'android.permission.SEND_SMS',
  'android.permission.READ_CALL_LOG',
  'android.permission.CALL_PHONE',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
];

const SERVICE_NAME = 'expo.modules.optimusandroid.OptimusNotificationListener';

function applyManifestChanges(manifest) {
  const root = manifest.manifest;

  root['uses-permission'] = root['uses-permission'] ?? [];
  for (const name of PERMISSIONS) {
    if (!root['uses-permission'].some((p) => p.$['android:name'] === name)) {
      root['uses-permission'].push({ $: { 'android:name': name } });
    }
  }

  // Lets PackageManager resolve launcher app labels for captured notifications.
  root.queries = root.queries ?? [];
  const hasLauncherQuery = root.queries.some((q) =>
    (q.intent ?? []).some((i) => (i.action ?? []).some((a) => a.$['android:name'] === 'android.intent.action.MAIN')),
  );
  if (!hasLauncherQuery) {
    root.queries.push({ intent: [{ action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }] }] });
  }

  const app = root.application?.[0];
  if (!app) throw new Error('withOptimusAndroid: AndroidManifest has no <application>');
  app.service = app.service ?? [];
  if (!app.service.some((s) => s.$['android:name'] === SERVICE_NAME)) {
    app.service.push({
      $: {
        'android:name': SERVICE_NAME,
        'android:label': 'Optimus',
        'android:exported': 'true',
        'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
      },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.service.notification.NotificationListenerService' } }] }],
    });
  }
  return manifest;
}

const withOptimusAndroid = (config) =>
  withAndroidManifest(config, (cfg) => {
    cfg.modResults = applyManifestChanges(cfg.modResults);
    return cfg;
  });

module.exports = withOptimusAndroid;
module.exports.applyManifestChanges = applyManifestChanges;
