import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import type { PendingAction } from '../../core/types';
import { formatDay, formatTime } from '../../core/util/time';
import { useApp, useData } from '../AppContext';
import { feedback } from '../feedback';
import { Button } from '../components/Button';
import { Field } from '../components/Controls';
import { Icon } from '../components/Icon';
import { Panel } from '../components/Panel';
import { Txt } from '../components/Txt';
import { space } from '../theme';

const s = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v));

function when(iso: unknown): string {
  const t = s(iso);
  if (!t) return '';
  return `${formatDay(t)} · ${formatTime(t)}`;
}

/** Field rows describing the full draft, per action kind. */
function draftRows(a: PendingAction): { label: string; value: string; key?: string; multiline?: boolean }[] {
  const d = a.draft;
  switch (a.kind) {
    case 'send_text':
      return [
        { label: 'To', value: s(d.toName) ? `${s(d.toName)} (${s(d.to)})` : s(d.to) },
        { label: 'Message', value: s(d.body), key: 'body', multiline: true },
      ];
    case 'start_call':
      return [{ label: 'Call', value: s(d.toName) ? `${s(d.toName)} · ${s(d.to)}` : s(d.to) }];
    case 'create_event':
    case 'edit_event':
      return [
        { label: 'Title', value: s(d.title), key: 'title' },
        { label: 'Starts', value: when(d.start), key: 'start' },
        { label: 'Ends', value: when(d.end), key: 'end' },
        ...(s(d.location) || a.editable.includes('location') ? [{ label: 'Location', value: s(d.location), key: 'location' }] : []),
        ...(s(d.notes) ? [{ label: 'Notes', value: s(d.notes), key: 'notes', multiline: true }] : []),
      ];
    case 'delete_event':
      return [
        { label: 'Event', value: s(d.title) },
        { label: 'When', value: when(d.start) },
      ];
    case 'send_email':
      return [
        { label: 'To', value: s(d.to), key: 'to' },
        { label: 'Subject', value: s(d.subject), key: 'subject' },
        { label: 'Message', value: s(d.body), key: 'body', multiline: true },
      ];
    case 'save_memory_from_data':
      return [
        { label: s(d.category) || 'Memory', value: s(d.content), key: 'content', multiline: true },
        { label: 'Learned from', value: s(d.source) },
      ];
    case 'delete_memory':
      return [{ label: s(d.category) || 'Memory', value: s(d.content) }];
    case 'create_reminder':
      return [
        { label: 'Remind me', value: s(d.text), key: 'text', multiline: true },
        { label: 'When', value: when(d.dueAt), key: 'dueAt' },
      ];
  }
}

const STATUS: Record<PendingAction['status'], { label: string; icon: 'check' | 'close' | 'alert' | 'clock' }> = {
  pending: { label: 'Awaiting approval', icon: 'clock' },
  approved: { label: 'Executing', icon: 'clock' },
  executed: { label: 'Done', icon: 'check' },
  failed: { label: 'Failed', icon: 'alert' },
  cancelled: { label: 'Cancelled', icon: 'close' },
};

/**
 * Safety rule 2 in UI form: the full draft, with Approve / Edit / Cancel.
 * Locks into place with two clamps and a click when it appears.
 */
