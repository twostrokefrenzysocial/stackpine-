import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ChatCard } from '../core/types';
import { useVoiceInput, stopSpeaking } from '../platform/voice';
import { useApp } from '../ui/AppContext';
import { ChatCardView } from '../ui/cards/DataCards';
import { Brain } from '../ui/components/Brain';
import { Icon } from '../ui/components/Icon';
import { Txt } from '../ui/components/Txt';
import { feedback } from '../ui/feedback';
import { useChat } from '../ui/useChat';
import { TOUCH, space } from '../ui/theme';

type Phase = 'starting' | 'listening' | 'thinking' | 'speaking' | 'idle';

const LABEL: Record<Phase, string> = {
  starting: 'Starting',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  idle: 'Tap to talk',
};

/**
 * Voice mode (optimus://voice, the Home mic, the widget and the Voice
 * shortcut): a hands-free conversation with just the brain on screen. It
 * listens, thinks, answers out loud, then listens again, until you close it
 * or stop talking. Anything you need to see or approve appears at the bottom.
 */
export default function Voice() {
  const { rt, palette: p } = useApp();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { conv } = useLocalSearchParams<{ conv?: string }>();
  const [convId, setConvId] = useState<string | null>(conv ?? null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [cards, setCards] = useState<ChatCard[]>([]);
  const chat = useChat(convId);
  const open = useRef(true);
  // The mic's start, reachable from its own callback.
  const listenAgain = useRef<() => void>(() => undefined);

  const mic = useVoiceInput(async (text) => {
    setPhase('thinking');
    setCards([]);
    const reply = await chat.send(text, {
      voice: true,
      onSpoken: () => {
        setPhase('idle');
        // Hands-free: listen again after each answer, until the screen closes.
        if (open.current) listenAgain.current();
      },
    });
    if (reply?.cards.length) setCards(reply.cards.filter((c) => c.type === 'confirm' || c.type === 'photos' || c.type === 'events' || c.type === 'suspicious'));
    if (!reply) setPhase('idle');
  });

  useEffect(() => {
    listenAgain.current = mic.start;
  }, [mic.start]);

  useEffect(() => {
    if (!conv) rt.engine.conversations.create().then((c) => setConvId(c.id));
    return () => {
      open.current = false;
      stopSpeaking();
      mic.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start listening as soon as the conversation exists.
  useEffect(() => {
    if (convId) mic.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId]);

  // Derive what's happening from the mic and the reply.
  const live: Phase = mic.listening ? 'listening' : chat.streaming ? 'thinking' : chat.avatar === 'responding' ? 'speaking' : phase === 'starting' && !convId ? 'starting' : phase === 'thinking' ? 'thinking' : 'idle';
  const brainState = live === 'listening' ? 'listening' : live === 'thinking' ? 'thinking' : live === 'speaking' ? 'responding' : 'idle';

  const tapBrain = () => {
    feedback.fire('tap');
    if (live === 'speaking') {
      // Interrupt and listen.
      stopSpeaking();
      chat.setAvatar('idle');
      mic.start();
    } else if (live === 'listening') mic.stop();
    else if (live === 'thinking') chat.stop();
    else mic.start();
  };

  const close = () => {
    open.current = false;
    stopSpeaking();
    mic.stop();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const size = Math.round(Math.min(width - space.xl * 2, 420));
  return (
    <View style={[styles.root, { backgroundColor: p.bg, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }]}>
      <View style={styles.center}>
        <Brain size={size} state={brainState} micLevel={mic.level} speechLevel={chat.speechLevel} onPress={tapBrain} accessibilityLabel={`Optimus, ${LABEL[live].toLowerCase()}`} />
        <Txt variant="label" color={live === 'idle' ? p.textTertiary : p.text} style={{ marginTop: space.lg }} accessibilityLiveRegion="polite">
          {LABEL[live]}
        </Txt>
        {(mic.error || chat.error) && (
          <Txt variant="small" color={p.redGlow} style={{ textAlign: 'center', marginTop: space.sm, maxWidth: 320 }}>
            {mic.error ?? chat.error?.body}
          </Txt>
        )}
      </View>

      {cards.length > 0 && (
        <ScrollView style={styles.cards} contentContainerStyle={{ gap: space.sm }}>
          {cards.map((c, i) => (
            <ChatCardView key={`${c.type}-${i}`} card={c} index={i} />
          ))}
        </ScrollView>
      )}

      <View style={styles.controls}>
        <Pressable
          onPress={() => {
            close();
            if (convId) setTimeout(() => router.push(`/chat/${convId}`), 50);
          }}
          style={[styles.round, { backgroundColor: p.surface }]}
          accessibilityRole="button"
          accessibilityLabel="Show this conversation as text"
        >
          <Icon name="chat" size={22} color={p.text} />
        </Pressable>
        <Pressable onPress={tapBrain} style={[styles.round, styles.big, { backgroundColor: live === 'listening' ? p.red : p.ink }]} accessibilityRole="button" accessibilityLabel={live === 'listening' ? 'Stop listening' : live === 'speaking' ? 'Interrupt' : 'Talk'}>
          <Icon name={live === 'listening' ? 'stop' : 'mic'} size={28} color={p.onInk} />
        </Pressable>
        <Pressable onPress={close} style={[styles.round, { backgroundColor: p.surface }]} accessibilityRole="button" accessibilityLabel="End voice mode">
          <Icon name="close" size={22} color={p.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cards: { maxHeight: 320, marginBottom: space.lg },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.xxl },
  round: { width: TOUCH + 8, height: TOUCH + 8, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  big: { width: TOUCH + 28, height: TOUCH + 28 },
});
