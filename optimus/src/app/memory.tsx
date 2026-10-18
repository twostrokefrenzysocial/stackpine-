import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MEMORY_CATEGORIES, type Memory, type PendingMemory } from '../core/types';
import { formatDay, relativeTime } from '../core/util/time';
import { useApp, useData } from '../ui/AppContext';
import { Button } from '../ui/components/Button';
import { Field, Segmented } from '../ui/components/Controls';
import { Dock } from '../ui/components/Dock';
import { Icon, StatusDot } from '../ui/components/Icon';
import { Panel } from '../ui/components/Panel';
import { Backdrop, Screen } from '../ui/components/Screen';
import { Txt } from '../ui/components/Txt';
import { feedback } from '../ui/feedback';
import { space } from '../ui/theme';

type Tab = 'all' | 'people' | 'pending';

const SOURCE_LABEL: Record<string, string> = {
  conversation: 'You told me',
  manual: 'Added by you',
  import: 'Restored from backup',
  sms: 'From a text',
  email: 'From an email',
  calls: 'From your call log',
  notifications: 'From a notification',
  calendar: 'From your calendar',
  contacts: 'From contacts',
  photos: 'From a photo',
};

export default function MemoryCore() {
  const { rt, palette: p } = useApp();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'pending' ? 'pending' : 'all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Memory | null>(null);

  const { data, reload } = useData(async () => {
    const [all, pending] = await Promise.all([rt.engine.memory.list(), rt.engine.memory.listPending()]);
    const hits = query.trim() ? new Set((await rt.engine.memory.search(query, { limit: 100 })).map((h) => h.memory.id)) : null;
    return { all, pending, hits };
  }, [query]);

  const visible = useMemo(() => (data?.hits ? data.all.filter((m) => data.hits!.has(m.id)) : (data?.all ?? [])), [data]);
  const byCategory = useMemo(() => MEMORY_CATEGORIES.map((c) => ({ c, items: visible.filter((m) => m.category === c && (tab !== 'all' || c !== 'People')) })).filter((g) => g.items.length), [visible, tab]);
  const people = visible.filter((m) => m.category === 'People');

  return (
    <View style={{ flex: 1 }}>
      <Screen contentStyle={{ gap: space.md }}>
        <View style={styles.titleRow}>
          <Icon name="core" size={28} color={p.cyanText} />
          <Txt variant="hero" accessibilityRole="header" style={{ flex: 1 }}>
            Memory Core
          </Txt>
        </View>
        <Txt variant="small" color={p.textDim}>
          {data ? `${data.all.length} memories stored on this phone, encrypted.` : ' '}
        </Txt>

        <Button label="What do you know about me?" icon="person" variant="secondary" onPress={() => router.push(`/chat/new?q=${encodeURIComponent('What do you know about me?')}`)} />

        <Field label="Search memories" placeholder="e.g. birthday, Jen, coffee" value={query} onChangeText={setQuery} returnKeyType="search" />

        <Segmented
          label="Memory view"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'all', label: 'By topic' },
            { value: 'people', label: `People${people.length ? ` ${people.length}` : ''}` },
            { value: 'pending', label: `Pending${data?.pending.length ? ` ${data.pending.length}` : ''}` },
          ]}
        />

        {tab === 'pending' ? (
          <PendingList items={data?.pending ?? []} onChange={reload} />
        ) : tab === 'people' ? (
          people.length ? (
            people.map((m, i) => <MemoryPanel key={m.id} m={m} index={i} onPress={() => setEditing(m)} person />)
          ) : (
            <Empty text={query ? 'No people match that search.' : 'No people yet. Tell me about the people in your life, like “My wife is Jen”.'} />
          )
        ) : byCategory.length ? (
          byCategory.map((g, gi) => (
            <Panel key={g.c} code={String(gi + 1).padStart(2, '0')} label={g.c} index={gi}>
              <View style={{ gap: space.xs }}>
                {g.items.map((m) => (
                  <MemoryRow key={m.id} m={m} onPress={() => setEditing(m)} />
                ))}
              </View>
            </Panel>
          ))
        ) : (
          <Empty text={query ? 'Nothing matches that search.' : 'Nothing stored yet. Tell me something to remember, like “Remember that I take my coffee black.”'} />
        )}
      </Screen>
      <Dock />
      <MemoryEditor memory={editing} onClose={() => setEditing(null)} onChanged={reload} />
    </View>
  );
}