export function ConfirmCard({ actionId }: { actionId: string }) {
  const { rt, palette: p, reduceMotion } = useApp();
  const { data: action } = useData(() => rt.engine.actions.get(actionId), [actionId]);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clamp = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    clamp.value = withSequence(withTiming(1.08, { duration: 220, easing: Easing.out(Easing.cubic) }), withTiming(1, { duration: 90 }));
    const t = setTimeout(() => feedback.fire('confirm'), 230);
    return () => clearTimeout(t);
  }, [clamp, reduceMotion]);
  const leftClamp = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - clamp.value) * -24 }], opacity: Math.min(1, clamp.value * 1.5) }));
  const rightClamp = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - clamp.value) * 24 }], opacity: Math.min(1, clamp.value * 1.5) }));

  if (!action) return null;
  const pending = action.status === 'pending';
  const rows = draftRows(action);
  const st = STATUS[action.status];
  const tone = action.status === 'failed' ? 'danger' : pending ? 'amber' : action.status === 'executed' ? 'cyan' : 'default';
  const destructive = action.kind === 'delete_event' || action.kind === 'delete_memory';

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing && Object.keys(edits).length) await rt.engine.actions.edit(action.id, normalizeEdits(action, edits));
      setEditing(false);
      const r = await rt.engine.actions.approve(action.id);
      feedback.fire(r.status === 'executed' ? 'confirm' : 'error');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.clamp, styles.clampL, { backgroundColor: p.amber }, leftClamp]} />
      <Animated.View style={[styles.clamp, styles.clampR, { backgroundColor: p.amber }, rightClamp]} />
      <Panel
        tone={tone}
        code="CONFIRM"
        label={action.title}
        rivets
        assemble={false}
        right={
          <View style={styles.status} accessibilityLabel={`Status: ${st.label}`}>
            <Icon name={st.icon} size={16} color={tone === 'danger' ? p.dangerText : tone === 'cyan' ? p.cyanText : p.amberText} />
            <Txt variant="label" color={tone === 'danger' ? p.dangerText : tone === 'cyan' ? p.cyanText : p.amberText}>
              {st.label}
            </Txt>
          </View>
        }
      >
        <View style={{ gap: space.md }}>
          {rows.map((r) =>
            editing && r.key && action.editable.includes(r.key) ? (
              <Field
                key={r.label}
                label={r.label}
                defaultValue={r.key === 'start' || r.key === 'end' || r.key === 'dueAt' ? s(action.draft[r.key]) : r.value}
                onChangeText={(v) => setEdits((e) => ({ ...e, [r.key!]: v }))}
                multiline={r.multiline}
                style={r.multiline ? { minHeight: 96, textAlignVertical: 'top', paddingTop: space.sm } : undefined}
              />
            ) : (
              <View key={r.label} style={{ gap: 2 }}>
                <Txt variant="label" color={p.textFaint}>
                  {r.label}
                </Txt>
                <Txt variant="body" selectable>
                  {r.value || '—'}
                </Txt>
              </View>
            ),
          )}
          {action.resultMessage && !pending && (
            <Txt variant="smallStrong" color={action.status === 'failed' ? p.dangerText : p.textDim}>
              {action.resultMessage}
            </Txt>
          )}
          {error && (
            <Txt variant="smallStrong" color={p.dangerText}>
              {error}
            </Txt>
          )}
          {pending && (
            <View style={styles.actions}>
              <Button label={editing ? 'Approve edits' : 'Approve'} icon="check" variant={destructive ? 'danger' : 'amber'} onPress={approve} disabled={busy} feedbackKind="confirm" style={{ flex: 1.4 }} accessibilityHint="Runs this action now" />
              {action.editable.length > 0 && !editing && <Button label="Edit" icon="edit" variant="secondary" onPress={() => setEditing(true)} disabled={busy} style={{ flex: 1 }} />}
              <Button label="Cancel" icon="close" variant="ghost" onPress={() => rt.engine.actions.cancel(action.id)} disabled={busy} style={{ flex: 1 }} />
            </View>
          )}
        </View>
      </Panel>
    </View>
  );
}

function normalizeEdits(a: PendingAction, edits: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(edits)) {
    if (k === 'to' && a.kind === 'send_email') out[k] = v.split(',').map((x) => x.trim()).filter(Boolean);
    else if (k === 'start' || k === 'end' || k === 'dueAt') {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new Error(`“${v}” isn’t a valid date/time. Use a format like 2026-10-20T14:00.`);
      out[k] = d.toISOString();
    } else out[k] = v;
  }
  return out;
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', marginVertical: space.xs },
  clamp: { position: 'absolute', top: 18, width: 4, height: 28, zIndex: 2 },
  clampL: { left: -3 },
  clampR: { right: -3 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs, flexWrap: 'wrap' },
});
