import { reloadAppAsync } from 'expo';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { MAIN_MODEL, BACKGROUND_MODEL } from '../core/llm/prompts';
import { friendlyError } from '../core/llm/transport';
import { photoIndexStats } from '../core/photos/photoIndex';
import { proxyApi, type ProxyUsage } from '../platform/claude';
import { exportBackup, importBackup } from '../platform/backupFiles';
import { proxyToken, oauthTokens } from '../platform/secrets';
import { connectGmail, connectOutlook, disconnectGmail, disconnectOutlook, icloudStatus } from '../platform/sources/email';
import { speak } from '../platform/voice';
import { useApp, useData } from '../ui/AppContext';
import { Banner } from '../ui/components/Banner';
import { Button } from '../ui/components/Button';
import { Field, Segmented, Toggle } from '../ui/components/Controls';
import { Dock } from '../ui/components/Dock';
import { Panel } from '../ui/components/Panel';
import { Screen } from '../ui/components/Screen';
import { Txt } from '../ui/components/Txt';
import { feedback } from '../ui/feedback';
import { space } from '../ui/theme';

/** Accepts "optimus-proxy.name.workers.dev", with or without https:// or a trailing slash. */
function normalizeProxyUrl(raw: string): string {
  const t = raw.trim().replace(/\s+/g, '').replace(/\/+$/, '');
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** Apps people usually keep out of the notification log. */
const SENSITIVE_APPS = [
  { packageName: 'com.chase.sig.android', appName: 'Chase' },
  { packageName: 'com.samsung.android.spay', appName: 'Samsung Wallet' },
  { packageName: 'com.google.android.apps.walletnfcrel', appName: 'Google Wallet' },
  { packageName: 'com.sec.android.app.shealth', appName: 'Samsung Health' },
  { packageName: 'com.venmo', appName: 'Venmo' },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel label={title} animate={false}>
      <View style={{ gap: space.md }}>{children}</View>
    </Panel>
  );
}