function Empty({ text }: { text: string }) {
  const { palette: p } = useApp();
  return (
    <Panel tone="inset" assemble={false}>
      <Txt variant="body" color={p.textDim}>
        {text}
      </Txt>
    </Panel>
  );
}

function ImportanceBar({ value }: { value: number }) {
  const { palette: p } = useApp();
  return (
    <View style={styles.imp} accessibilityLabel={`Importance ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={[styles.impCell, { backgroundColor: i <= value ? p.cyan : p.inset, borderColor: p.seam }]} />
      ))}
    </View>
  );
}

function MemoryRow({ m, onPress }: { m: Memory; onPress: () => void }) {
  const { palette: p } = useApp();
  return (
    <Pressable onPress={onPress} style={styles.memRow} accessibilityRole="button" accessibilityLabel={`${m.content}. ${SOURCE_LABEL[m.source] ?? m.source}. Tap to edit.`}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="body">{m.content}</Txt>
        <Txt variant="mono" color={p.textFaint} style={{ fontSize: 11 }}>
          {(SOURCE_LABEL[m.source] ?? m.source).toUpperCase()} · {m.lastUsedAt ? `USED ${relativeTime(m.lastUsedAt).toUpperCase()}` : 'NOT USED YET'}
          {m.sensitive ? ' · SENSITIVE' : ''}
        </Txt>
      </View>
      <ImportanceBar value={m.importance} />
      <Icon name="chevronRight" size={18} color={p.textFaint} />
    </Pressable>
  );
}

function MemoryPanel({ m, index, onPress, person }: { m: Memory; index: number; onPress: () => void; person?: boolean }) {
  const { palette: p } = useApp();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${m.personName ?? ''} ${m.content}. Tap to edit.`}>
      <Panel code="ID" label={person ? (m.personName ?? 'Person') : m.category} index={index} right={<ImportanceBar value={m.importance} />}>
        {person && !!m.aliases?.length && (
          <Txt variant="mono" color={p.cyanText} style={{ marginBottom: space.xs }}>
            {m.aliases.join(' · ').toUpperCase()}
          </Txt>
        )}
        <Txt variant="body">{m.content}</Txt>
        <Txt variant="mono" color={p.textFaint} style={{ fontSize: 11, marginTop: space.sm }}>
          {m.contactId ? 'LINKED TO CONTACT · ' : ''}
          {(SOURCE_LABEL[m.source] ?? m.source).toUpperCase()}
        </Txt>
      </Panel>
    </Pressable>
  );
}

function PendingList({ items, onChange }: { items: PendingMemory[]; onChange: () => void }) {
  const { rt, palette: p, bump } = useApp();
  const [edits, setEdits] = useState<Record<string, string>>({});
  if (!items.length) return <Empty text="Nothing waiting. When I notice something worth remembering in your messages, I’ll ask here first." />;
  return (
    <>
      <Txt variant="small" color={p.textDim}>
        I noticed these in your data. Nothing is saved until you approve it.
      </Txt>
      {items.map((m, i) => (
        <Panel key={m.id} tone="amber" code="REVIEW" label={m.category} index={i} right={<Txt variant="mono" color={p.textFaint}>{relativeTime(m.createdAt)}</Txt>}>
          <Field label="Memory" defaultValue={m.content} onChangeText={(v) => setEdits((e) => ({ ...e, [m.id]: v }))} multiline style={{ minHeight: 72, textAlignVertical: 'top', paddingTop: space.sm }} />
          <Txt variant="mono" color={p.amberText} style={{ fontSize: 11, marginTop: space.sm }}>
            {m.reason.toUpperCase()}
          </Txt>
          <View style={styles.actions}>
            <Button
              label="Remember"
              icon="check"
              variant="amber"
              feedbackKind="confirm"
              style={{ flex: 1 }}
              onPress={async () => {
                await rt.engine.memory.approvePending(m.id, edits[m.id]);
                await rt.engine.activity.add({ kind: 'memory', summary: `Approved memory: ${(edits[m.id] ?? m.content).slice(0, 60)}` });
                onChange();
                bump();
              }}
            />
            <Button
              label="Discard"
              icon="close"
              variant="ghost"
              style={{ flex: 1 }}
              onPress={async () => {
                await rt.engine.memory.rejectPending(m.id);
                onChange();
                bump();
              }}
            />
          </View>
        </Panel>
      ))}
    </>
  );
}

