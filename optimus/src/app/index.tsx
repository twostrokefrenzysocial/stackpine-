import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BriefStore, generateBrief } from '../core/brief/brief';
import type { DailyBrief } from '../core/types';
import { formatDay, formatTime, isoDay, relativeTime } from '../core/util/time';
import { ensureTodaysBrief } from '../platform/briefRunner';
import { useApp, useData } from '../ui/AppContext';
import { EventsCard } from '../ui/cards/DataCards';
import { Avatar } from '../ui/components/Avatar';
import { Banner } from '../ui/components/Banner';
import { Button } from '../ui/components/Button';
import { Dock } from '../ui/components/Dock';
import { Icon, StatusDot } from '../ui/components/Icon';
import { Panel } from '../ui/components/Panel';
import { LinearFade, Screen } from '../ui/components/Screen';
import { Txt } from '../ui/components/Txt';
import { space, TOUCH } from '../ui/theme';

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

async function userName(rt: ReturnType<typeof useApp>['rt'], fallback?: string): Promise<string | undefined> {
  if (fallback) return fallback;
  const about = await rt.engine.memory.list('About Me');
  for (const m of about) {
    const match = m.content.match(/\bname is ([A-Z][a-z]+)/i) ?? m.content.match(/^(?:goes by|called) ([A-Z][a-z]+)/i);
    if (match) return match[1][0].toUpperCase() + match[1].slice(1);
  }
  return undefined;
}

