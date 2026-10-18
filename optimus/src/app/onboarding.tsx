import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Native from '../../modules/optimus-android';
import { getPermissionStates, requestPermission, type PermissionKey, type PermissionStates } from '../platform/permissions';
import { useApp } from '../ui/AppContext';
import { Brain } from '../ui/components/Brain';
import { Button } from '../ui/components/Button';
import { Icon, type IconName } from '../ui/components/Icon';
import { Panel } from '../ui/components/Panel';
import { Txt } from '../ui/components/Txt';
import { GUTTER, space } from '../ui/theme';

/** One explanation screen per permission, then the Samsung-specific steps. */
interface PermissionStep {
  kind: 'permission';
  key: PermissionKey;
  icon: IconName;
  title: string;
  why: string;
  without: string;
  optional?: boolean;
}
type Step = { kind: 'welcome' } | { kind: 'battery' } | PermissionStep | { kind: 'notification-access' } | { kind: 'done' };

const PERMISSION_STEPS: PermissionStep[] = [
  { kind: 'permission', key: 'contacts', icon: 'person', title: 'Contacts', why: 'So I know who “Mike” or “my wife” is, and can match numbers to names.', without: 'I’ll only see phone numbers and email addresses.' },
  { kind: 'permission', key: 'calendar', icon: 'calendar', title: 'Calendar', why: 'To read your schedule and add or change events. I always ask before changing anything.', without: 'I can’t see or plan your day.' },
  { kind: 'permission', key: 'texts', icon: 'message', title: 'Text messages', why: 'To find and summarize texts, and send replies you approve.', without: 'I can’t see texts. RCS chats can still reach me through notification access.' },
  { kind: 'permission', key: 'calls', icon: 'phone', title: 'Call log', why: 'To tell you who called and what you missed, and to start calls you approve.', without: 'I won’t know about missed calls.' },
  { kind: 'permission', key: 'photos', icon: 'photo', title: 'Photos', why: 'To find photos when you ask. Only the few needed for your question are sent for analysis, resized.', without: 'I can’t search your photos.' },
  { kind: 'permission', key: 'microphone', icon: 'mic', title: 'Microphone', why: 'To hear you when you tap the mic. I never listen in the background.', without: 'You can still type.' },
  { kind: 'permission', key: 'alerts', icon: 'bell', title: 'Alerts', why: 'To deliver your morning brief and the reminders you set.', without: 'Reminders and the brief won’t notify you.' },
  { kind: 'permission', key: 'location', icon: 'pin', title: 'Location (optional)', why: 'Only for context like “remind me when I get home”. Off unless you turn it on.', without: 'Nothing changes. This is optional.', optional: true },
];

const STEPS: Step[] = [{ kind: 'welcome' }, { kind: 'battery' }, ...PERMISSION_STEPS, { kind: 'notification-access' }, { kind: 'done' }];

