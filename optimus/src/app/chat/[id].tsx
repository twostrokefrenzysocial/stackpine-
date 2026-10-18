import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ChatMessage } from '../../core/types';
import { formatDay } from '../../core/util/time';
import { useVoiceInput } from '../../platform/voice';
import { useApp, useData } from '../../ui/AppContext';
import { Avatar } from '../../ui/components/Avatar';
import { Banner } from '../../ui/components/Banner';
import { Button } from '../../ui/components/Button';
import { Composer } from '../../ui/components/Composer';
import { Icon } from '../../ui/components/Icon';
import { AssistantBlock, MessageView } from '../../ui/components/Message';
import { PanelSurface } from '../../ui/components/Panel';
import { Backdrop } from '../../ui/components/Screen';
import { Txt } from '../../ui/components/Txt';
import { activeConversation } from '../../ui/useAppLifecycle';
import { useChat } from '../../ui/useChat';
import { space } from '../../ui/theme';

const SUGGESTIONS = ['What did I miss?', "What's on my schedule today?", 'Reply to Sarah about her email', 'Find the photo of my parking spot'];

export default function Chat() {
  const { id, voice, q } = useLocalSearchParams<{ id: string; voice?: string; q?: string }>();
  const { rt, palette: p } = useApp();
  const insets = useSafeAreaInsets();
  const [created, setCreated] = useState<string | null>(null);
  const convId = id && id !== 'new' ? id : created;
  const [historyOpen, setHistoryOpen] = useState(false);
  const chat = useChat(convId);
  const list = useRef<FlatList<ChatMessage>>(null);
  const lastSpoken = useRef(false);
  const pendingVoice = useRef(voice === '1');
  const pendingQ = useRef(q);

  useEffect(() => {
    if (id !== 'new') return;
    rt.engine.conversations.create().then((c) => {
      setCreated(c.id);
      router.setParams({ id: c.id });
    });
  }, [id, rt]);

  useEffect(() => {
    activeConversation.id = convId;
    return () => {
      activeConversation.id = null;
    };
  }, [convId]);

  const mic = useVoiceInput((text) => {
    lastSpoken.current = true;
    chat.send(text, { spoken: true });
  });

  useEffect(() => {
    chat.setAvatar((a) => (mic.listening ? 'listening' : a === 'listening' ? 'idle' : a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mic.listening]);

  // Voice mode (widget / shortcut) and prefilled questions.
  useEffect(() => {
    if (!convId) return;
    if (pendingVoice.current) {
      pendingVoice.current = false;
      mic.start();
    } else if (pendingQ.current) {
      const text = pendingQ.current;
      pendingQ.current = undefined;
      chat.send(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId]);

  const items = chat.messages;
  const empty = items.length === 0 && !chat.streaming;

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      {/* Top bar */}
      <View style={[styles.top, { paddingTop: insets.top + space.xs }]}>
        <Button label="Back" icon="chevronLeft" iconOnly variant="ghost" compact onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <Avatar size={44} state={chat.avatar} level={chat.avatar === 'listening' ? mic.level : chat.speechLevel} />
        <View style={{ flex: 1 }}>
          <Txt variant="heading" numberOfLines={1}>
            Optimus
          </Txt>
          <Txt variant="mono" color={chat.avatar === 'idle' ? p.textFaint : p.cyanText} style={{ fontSize: 11 }}>
            {chat.avatar === 'idle' ? (rt.isDemoBrain() ? 'DEMO BRAIN · OFFLINE' : 'ONLINE') : chat.avatar.toUpperCase()}
          </Txt>
        </View>
        <Button label="Conversation history" icon="history" iconOnly variant="ghost" compact onPress={() => setHistoryOpen(true)} />
        <Button
          label="New conversation"
          icon="plus"
          iconOnly
          variant="ghost"
          compact
          onPress={() => router.replace('/chat/new')}
        />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {empty ? (
          <View style={styles.empty}>
            <Avatar size={150} state={chat.avatar} level={mic.level} />
            <Txt variant="title" style={{ textAlign: 'center' }}>
              Standing by.
            </Txt>
            <View style={{ gap: space.sm, alignSelf: 'stretch' }}>
              {SUGGESTIONS.map((s) => (
                <Button key={s} label={s} variant="secondary" compact onPress={() => chat.send(s)} />
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={list}
            data={items}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <MessageView m={item} />}
            contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }}
            onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
            ListFooterComponent={
              <>
                {chat.streaming && <AssistantBlock text={chat.streaming.text} cards={chat.streaming.cards} activity={chat.streaming.activity} streaming />}
                {chat.error && <Banner title={chat.error.title} body={chat.error.body} tone="amber" onDismiss={() => chat.setError(null)} action={{ label: 'Settings', onPress: () => router.push('/settings') }} />}
              </>
            }
            keyboardShouldPersistTaps="handled"
          />
        )}
        {mic.error && (
          <View style={{ paddingHorizontal: space.lg }}>
            <Txt variant="small" color={p.amberText}>
              {mic.error}
            </Txt>
          </View>
        )}
        <View style={{ paddingHorizontal: space.md, paddingBottom: insets.bottom + space.sm, paddingTop: space.xs }}>
          <Composer
            onSend={(t) => chat.send(t)}
            onMic={mic.start}
            onStopMic={mic.stop}
            listening={mic.listening}
            partial={mic.partial}
            level={mic.level}
            busy={!!chat.streaming}
            onStop={chat.stop}
          />
        </View>
      </KeyboardAvoidingView>

      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} current={convId} />
    </View>
  );
}

function HistoryDrawer({ open, onClose, current }: { open: boolean; onClose: () => void; current: string | null }) {
  const { rt, palette: p, reduceMotion } = useApp();
  const insets = useSafeAreaInsets();
  const { data } = useData(() => rt.engine.conversations.list(80), [open]);
  const x = useSharedValue(-1);
  const [w, setW] = useState(320);

  useEffect(() => {
    x.value = reduceMotion ? (open ? 0 : -1) : withTiming(open ? 0 : -1, { duration: 280, easing: Easing.out(Easing.cubic) });
  }, [open, x, reduceMotion]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * (w + 20) }] }));

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: p.scrim }]} onPress={onClose} accessibilityLabel="Close history" />
      <Animated.View style={[styles.drawer, { paddingTop: insets.top + space.md, paddingBottom: insets.bottom }, style]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        <PanelSurface width={w} height={2000} c={0} />
        <View style={styles.drawerHead}>
          <Icon name="history" size={20} color={p.cyanText} />
          <Txt variant="heading" style={{ flex: 1 }} accessibilityRole="header">
            History
          </Txt>
          <Button label="Close" icon="close" iconOnly compact variant="ghost" onPress={onClose} />
        </View>
        <FlatList
          data={data ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingHorizontal: space.md, gap: space.xs }}
          ListEmptyComponent={
            <Txt variant="small" color={p.textDim} style={{ padding: space.md }}>
              No past conversations yet.
            </Txt>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                onClose();
                if (item.id !== current) router.replace(`/chat/${item.id}`);
              }}
              style={[styles.convRow, { borderColor: item.id === current ? p.cyan : p.seam, backgroundColor: item.id === current ? p.inset : 'transparent' }]}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${formatDay(item.updatedAt)}`}
            >
              <Txt variant="smallStrong" numberOfLines={1}>
                {item.title}
              </Txt>
              <Txt variant="mono" color={p.textFaint} style={{ fontSize: 11 }}>
                {formatDay(item.updatedAt).toUpperCase()}
              </Txt>
            </Pressable>
          )}
        />
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm, paddingBottom: space.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingHorizontal: space.xl },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '84%', maxWidth: 380, overflow: 'hidden' },
  drawerHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, marginBottom: space.md },
  convRow: { borderWidth: 1, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: 56, justifyContent: 'center', gap: 2 },
});
