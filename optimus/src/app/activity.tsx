import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ActivityEntry } from '../core/types';
import { formatDay, formatTime } from '../core/util/time';
import { useApp, useData } from '../ui/AppContext';
import { Segmented } from '../ui/components/Controls';
import { Dock } from '../ui/components/Dock';
import { Icon, type IconName } from '../ui/components/Icon';
import { Panel } from '../ui/components/Panel';
import { Screen } from '../ui/components/Screen';
import { Txt } from '../ui/components/Txt';
import { radius, space } from '../ui/theme';

type Filter = 'all' | 'read' | 'action' | 'suspicious';

const KIND: Record<ActivityEntry['kind'], { icon: IconName; label: string }> = {
  read: { icon: 'search', label: 'READ' },
  action: { icon: 'bolt', label: 'ACTION' },
  memory: { icon: 'core', label: 'MEMORY' },
  suspicious: { icon: 'alert', label: 'FLAGGED' },
  error: { icon: 'alert', label: 'ERROR' },
  system: { icon: 'activity', label: 'SYSTEM' },
};

/** Every tool call Optimus made, what it read or did, plus flagged content. */
export default function Activity() {
  const { rt, palette: p } = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const { data } = useData(async () => {
    const all = await rt.engine.activity.list({ limit: 300 });
    const pending = await rt.engine.actions.listPending();
    return { all, pending: pending.length };
  }, []);

  const entries = (data?.all ?? []).filter((e) => filter === 'all' || (filter === 'action' ? e.kind === 'action' || e.kind === 'memory' : e.kind === filter));
  const flagged = (data?.all ?? []).filter((e) => e.kind === 'suspicious').length;

  // Group by day.
  const groups: { day: string; items: ActivityEntry[] }[] = [];
  for (const e of entries) {
    const day = formatDay(e.at);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(e);
    else groups.push({ day, items: [e] });
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Screen contentStyle={{ gap: space.md }}>
        <Txt variant="display" accessibilityRole="header">
          Activity
        </Txt>
        <Txt variant="mono" color={p.textSecondary}>
          {data ? `${data.all.length} EVENTS · ${flagged} FLAGGED · ${data.pending} AWAITING APPROVAL` : ' '}
        </Txt>
        <Segmented
          label="Filter activity"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'read', label: 'Read' },
            { value: 'action', label: 'Did' },
            { value: 'suspicious', label: `Flagged${flagged ? ` ${flagged}` : ''}` },
          ]}
        />
        {groups.length === 0 && (
          <Panel tone="inset" animate={false}>
            <Txt variant="body" color={p.textSecondary}>
              {filter === 'suspicious' ? 'Nothing suspicious so far. When a message tries to give me instructions, it shows up here.' : 'Nothing yet. Everything I read or do will be listed here.'}
            </Txt>
          </Panel>
        )}
        {groups.map((g, gi) => (
          <Panel key={g.day} label={g.day} index={gi}>
            <View style={{ gap: 2 }}>
              {g.items.map((e) => {
                const k = KIND[e.kind];
                const alert = e.kind === 'suspicious' || e.kind === 'error';
                const expanded = open === e.id;
                return (
                  <Pressable
                    key={e.id}
                    onPress={() => setOpen(expanded ? null : e.id)}
                    disabled={!e.detail}
                    accessibilityRole={e.detail ? 'button' : 'text'}
                    accessibilityLabel={`${k.label}, ${formatTime(e.at)}: ${e.summary}`}
                    accessibilityHint={e.detail ? 'Shows details' : undefined}
                    style={({ pressed }) => [styles.row, { backgroundColor: pressed ? p.surfaceRaised : 'transparent', borderLeftColor: alert ? p.red : 'transparent' }]}
                  >
                    <Icon name={k.icon} size={16} color={alert ? p.redGlow : p.textSecondary} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={styles.top}>
                        <Txt variant="mono" color={alert ? p.redGlow : p.textTertiary}>
                          {k.label}
                          {e.tool ? ` · ${e.tool.toUpperCase()}` : ''}
                        </Txt>
                        <Txt variant="mono" color={p.textTertiary}>
                          {formatTime(e.at)}
                        </Txt>
                      </View>
                      <Txt variant="small">{e.summary}</Txt>
                      {expanded && e.detail && (
                        <Txt variant="mono" color={p.textSecondary} selectable style={{ marginTop: space.xs }}>
                          {e.detail}
                        </Txt>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Panel>
        ))}
      </Screen>
      <Dock />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.sm, borderLeftWidth: 2, borderRadius: radius.sm, minHeight: 48 },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
});
