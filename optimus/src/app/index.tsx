import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BriefStore, generateBrief } from '../core/brief/brief';
import type { DailyBrief } from '../core/types';
import { formatDay, formatTime, isoDay, relativeTime } from '../core/util/time';
import { ensureTodaysBrief } from '../platform/briefRunner';
import { useApp, useData } from '../ui/AppContext';
import { EventsCard } from '../ui/cards/DataCards';
import { Banner } from '../ui/components/Banner';
import { Brain } from '../ui/components/Brain';
import { Button } from '../ui/components/Button';
import { Dock } from '../ui/components/Dock';
import { Icon } from '../ui/components/Icon';
import { HudCorners, Panel } from '../ui/components/Panel';
import { LinearFade, Screen } from '../ui/components/Screen';
import { StatusStrip } from '../ui/components/StatusStrip';
import { Txt } from '../ui/components/Txt';
import { feedback } from '../ui/feedback';
import { GUTTER, TOUCH, radius, space } from '../ui/theme';

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

async function userName(rt: ReturnType<typeof useApp>['rt'], fallback?: string): Promise<string | undefined> {
  if (fallback) return fallback;
  for (const m of await rt.engine.memory.list('About Me')) {
    const match = m.content.match(/\bname is ([A-Z][a-z]+)/i) ?? m.content.match(/^(?:goes by|called) ([A-Z][a-z]+)/i);
    if (match) return match[1][0].toUpperCase() + match[1].slice(1);
  }
  return undefined;
}