export default function Home() {
  const { rt, settings, palette: p } = useApp();
  const insets = useSafeAreaInsets();
  const [regenerating, setRegenerating] = useState(false);

  const { data } = useData(async () => {
    const store = new BriefStore(rt.db);
    const today = isoDay(new Date());
    let brief: (DailyBrief & { live?: boolean; unavailable?: string[] }) | null = (await store.forDate(today)) ?? (await ensureTodaysBrief(rt).catch(() => null));
    let offline = false;
    if (!brief || brief.date !== today) {
      // Before the brief time: show a live view of today without saving it.
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

  const now = new Date();
  const brief = data?.brief;

  const regenerate = async () => {
    setRegenerating(true);
    await ensureTodaysBrief(rt, { force: true }).catch(() => null);
    setRegenerating(false);
    router.replace('/');
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen contentStyle={{ gap: space.md, paddingBottom: insets.bottom + 180 }}>
        {/* Header: avatar + greeting */}
        <View style={styles.header}>
          <Avatar size={104} state="idle" />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="label" color={p.cyanText}>
              {formatDay(now.toISOString()).toUpperCase()} · {formatTime(now.toISOString())}
            </Txt>
            <Txt variant="hero" accessibilityRole="header">
              {greeting(now)}
              {data?.name ? `, ${data.name}` : ''}.
            </Txt>
            <View style={styles.badges}>
              {settings.dataMode === 'mock' && <Badge label="Mock data" tone="amber" />}
              {rt.isDemoBrain() && <Badge label="Demo brain" tone="amber" />}
              {!rt.isDemoBrain() && <Badge label="Online" tone="cyan" />}
            </View>
          </View>
        </View>

        {data?.offline && <Banner icon="offline" title="Offline" body={`Showing your last brief from ${brief ? formatDay(brief.generatedAt) : 'earlier'}. Conversations and memories are still available.`} />}

        {brief && (
          <Panel code="00" label={brief.live ? 'Today so far' : 'Daily brief'} rivets index={0} right={!brief.live ? <Txt variant="mono" color={p.textFaint}>{formatTime(brief.generatedAt)}</Txt> : undefined}>
            <Txt variant="bodyStrong">{brief.headline}</Txt>
            {brief.narrative && (
              <Txt variant="body" color={p.textDim} style={{ marginTop: space.sm }}>
                {brief.narrative}
              </Txt>
            )}
            {!!brief.unavailable?.length && (
              <Txt variant="small" color={p.amberText} style={{ marginTop: space.sm }}>
                Can’t see: {brief.unavailable.join(', ')}.
              </Txt>
            )}
            {!brief.live && (
              <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
                <Button label={regenerating ? 'Rebuilding' : 'Rebuild brief'} icon="brief" compact variant="ghost" onPress={regenerate} disabled={regenerating} />
              </View>
            )}
          </Panel>
        )}

        {brief && <EventsCard events={brief.schedule} code="01" label="Schedule" index={1} />}

        {brief && brief.peopleWaiting.length > 0 && (
          <Panel code="02" label="Waiting on you" index={2}>
            <View style={{ gap: space.md }}>
              {brief.peopleWaiting.map((w) => (
                <View key={`${w.name}-${w.channel}`} style={styles.waitRow} accessible accessibilityLabel={`${w.name} by ${w.channel}: ${w.preview}`}>
                  <Icon name={w.channel === 'text' ? 'message' : 'mail'} size={18} color={p.cyanText} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.waitTop}>
                      <Txt variant="smallStrong" style={{ flex: 1 }} numberOfLines={1}>
                        {w.name}
                      </Txt>
                      <Txt variant="mono" color={p.textFaint}>
                        {relativeTime(w.at)}
                      </Txt>
                    </View>
                    <Txt variant="small" color={p.textDim} numberOfLines={2}>
                      {w.preview}
                    </Txt>
                  </View>
                </View>
              ))}
            </View>
          </Panel>
        )}

        {brief && brief.missed.length > 0 && (
          <Panel code="03" label="Missed" index={3} tone="amber">
            <View style={{ gap: space.sm }}>
              {brief.missed.map((m) => (
                <View key={`${m.label}-${m.at}`} style={styles.waitRow}>
                  <Icon name="phoneMissed" size={18} color={p.amberText} />
                  <Txt variant="small" style={{ flex: 1 }}>
                    {m.label}
                  </Txt>
                  <Txt variant="mono" color={p.textFaint}>
                    {relativeTime(m.at)}
                  </Txt>
                </View>
              ))}
            </View>
          </Panel>
        )}

        <Panel code="04" label="Reminders" index={4}>
          {data?.reminders.length ? (
            <View style={{ gap: space.sm }}>
              {data.reminders.map((r) => (
                <View key={r.id} style={styles.waitRow} accessible accessibilityLabel={`${r.text}, ${formatDay(r.dueAt)} at ${formatTime(r.dueAt)}`}>
                  <Icon name="clock" size={18} color={p.cyanText} />
                  <Txt variant="small" style={{ flex: 1 }}>
                    {r.text}
                  </Txt>
                  <Txt variant="mono" color={p.textFaint}>
                    {formatDay(r.dueAt).toUpperCase()} {formatTime(r.dueAt)}
                  </Txt>
                </View>
              ))}
            </View>
          ) : (
            <Txt variant="small" color={p.textDim}>
              No upcoming reminders. Say “remind me to…”.
            </Txt>
          )}
        </Panel>

        {brief && (brief.openTasks.length > 0 || brief.followUps.length > 0) && (
          <Panel code="05" label="Open loops" index={5}>
            <View style={{ gap: space.sm }}>
              {[...brief.followUps, ...brief.openTasks].slice(0, 6).map((t) => (
                <View key={t} style={styles.waitRow}>
                  <StatusDot color={p.cyan} />
                  <Txt variant="small" style={{ flex: 1 }}>
                    {t}
                  </Txt>
                </View>
              ))}
            </View>
          </Panel>
        )}

        {!!data?.pendingMemories && (
          <Banner
            tone="cyan"
            icon="core"
            title={`${data.pendingMemories} memor${data.pendingMemories === 1 ? 'y' : 'ies'} to review`}
            body="Things I noticed in your messages. Nothing is saved until you approve."
            action={{ label: 'Review', onPress: () => router.replace('/memory?tab=pending') }}
          />
        )}
      </Screen>

      {/* Ask Optimus */}
      <LinearFade style={[styles.askFade, { height: insets.bottom + 72 + TOUCH + 36 }]} color={p.groundDeep} />
      <View style={[styles.ask, { bottom: insets.bottom + 72 }]}>
        <View style={{ flex: 1 }}>
          <Button label="Ask Optimus" icon="chat" variant="secondary" onPress={() => router.push('/chat/new')} accessibilityHint="Opens a new conversation" />
        </View>
        <Button label="Voice" icon="mic" iconOnly onPress={() => router.push('/chat/new?voice=1')} accessibilityHint="Opens voice mode" style={{ width: TOUCH + 8 }} />
      </View>
      <Dock />
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone: 'amber' | 'cyan' }) {
  const { palette: p } = useApp();
  const color = tone === 'amber' ? p.amberText : p.cyanText;
  return (
    <View style={[styles.badge, { borderColor: tone === 'amber' ? p.amberDim : p.cyanDim }]}>
      <StatusDot color={color} size={7} />
      <Txt variant="label" color={color} style={{ fontSize: 10 }}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginBottom: space.sm },
  badges: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', marginTop: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  waitTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  ask: { position: 'absolute', left: space.lg, right: space.lg, flexDirection: 'row', gap: space.sm },
  askFade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