export default function Onboarding() {
  const { palette: p, settings, updateSettings } = useApp();
  const insets = useSafeAreaInsets();
  const [i, setI] = useState(0);
  const [states, setStates] = useState<PermissionStates | null>(null);
  const [device, setDevice] = useState(() => Native.getDeviceStatus());

  const refresh = useCallback(async () => {
    setStates(await getPermissionStates());
    setDevice(Native.getDeviceStatus());
  }, []);

  // Re-check when the user comes back from a system settings screen.
  useEffect(() => {
    getPermissionStates().then(setStates);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const step = STEPS[i];
  const next = () => setI((n) => Math.min(STEPS.length - 1, n + 1));
  const finish = async () => {
    await updateSettings({ onboardingDone: true });
    router.replace('/');
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView contentContainerStyle={[styles.body, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxl }]}>
        <View style={styles.progress} accessibilityLabel={`Step ${i + 1} of ${STEPS.length}`}>
          {STEPS.map((_, n) => (
            <View key={n} style={[styles.seg, { backgroundColor: n <= i ? p.text : p.line }]} />
          ))}
        </View>
        <Txt variant="mono" color={p.textTertiary}>
          SETUP {String(i + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
        </Txt>

        {step.kind === 'welcome' && (
          <View style={styles.stack}>
            <View style={{ alignItems: 'center', marginVertical: space.xl }}>
              <Brain size={240} state="idle" interactive={false} />
            </View>
            <Txt variant="display">I’m Optimus.</Txt>
            <Txt variant="body" color={p.textSecondary}>
              I can read your texts, calls, notifications, calendar, email and photos to help you. Everything stays encrypted on this phone. I only send the snippets a question needs to Claude, through your own proxy. I never send, call, change or delete anything without your approval.
            </Txt>
            <Panel label="Data mode">
              <Txt variant="body">{settings.dataMode === 'mock' ? 'You’re in Mock Data mode: a realistic demo phone. Switch to Real Data in Settings when you’re ready.' : 'You’re using real data from this phone.'}</Txt>
            </Panel>
          </View>
        )}

        {step.kind === 'battery' && (
          <SetupStep
            icon="bolt"
            title="Keep me running"
            body="Samsung may stop apps in the background, which would delay your brief and reminders. Set Optimus to Unrestricted."
            status={device ? (device.ignoringBatteryOptimizations ? 'UNRESTRICTED' : 'OPTIMIZED') : 'UNAVAILABLE ON THIS DEVICE'}
            ok={device?.ignoringBatteryOptimizations}
            steps={['Tap Open battery settings below.', 'Choose Allow when asked to stop optimizing, or open Battery.', 'Select Unrestricted.', 'If you see “Sleeping apps” in Battery › Background usage limits, make sure Optimus isn’t on that list.']}
            action={{ label: 'Open battery settings', onPress: () => Native.openBatteryOptimizationSettings() }}
          />
        )}

        {step.kind === 'permission' && (
          <SetupStep
            icon={step.icon}
            title={step.title}
            body={step.why}
            note={`Without it: ${step.without}`}
            status={states ? (states[step.key] ? 'GRANTED' : 'NOT GRANTED') : '—'}
            ok={states?.[step.key]}
            action={
              step.key === 'location' && !settings.locationEnabled
                ? {
                    label: 'Turn on location',
                    onPress: async () => {
                      if (await requestPermission('location')) await updateSettings({ locationEnabled: true });
                      refresh();
                    },
                  }
                : { label: 'Allow', onPress: async () => (await requestPermission(step.key), refresh()) }
            }
          />
        )}

        {step.kind === 'notification-access' && (
          <SetupStep
            icon="bell"
            title="Notification access"
            body="Lets me answer “what did I miss?” and read RCS chats that don’t appear in the text-message database. One-time passcodes are hidden before anything is stored. You can exclude apps like banking in Settings."
            status={device ? (device.notificationAccessGranted ? 'GRANTED' : device.restrictedSettingsLikelyBlocked ? 'BLOCKED BY RESTRICTED SETTINGS' : 'NOT GRANTED') : 'UNAVAILABLE ON THIS DEVICE'}
            ok={device?.notificationAccessGranted}
            steps={
              device?.restrictedSettingsLikelyBlocked
                ? [
                    'Android blocks this for apps installed outside the Play Store until you allow it.',
                    'Tap Open app info below.',
                    'Tap the ⋮ menu at the top right, then Allow restricted settings, and confirm with your fingerprint or PIN.',
                    'Come back here and tap Open notification access.',
                    'Turn on Optimus and confirm.',
                  ]
                : ['Tap Open notification access.', 'Find Optimus in the list and turn it on.', 'Confirm, then come back here.']
            }
            action={{ label: 'Open notification access', onPress: () => Native.openNotificationAccessSettings() }}
            secondary={device?.restrictedSettingsLikelyBlocked ? { label: 'Open app info', onPress: () => Native.openAppDetailsSettings() } : undefined}
          />
        )}

        {step.kind === 'done' && (
          <View style={styles.stack}>
            <View style={{ alignItems: 'center', marginVertical: space.xl }}>
              <Brain size={220} state="responding" interactive={false} />
            </View>
            <Txt variant="display">Ready.</Txt>
            <Txt variant="body" color={p.textSecondary}>
              You can change any of this in Settings › Data sources. If you turned off Auto Blocker to install me, you can turn it back on now (Settings › Security and privacy › Auto Blocker).
            </Txt>
            {states && (
              <Panel label="What I can see">
                <View style={{ gap: space.sm }}>
                  {(['contacts', 'calendar', 'texts', 'calls', 'photos', 'notifications', 'microphone'] as PermissionKey[]).map((k) => (
                    <View key={k} style={styles.checkRow}>
                      <Icon name={states[k] ? 'check' : 'close'} size={16} color={states[k] ? p.text : p.textTertiary} />
                      <Txt variant="body" color={states[k] ? p.text : p.textTertiary} style={{ textTransform: 'capitalize' }}>
                        {k}
                      </Txt>
                    </View>
                  ))}
                </View>
              </Panel>
            )}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md, borderTopColor: p.line }]}>
        {i > 0 && step.kind !== 'done' && <Button label="Back" variant="ghost" onPress={() => setI((n) => n - 1)} />}
        <View style={{ flex: 1 }} />
        {step.kind === 'done' ? (
          <Button label="Start" icon="check" onPress={finish} style={{ minWidth: 160 }} />
        ) : (
          <Button label={step.kind === 'welcome' ? 'Begin' : step.kind === 'permission' && !states?.[step.key] ? 'Not now' : 'Next'} variant={step.kind === 'welcome' ? 'primary' : 'secondary'} onPress={next} style={{ minWidth: 140 }} />
        )}
      </View>
    </View>
  );
}

function SetupStep({
  icon,
  title,
  body,
  note,
  status,
  ok,
  steps,
  action,
  secondary,
}: {
  icon: IconName;
  title: string;
  body: string;
  note?: string;
  status: string;
  ok?: boolean;
  steps?: string[];
  action: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
}) {
  const { palette: p } = useApp();
  return (
    <View style={styles.stack}>
      <View style={[styles.iconBox, { borderColor: p.line }]}>
        <Icon name={icon} size={28} color={p.text} />
      </View>
      <Txt variant="display" accessibilityRole="header">
        {title}
      </Txt>
      <Txt variant="body" color={p.textSecondary}>
        {body}
      </Txt>
      {note && (
        <Txt variant="small" color={p.textTertiary}>
          {note}
        </Txt>
      )}
      <View style={styles.checkRow}>
        <View style={[styles.dot, { backgroundColor: ok ? p.text : p.red }]} />
        <Txt variant="mono" color={ok ? p.text : p.textSecondary}>
          STATUS: {status}
        </Txt>
      </View>
      {steps && (
        <Panel label="Steps" hud>
          <View style={{ gap: space.md }}>
            {steps.map((s, n) => (
              <View key={s} style={styles.stepRow}>
                <Txt variant="mono" color={p.textTertiary}>
                  {String(n + 1).padStart(2, '0')}
                </Txt>
                <Txt variant="body" style={{ flex: 1 }}>
                  {s}
                </Txt>
              </View>
            ))}
          </View>
        </Panel>
      )}
      {!ok && <Button label={action.label} onPress={action.onPress} />}
      {!ok && secondary && <Button label={secondary.label} variant="secondary" onPress={secondary.onPress} />}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: GUTTER, gap: space.md },
  progress: { flexDirection: 'row', gap: 3 },
  seg: { flex: 1, height: 2 },
  stack: { gap: space.lg, marginTop: space.lg },
  iconBox: { width: 56, height: 56, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepRow: { flexDirection: 'row', gap: space.md },
  dot: { width: 6, height: 6, borderRadius: 3 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: GUTTER, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth * 2 },
});