export default function Home() {
  const { rt, settings, palette: p } = useApp();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [regenerating, setRegenerating] = useState(false);
  const [now] = useState(() => new Date());

  const { data } = useData(async () => {
    const store = new BriefStore(rt.db);
    const today = isoDay(new Date());
    let brief: (DailyBrief & { live?: boolean; unavailable?: string[] }) | null = (await store.forDate(today)) ?? (await ensureTodaysBrief(rt).catch(() => null));
    let offline = false;
    if (!brief || brief.date !== today) {
      // Before the brief time: a live view of today, not saved.
      try {
        brief = { ...(await generateBrief({ sources: rt.sources(), episodes: rt.engine.episodes, reminders: rt.engine.reminders })), live: true };
      } catch {
        brief = await store.latest();
        offline = true;
      }
    }
    const [name, reminders, pendingMemories] = await Promise.all([userName(rt, settings.userName), rt.engine.reminders.upcoming(5), rt.engine.memory.listPending()]);
    return { brief, offline, name, reminders, pendingMemories: pendingMemories.length };
  }, [settings.dataMode, settings.userName]);

  const brief = data?.brief;
  const brainSize = Math.round(Math.min(width * 0.66, 340));
  const voice = () => {
    feedback.fire('tap');
    router.push('/chat/new?voice=1');
  };

  const regenerate = async () => {
    setRegenerating(true);
    await ensureTodaysBrief(rt, { force: true }).catch(() => null);
    setRegenerating(false);
    router.replace('/');
  };

  if (!settings.onboardingDone) return <Redirect href="/onboarding" />;

  const mode = [settings.dataMode === 'mock' ? 'MOCK DATA' : 'LIVE DATA', rt.isDemoBrain() ? 'DEMO CORE' : 'ONLINE'].join(' · ');

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Screen contentStyle={{ paddingBottom: insets.bottom + 200 }}>
        <View style={styles.strip}>
          <StatusStrip state="idle" />
          <Txt variant="mono" color={p.textTertiary}>
            {mode}
          </Txt>
        </View>

        {/* The brain: tap to talk, long press for assistant settings. */}
        <View style={[styles.brainWrap, { width: brainSize + 24, height: brainSize + 24 }]}>
          <HudCorners color={p.textTertiary} size={14} />
          <Brain size={brainSize} state="idle" onPress={voice} onLongPress={() => router.push('/settings')} />
        </View>

        <View style={styles.greeting}>
          <Txt variant="mono" color={p.textSecondary}>
            {formatDay(now.toISOString()).toUpperCase()} · {formatTime(now.toISOString())}
          </Txt>
          <Txt variant="display" accessibilityRole="header">
            {greeting(now)}
            {data?.name ? `, ${data.name}` : ''}.
          </Txt>
          {brief && (
            <Txt variant="body" color={p.textSecondary}>
              {brief.narrative ?? brief.headline}
            </Txt>
          )}
          {!!brief?.unavailable?.length && (
            <Txt variant="mono" color={p.textTertiary}>
              NO ACCESS: {brief.unavailable.join(', ').toUpperCase()}
            </Txt>
          )}
        </View>

        <View style={{ gap: space.md }}>
          {data?.offline && <Banner icon="offline" title="Offline" body={`Showing your last brief from ${brief ? formatDay(brief.generatedAt) : 'earlier'}. Conversations and memories still work.`} />}

          {brief && <EventsCard events={brief.schedule} code="01" label="Schedule" index={0} />}

          {brief && brief.peopleWaiting.length > 0 && (
            <Panel code="02" label="Waiting on you" index={1}>
              <View style={{ gap: space.lg }}>
                {brief.peopleWaiting.map((w) => (
                  <View key={`${w.name}-${w.channel}`} style={styles.row} accessible accessibilityLabel={`${w.name} by ${w.channel}: ${w.preview}`}>
                    <Icon name={w.channel === 'text' ? 'message' : 'mail'} size={18} color={p.textSecondary} />
                    <View style={{ flex: 1 }}>
                      <View style={styles.rowTop}>
                        <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                          {w.name}
                        </Txt>
                        <Txt variant="mono" color={p.textTertiary}>
                          {relativeTime(w.at).toUpperCase()}
                        </Txt>
                      </View>
                      <Txt variant="small" color={p.textSecondary} numberOfLines={2}>
                        {w.preview}
                      </Txt>
                    </View>
                  </View>
                ))}
              </View>
            </Panel>
          )}

          {brief && brief.missed.length > 0 && (
            <Panel code="03" label="Missed calls" index={2}>
              <View style={{ gap: space.md }}>
                {brief.missed.map((m) => (
                  <View key={`${m.label}-${m.at}`} style={styles.row}>
                    <Icon name="phoneMissed" size={18} color={p.red} />
                    <Txt variant="body" style={{ flex: 1 }}>
                      {m.label}
                    </Txt>
                    <Txt variant="mono" color={p.textTertiary}>
                      {relativeTime(m.at).toUpperCase()}
                    </Txt>
                  </View>
                ))}
              </View>
            </Panel>
          )}

          <Panel code="04" label="Reminders" index={3}>
            {data?.reminders.length ? (
              <View style={{ gap: space.md }}>
                {data.reminders.map((r) => (
                  <View key={r.id} style={styles.row} accessible accessibilityLabel={`${r.text}, ${formatDay(r.dueAt)} at ${formatTime(r.dueAt)}`}>
                    <Icon name="clock" size={18} color={p.textSecondary} />
                    <Txt variant="body" style={{ flex: 1 }}>
                      {r.text}
                    </Txt>
                    <Txt variant="mono" color={p.textTertiary}>
                      {formatDay(r.dueAt).toUpperCase()} {formatTime(r.dueAt)}
                    </Txt>
                  </View>
                ))}
              </View>
            ) : (
              <Txt variant="small" color={p.textSecondary}>
                None set. Say “remind me to…”.
              </Txt>
            )}
          </Panel>

          {brief && (brief.openTasks.length > 0 || brief.followUps.length > 0) && (
            <Panel code="05" label="Open loops" index={4}>
              <View style={{ gap: space.md }}>
                {[...brief.followUps, ...brief.openTasks].slice(0, 6).map((t) => (
                  <View key={t} style={styles.row}>
                    <View style={[styles.tick, { backgroundColor: p.textSecondary }]} />
                    <Txt variant="body" style={{ flex: 1 }}>
                      {t}
                    </Txt>
                  </View>
                ))}
              </View>
            </Panel>
          )}

          {!!data?.pendingMemories && (
            <Banner
              tone="info"
              icon="core"
              title={`${data.pendingMemories} memor${data.pendingMemories === 1 ? 'y' : 'ies'} to review`}
              body="Things I noticed in your messages. Nothing is saved until you approve."
              action={{ label: 'Review', onPress: () => router.replace('/memory?tab=pending') }}
            />
          )}

          {brief && !brief.live && (
            <Button label={regenerating ? 'Rebuilding' : 'Rebuild brief'} icon="brief" variant="ghost" compact onPress={regenerate} disabled={regenerating} style={{ alignSelf: 'flex-start' }} />
          )}
        </View>
      </Screen>

      {/* Primary controls in the thumb zone. */}
      <LinearFade style={[styles.fade, { height: insets.bottom + 64 + TOUCH + 48 }]} />
      <View style={[styles.ask, { bottom: insets.bottom + 72 }]}>
        <Pressable onPress={() => router.push('/chat/new')} style={[styles.askField, { backgroundColor: p.surface, borderColor: p.line }]} accessibilityRole="button" accessibilityLabel="Ask Optimus" accessibilityHint="Opens a new conversation">
          <Txt variant="body" color={p.textTertiary}>
            Ask Optimus
          </Txt>
        </Pressable>
        <Button label="Talk to Optimus" icon="mic" iconOnly onPress={voice} accessibilityHint="Opens voice mode" style={{ width: TOUCH + 8, minHeight: TOUCH + 8 }} />
      </View>
      <Dock />
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brainWrap: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginTop: space.xl, marginBottom: space.lg },
  greeting: { gap: space.sm, marginBottom: space.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tick: { width: 8, height: 1 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  ask: { position: 'absolute', left: GUTTER, right: GUTTER, flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  askField: { flex: 1, minHeight: TOUCH + 8, borderWidth: 1, borderRadius: radius.sm, justifyContent: 'center', paddingHorizontal: space.lg },
});