export default function Settings() {
  const { rt, settings, updateSettings, palette: p, bump } = useApp();
  const [url, setUrl] = useState(settings.proxyUrl);
  const [provider, setProvider] = useState(settings.provider);
  const [oaModel, setOaModel] = useState(settings.openaiModel);
  const [oaBgModel, setOaBgModel] = useState(settings.openaiBackgroundModel);
  const [token, setToken] = useState('');
  const [usage, setUsage] = useState<ProxyUsage | null>(null);
  const [connMsg, setConnMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cap, setCap] = useState(String(settings.spendingCapUsd));
  const [actual, setActual] = useState('');
  const [usageMsg, setUsageMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [wipeArmed, setWipeArmed] = useState(false);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [newPkg, setNewPkg] = useState('');

  const { data: routines } = useData(() => rt.engine.routines.list(), []);
  const { data: photoStats, reload: refreshPhotoStats } = useData(() => photoIndexStats(rt.db), []);
  useEffect(() => {
    // Live progress while indexing runs.
    const t = setInterval(refreshPhotoStats, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: apps } = useData(async () => {
    const seen = settings.dataMode === 'mock' ? rt.mock.dataset.notifications.map((n) => ({ packageName: n.packageName, appName: n.appName })) : await rt.engine.notifications.apps();
    const all = [...SENSITIVE_APPS, ...seen, ...settings.excludedNotificationApps.map((pk) => ({ packageName: pk, appName: pk }))];
    return all.filter((a, i) => all.findIndex((b) => b.packageName === a.packageName) === i);
  }, [settings.dataMode, settings.excludedNotificationApps]);

  const refreshUsage = async (u = settings.proxyUrl) => {
    const t = await proxyToken.get();
    if (!u || !t) return;
    try {
      setUsage(await proxyApi.usage(u, t));
      setConnMsg({ ok: true, text: 'Connected to your proxy.' });
    } catch (e) {
      setConnMsg({ ok: false, text: friendlyError(e).body });
    }
  };
  useEffect(() => {
    // Initial usage readout (all state updates happen after the network call).
    Promise.resolve()
      .then(() => refreshUsage())
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveConnection = async () => {
    setBusy('conn');
    if (token.trim()) await proxyToken.set(token.trim());
    if (provider === 'openai' && !oaModel.trim()) {
      setConnMsg({ ok: false, text: 'Enter the OpenAI model to use (it must be in your proxy’s OPENAI_MODELS list).' });
      setBusy(null);
      return;
    }
    const clean = normalizeProxyUrl(url);
    setUrl(clean);
    await updateSettings({ proxyUrl: clean, provider, openaiModel: oaModel.trim(), openaiBackgroundModel: oaBgModel.trim() });
    setToken('');
    const t = await proxyToken.get();
    if (!clean || !t) {
      setConnMsg({ ok: false, text: 'Enter both the proxy URL and the app token.' });
      setBusy(null);
      return;
    }
    try {
      setUsage(await proxyApi.usage(clean, t));
      setConnMsg({ ok: true, text: 'Proxy found. Asking the AI a test question…' });
      // End to end: proxy, key, credit and model name all have to work for this to pass.
      await rt.testModel();
      setConnMsg({ ok: true, text: `All set. ${provider === 'openai' ? `OpenAI (${oaModel.trim()})` : 'Claude'} answered through your proxy.` });
      feedback.fire('confirm');
    } catch (e) {
      setConnMsg({ ok: false, text: friendlyError(e).body });
    }
    setBusy(null);
  };

  const saveCap = async () => {
    const v = Number(cap);
    if (!Number.isFinite(v) || v <= 0 || v > 1000) {
      setUsageMsg({ ok: false, text: 'Enter a cap between $1 and $1000.' });
      return;
    }
    const t = await proxyToken.get();
    try {
      if (settings.proxyUrl && t) setUsage(await proxyApi.setCap(settings.proxyUrl, t, v));
      await updateSettings({ spendingCapUsd: v });
      setUsageMsg({ ok: true, text: `Monthly cap set to $${v}.` });
    } catch (e) {
      setUsageMsg({ ok: false, text: friendlyError(e).body });
    }
  };

  /** Replace this month's estimate with the real figure from the provider's usage page. */
  const correctSpent = async () => {
    const v = Number(actual.replace(/[$,\s]/g, ''));
    if (!actual.trim() || !Number.isFinite(v) || v < 0 || v > 1000) {
      setUsageMsg({ ok: false, text: 'Enter the amount shown on your AI account’s usage page, for example 0.12.' });
      return;
    }
    const t = await proxyToken.get();
    if (!settings.proxyUrl || !t) return;
    try {
      setUsage(await proxyApi.setSpent(settings.proxyUrl, t, v));
      setActual('');
      setUsageMsg({ ok: true, text: `This month’s total is now $${v.toFixed(2)}. New requests are added on top at real prices.` });
    } catch (e) {
      setUsageMsg({ ok: false, text: friendlyError(e).body });
    }
  };

  const toggleExcluded = (pkg: string, excluded: boolean) => {
    const set = new Set(settings.excludedNotificationApps);
    if (excluded) set.add(pkg);
    else set.delete(pkg);
    updateSettings({ excludedNotificationApps: [...set] });
  };

  const connect = async (which: 'gmail' | 'outlook' | 'icloud') => {
    setEmailMsg(null);
    try {
      if (which === 'icloud') {
        if (!settings.proxyUrl) throw new Error('Connect your proxy first (Settings › Connection).');
        const st = await icloudStatus(settings.proxyUrl);
        if (!st.configured) {
          throw new Error(
            'iCloud needs a one-time step: 1) At appleid.apple.com › Sign-In and Security › App-Specific Passwords, create one named Optimus. 2) On GitHub add two secrets: ICLOUD_EMAIL (your iCloud address) and ICLOUD_APP_PASSWORD (that password). 3) Re-run the Optimus proxy job, then tap Connect again.',
          );
        }
        setEmailMsg(null);
      } else if (which === 'gmail') await connectGmail();
      else await connectOutlook();
      await updateSettings({ emailAccounts: [...new Set([...settings.emailAccounts, which])] });
      await rt.engine.activity.add({ kind: 'system', summary: `Connected ${which === 'gmail' ? 'Gmail' : which === 'outlook' ? 'Outlook' : 'iCloud Mail'}` });
    } catch (e) {
      setEmailMsg(e instanceof Error ? e.message : 'Sign-in didn’t complete.');
    }
  };
  const disconnect = async (which: 'gmail' | 'outlook' | 'icloud') => {
    if (which === 'gmail') await disconnectGmail();
    else if (which === 'outlook') await disconnectOutlook();
    await updateSettings({ emailAccounts: settings.emailAccounts.filter((a) => a !== which) });
  };


  const doExport = async () => {
    setBusy('export');
    setBackupMsg(null);
    try {
      await exportBackup(rt.db, passphrase);
      setBackupMsg({ ok: true, text: 'Backup created. Save it to Google Drive or Samsung Cloud from the share sheet. Keep the passphrase safe: without it the backup can’t be opened.' });
    } catch (e) {
      setBackupMsg({ ok: false, text: e instanceof Error ? e.message : 'Backup failed.' });
    }
    setBusy(null);
  };
  const doImport = async () => {
    setBusy('import');
    setBackupMsg(null);
    try {
      const r = await importBackup(rt.db, passphrase);
      if (r) {
        setBackupMsg({ ok: true, text: `Restored ${r.memories} memories and ${r.conversations} conversations.` });
        bump();
      }
    } catch (e) {
      setBackupMsg({ ok: false, text: e instanceof Error ? e.message : 'Restore failed.' });
    }
    setBusy(null);
  };

  const wipe = async () => {
    feedback.fire('confirm');
    await rt.engine.wipeAll();
    await proxyToken.set('');
    await Promise.all([oauthTokens.remove('outlook'), disconnectGmail().catch(() => undefined)]);
    await reloadAppAsync('Wiped all local data').catch(() => router.replace('/onboarding'));
  };

  const pct = usage ? Math.min(1, usage.spentUsd / Math.max(0.01, usage.capUsd)) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Screen contentStyle={{ gap: space.md }}>
        <Txt variant="display" accessibilityRole="header">
          Settings
        </Txt>

        <Section title="Connection">
          <Txt variant="small" color={p.textSecondary}>
            Optimus talks to the AI only through your own proxy. Your API keys never live on this phone.
          </Txt>
          <Segmented
            label="AI provider"
            value={provider}
            onChange={setProvider}
            options={[
              { value: 'anthropic', label: 'Anthropic' },
              { value: 'openai', label: 'OpenAI' },
            ]}
          />
          {provider === 'openai' && (
            <>
              <Field label="OpenAI model" value={oaModel} onChangeText={setOaModel} placeholder="gpt-5 (recommended)" autoCapitalize="none" autoCorrect={false} />
              <Field label="Background model (optional)" value={oaBgModel} onChangeText={setOaBgModel} placeholder="gpt-5-mini (cheaper, for memory and summaries)" autoCapitalize="none" autoCorrect={false} />
            </>
          )}
          <Field label="Proxy URL" value={url} onChangeText={setUrl} placeholder="https://optimus-proxy.example.workers.dev" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <Field label="App token" value={token} onChangeText={setToken} placeholder={settings.proxyUrl ? 'Saved — enter a new one to replace it' : 'Paste the APP_TOKEN you created'} autoCapitalize="none" autoCorrect={false} secureTextEntry />
          <Button label={busy === 'conn' ? 'Testing…' : 'Save and test'} onPress={saveConnection} disabled={busy === 'conn'} />
          {connMsg && (
            <Txt variant="small" color={connMsg.ok ? p.text : p.redGlow}>
              {connMsg.text}
            </Txt>
          )}
          <Txt variant="mono" color={p.textTertiary}>
            {rt.isDemoBrain()
              ? 'CORE: OFFLINE DEMO · BACKGROUND: HEURISTICS'
              : settings.provider === 'openai'
                ? `CORE: ${settings.openaiModel.toUpperCase()} · BACKGROUND: ${(settings.openaiBackgroundModel || settings.openaiModel).toUpperCase()}`
                : `CORE: ${MAIN_MODEL.toUpperCase()} · BACKGROUND: ${BACKGROUND_MODEL.toUpperCase()}`}
          </Txt>
        </Section>

        <Section title="Usage this month">
          {usage ? (
            <>
              <View style={styles.usageRow}>
                <Txt variant="display">${usage.spentUsd.toFixed(2)}</Txt>
                <Txt variant="mono" color={p.textSecondary}>
                  OF ${usage.capUsd.toFixed(2)} · {usage.month} · {usage.requests} REQ
                </Txt>
              </View>
              <View style={[styles.track, { backgroundColor: p.line }]} accessibilityLabel={`${Math.round(pct * 100)} percent of the monthly cap used`}>
                <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: pct >= 0.9 ? p.red : p.text }]} />
              </View>
              {pct >= 1 && <Txt variant="small" color={p.redGlow}>Cap reached. I’ll tell you instead of failing silently until it resets or you raise it.</Txt>}
            </>
          ) : (
            <Txt variant="small" color={p.textSecondary}>
              Connect the proxy to see spending.
            </Txt>
          )}
          <Field label="Monthly spending cap (USD)" value={cap} onChangeText={setCap} keyboardType="decimal-pad" />
          <Button label="Set cap" variant="secondary" onPress={saveCap} />
          {usage && (
            <>
              <Field label="Correct this month’s total (USD)" value={actual} onChangeText={setActual} keyboardType="decimal-pad" placeholder={`From ${settings.provider === 'openai' ? 'platform.openai.com › Usage' : 'console.anthropic.com › Usage'}`} />
              <Button label="Match my bill" variant="secondary" onPress={correctSpent} />
            </>
          )}
          {usageMsg && (
            <Txt variant="small" color={usageMsg.ok ? p.text : p.redGlow}>
              {usageMsg.text}
            </Txt>
          )}
        </Section>

        <Section title="Data">
          <Segmented
            label="Data mode"
            value={settings.dataMode}
            onChange={(v) => updateSettings({ dataMode: v })}
            options={[
              { value: 'mock', label: 'Mock data' },
              { value: 'real', label: 'Real data' },
            ]}
          />
          <Txt variant="small" color={p.textSecondary}>
            {settings.dataMode === 'mock' ? 'Using a realistic demo phone. Nothing on this device is read.' : 'Reading this phone’s data, limited to the permissions you granted.'}
          </Txt>
          <Button label="Data sources and permissions" icon="chevronRight" variant="secondary" onPress={() => router.push('/onboarding')} />
          <Toggle label="Location" hint="Off by default. Only for context like “when I get home”." value={settings.locationEnabled} onChange={(v) => updateSettings({ locationEnabled: v })} />
        </Section>

        <Section title="Thinking">
          <Segmented
            label="How hard it thinks"
            value={settings.thinking ?? 'fast'}
            onChange={(v) => updateSettings({ thinking: v })}
            options={[
              { value: 'fast', label: 'Fast' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'deep', label: 'Deep' },
            ]}
          />
          <Txt variant="small" color={p.textSecondary}>
            Fast answers in a few seconds and handles everyday tasks. Balanced and Deep think longer before replying and cost a little more. Voice mode always stays fast.
          </Txt>
        </Section>

        <Section title="Web">
          <Toggle
            label="Search the web"
            hint="For news, weather, opening hours, facts and how-tos. Searches run through your proxy and count toward Usage (about 1¢ each); I list the pages I used under the answer."
            value={settings.webSearchEnabled}
            onChange={(v) => updateSettings({ webSearchEnabled: v })}
          />
        </Section>

        <Section title="Photo search">
          <Toggle
            label="Make my photos searchable"
            hint="I describe each photo once in the background (sent small, through your proxy) and keep the descriptions on this phone, so I can find any photo by what’s in it. By my estimate about 5–20 cents per thousand photos, counted in Usage."
            value={settings.photoIndexEnabled}
            onChange={async (v) => {
              await updateSettings({ photoIndexEnabled: v });
              const r = await import('../platform/photoIndexRunner');
              if (v) void r.runPhotoIndexing(rt, { onProgress: refreshPhotoStats });
              else r.stopPhotoIndexing();
            }}
          />
          {photoStats && (
            <Txt variant="mono" color={p.textSecondary}>
              {photoStats.complete
                ? `ALL ${photoStats.indexed.toLocaleString()} PHOTOS SEARCHABLE`
                : `${photoStats.indexed.toLocaleString()}${photoStats.total ? ` OF ${photoStats.total.toLocaleString()}` : ''} PHOTOS SEARCHABLE${settings.photoIndexEnabled ? ' · WORKING WHILE THE APP IS OPEN' : ''}`}
            </Txt>
          )}
          {settings.dataMode !== 'real' && (
            <Txt variant="small" color={p.textSecondary}>
              Switch to Real data to index your own photos.
            </Txt>
          )}
        </Section>

        <Section title="Email">
          {(['gmail', 'outlook', 'icloud'] as const).map((a) => {
            const on = settings.emailAccounts.includes(a);
            return (
              <View key={a} style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">{a === 'gmail' ? 'Gmail' : a === 'outlook' ? 'Outlook' : 'iCloud Mail'}</Txt>
                  <Txt variant="mono" color={on ? p.text : p.textTertiary}>
                    {on ? 'CONNECTED' : 'NOT CONNECTED'}
                  </Txt>
                </View>
                <Button label={on ? 'Disconnect' : 'Connect'} variant={on ? 'ghost' : 'secondary'} compact onPress={() => (on ? disconnect(a) : connect(a))} />
              </View>
            );
          })}
          {emailMsg && (
            <Txt variant="small" color={p.redGlow}>
              {emailMsg}
            </Txt>
          )}
          <Txt variant="small" color={p.textTertiary}>
            Mail stays with Google, Microsoft or Apple. I read it on demand and send only what you approve.
          </Txt>
        </Section>

        <Section title="Notifications">
          <Toggle label="Capture notifications" hint="So I can tell you what you missed. Passcodes are hidden before anything is stored." value={settings.notificationCaptureEnabled} onChange={(v) => updateSettings({ notificationCaptureEnabled: v })} />
          <Txt variant="label" color={p.textSecondary}>
            Keep for
          </Txt>
          <Segmented
            label="Notification retention"
            value={String(settings.notificationRetentionDays)}
            onChange={(v) => updateSettings({ notificationRetentionDays: Number(v) })}
            options={['7', '14', '30', '60', '90'].map((d) => ({ value: d, label: `${d}d` }))}
          />
          <Txt variant="label" color={p.textSecondary}>
            Excluded apps
          </Txt>
          {(apps ?? []).map((a) => (
            <Toggle key={a.packageName} label={a.appName} hint={a.packageName} value={settings.excludedNotificationApps.includes(a.packageName)} onChange={(v) => toggleExcluded(a.packageName, v)} />
          ))}
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Field label="Exclude another app (package name)" value={newPkg} onChangeText={setNewPkg} placeholder="com.example.bank" autoCapitalize="none" autoCorrect={false} />
            </View>
          </View>
          <Button
            label="Exclude"
            variant="secondary"
            compact
            disabled={!/^[a-zA-Z][\w]*(\.[\w]+)+$/.test(newPkg.trim())}
            onPress={() => {
              toggleExcluded(newPkg.trim(), true);
              setNewPkg('');
            }}
            style={{ alignSelf: 'flex-start' }}
          />
        </Section>

        <Section title="Daily brief">
          <Toggle label="Morning brief" hint="A notification each morning. If the phone delays it, it’s built when you open the app." value={settings.briefEnabled} onChange={(v) => updateSettings({ briefEnabled: v })} />
          <Segmented label="Brief time" value={settings.briefTime} onChange={(v) => updateSettings({ briefTime: v })} options={['06:00', '06:30', '07:00', '07:30', '08:00'].map((t) => ({ value: t, label: t }))} />
        </Section>

        <Section title="Daily routines">
          {routines?.length ? (
            routines.map((r) => (
              <View key={r.id} style={styles.routineRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bodyStrong">{r.title}</Txt>
                  <Txt variant="small" color={p.textSecondary} numberOfLines={2}>
                    Every day at {r.time} · {r.instruction}
                  </Txt>
                </View>
                <Button
                  label="Stop"
                  variant="ghost"
                  compact
                  onPress={async () => {
                    await rt.engine.routines.remove(r.id);
                    bump();
                  }}
                />
              </View>
            ))
          ) : (
            <Txt variant="small" color={p.textSecondary}>
              None yet. Ask in chat, for example “Send me a different Bible verse every morning at 7.”
            </Txt>
          )}
        </Section>

        <Section title="Voice and feedback">
          <Toggle label="Spoken replies" hint="When you talk to me, I answer out loud in a low, steady voice." value={settings.voiceReplies} onChange={(v) => updateSettings({ voiceReplies: v })} />
          <Button label="Test voice" icon="speaker" variant="ghost" compact onPress={() => speak('Optimus online. Standing by.', { rate: settings.voiceRate, pitch: settings.voicePitch })} style={{ alignSelf: 'flex-start' }} />
          <Toggle label="Haptics" hint="Light ticks on confirm, send and when I start answering." value={settings.hapticsEnabled} onChange={(v) => updateSettings({ hapticsEnabled: v })} />
          <Toggle label="Sound effects" hint="Subtle clicks. Off by default." value={settings.soundEnabled} onChange={(v) => updateSettings({ soundEnabled: v })} />
        </Section>

        <Section title="Security">
          <Toggle label="App lock" hint="Fingerprint or face on open. Locks again after 5 minutes in the background." value={settings.appLockEnabled} onChange={(v) => updateSettings({ appLockEnabled: v })} />
          <Button label="Activity log" icon="activity" variant="secondary" onPress={() => router.replace('/activity')} />
        </Section>

        <Section title="Memory backup">
          <Txt variant="small" color={p.textSecondary}>
            An encrypted file with all memories and conversations, so I remember you on a new phone. Tokens and keys are never included.
          </Txt>
          <Field label="Backup passphrase" value={passphrase} onChangeText={setPassphrase} secureTextEntry placeholder="At least 8 characters" autoCapitalize="none" />
          <View style={styles.rowBetween}>
            <Button label={busy === 'export' ? 'Encrypting' : 'Export'} icon="upload" variant="secondary" onPress={doExport} disabled={!!busy || passphrase.length < 8} style={{ flex: 1 }} />
            <Button label={busy === 'import' ? 'Restoring' : 'Restore'} icon="download" variant="secondary" onPress={doImport} disabled={!!busy || passphrase.length < 8} style={{ flex: 1 }} />
          </View>
          <Txt variant="small" color={p.textTertiary}>
            Restoring replaces the memories and conversations on this phone.
          </Txt>
          {backupMsg && (
            <Txt variant="small" color={backupMsg.ok ? p.text : p.redGlow}>
              {backupMsg.text}
            </Txt>
          )}
        </Section>

        <Section title="Wipe">
          {wipeArmed ? (
            <Banner
              title="Wipe everything?"
              body="Deletes all memories, conversations, captured notifications, reminders and settings from this phone, and signs out of email. This can’t be undone."
              action={{ label: 'Wipe all data', onPress: wipe }}
              onDismiss={() => setWipeArmed(false)}
            />
          ) : (
            <Button label="Wipe all local data" icon="trash" variant="secondary" onPress={() => setWipeArmed(true)} />
          )}
        </Section>

        <Txt variant="mono" color={p.textTertiary} style={{ textAlign: 'center', marginTop: space.md }}>
          OPTIMUS 1.0.0 · ALL DATA ENCRYPTED ON DEVICE
        </Txt>
      </Screen>
      <Dock />
    </View>
  );
}

const styles = StyleSheet.create({
  routineRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  usageRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.md, flexWrap: 'wrap' },
  track: { height: 2, width: '100%' },
  fill: { height: 2 },
});
