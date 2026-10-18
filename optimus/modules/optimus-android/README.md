# optimus-android (local Expo module)

Android-only bridge for data Expo doesn't expose. It's autolinked from `modules/` and configured by `app.plugin.js` (permissions, launcher `<queries>`, the listener `<service>`).

| Function | Notes |
| --- | --- |
| `getSmsMessages({ sinceMs, limit, query, threadId })` | `content://sms`, plus the text parts of MMS (best effort). Newest first. Needs `READ_SMS`. |
| `sendSms(to, body)` | `SmsManager`, multipart when long. Needs `SEND_SMS`. Only called after the user approves a card. |
| `getCallLog({ sinceMs, limit, number })` | Needs `READ_CALL_LOG`. |
| `startCall(number)` | `ACTION_CALL` with `CALL_PHONE`, otherwise opens the dialer. |
| `getDeviceStatus()` | SDK level, installer, sideloaded?, notification access, the restricted-settings heuristic, battery optimization. |
| `openNotificationAccessSettings()`, `openAppDetailsSettings()`, `openBatteryOptimizationSettings()` | Deep links for the Samsung setup screens. |
| `setNotificationCaptureConfig({ enabled, excludedPackages })` | Saved in SharedPreferences. The listener reads it even when JS isn't running. |
| `drainCapturedNotifications()` | Returns the encrypted queue (AES-GCM, Keystore key) oldest first, then clears it. |

## Passcode redaction rules (keep in sync with `src/core/notifications/redact.ts`)

1. Always: `(?<![A-Za-z0-9])G-\d{4,8}(?![A-Za-z0-9])`.
2. Only when this keyword pattern matches the title + text (case-insensitive): `(?<![a-z0-9])(?:codes?|otp|passcodes?|verification|verify|one-time|one time|2fa|two-factor|two factor|security code|login code|sign-in code|pins?|confirmation code|authentication)(?![a-z0-9])`
   - digits: `(?<![A-Za-z0-9])(?:\d{2,4}[ -]\d{2,4}|\d{4,8})(?![A-Za-z0-9])`
   - alphanumeric: `(?<![A-Za-z0-9])(?=(?:[A-Za-z]*[0-9]){2})(?=[0-9]*[A-Za-z])[A-Za-z0-9]{6,8}(?![A-Za-z0-9])`

The listener redacts before anything touches disk. JS applies the same rules again when it ingests.

## Not verified here

No Android SDK was available while this was built, so the Kotlin has been reviewed but never compiled. The first `eas build` is the compile check. See `SETUP_CHECKLIST.md › Test first`.