function MemoryEditor({ memory, onClose, onChanged }: { memory: Memory | null; onClose: () => void; onChanged: () => void }) {
  const { rt, palette: p, bump } = useApp();
  const insets = useSafeAreaInsets();
  const [content, setContent] = useState('');
  const [importance, setImportance] = useState('3');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);

  if (memory && memory.id !== lastId) {
    setLastId(memory.id);
    setContent(memory.content);
    setImportance(String(memory.importance));
    setConfirmDelete(false);
    setError(null);
  }
  if (!memory) return null;

  const save = async () => {
    try {
      if (content.trim() !== memory.content) await rt.engine.memory.update(memory.id, content.trim(), { importance: Number(importance) });
      else await rt.engine.memory.setImportance(memory.id, Number(importance));
      feedback.fire('confirm');
      onChanged();
      bump();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save that.');
    }
  };

  const remove = async () => {
    const { deleted } = await rt.engine.memory.forget(memory.id);
    await rt.engine.activity.add({ kind: 'memory', summary: `Forgot ${deleted.length} memor${deleted.length === 1 ? 'y' : 'ies'}: ${memory.content.slice(0, 60)}` });
    feedback.fire('transform');
    onChanged();
    bump();
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: p.scrim }]} onPress={onClose} accessibilityLabel="Close editor" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <Backdrop />
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
          <View style={styles.titleRow}>
            <StatusDot color={p.cyan} />
            <Txt variant="title" style={{ flex: 1 }}>
              {memory.personName ?? memory.category}
            </Txt>
            <Button label="Close" icon="close" iconOnly compact variant="ghost" onPress={onClose} />
          </View>
          <Field label="Memory" value={content} onChangeText={setContent} multiline style={{ minHeight: 96, textAlignVertical: 'top', paddingTop: space.sm }} />
          <Segmented
            label="Importance"
            value={importance}
            onChange={setImportance}
            options={['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }))}
          />
          <Panel tone="inset" assemble={false}>
            <View style={{ gap: space.xs }}>
              <Meta k="Source" v={SOURCE_LABEL[memory.source] ?? memory.source} />
              <Meta k="Created" v={formatDay(memory.createdAt)} />
              <Meta k="Updated" v={formatDay(memory.updatedAt)} />
              <Meta k="Last used" v={memory.lastUsedAt ? relativeTime(memory.lastUsedAt) : 'Not yet'} />
              {memory.previousValue && <Meta k="Previously" v={memory.previousValue} />}
            </View>
          </Panel>
          {error && (
            <Txt variant="smallStrong" color={p.dangerText}>
              {error}
            </Txt>
          )}
          {confirmDelete ? (
            <Panel tone="danger" assemble={false}>
              <Txt variant="bodyStrong">Forget this completely?</Txt>
              <Txt variant="small" color={p.textDim} style={{ marginTop: 4 }}>
                It’s deleted from this phone, along with anything I worked out only from it.
              </Txt>
              <View style={styles.actions}>
                <Button label="Forget" icon="trash" variant="danger" onPress={remove} style={{ flex: 1 }} feedbackKind="confirm" />
                <Button label="Keep" variant="ghost" onPress={() => setConfirmDelete(false)} style={{ flex: 1 }} />
              </View>
            </Panel>
          ) : (
            <View style={styles.actions}>
              <Button label="Save" icon="check" onPress={save} style={{ flex: 1.4 }} feedbackKind="confirm" />
              <Button label="Forget" icon="trash" variant="ghost" onPress={() => setConfirmDelete(true)} style={{ flex: 1 }} />
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  const { palette: p } = useApp();
  return (
    <View style={{ flexDirection: 'row', gap: space.md }}>
      <Txt variant="label" color={p.textFaint} style={{ width: 92, paddingTop: 2 }}>
        {k}
      </Txt>
      <Txt variant="small" style={{ flex: 1 }}>
        {v}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  memRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.sm },
  imp: { flexDirection: 'row', gap: 2 },
  impCell: { width: 6, height: 14, borderWidth: 1 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%', overflow: 'hidden' },
});

