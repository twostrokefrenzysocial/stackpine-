import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChatMessage } from "../../core/types";
import { followUps } from "../../core/util/followUps";
import { formatDay } from "../../core/util/time";
import { stopSpeaking, useVoiceInput } from "../../platform/voice";
import { useApp, useData } from "../../ui/AppContext";
import { useKeyboardVisible } from "../../ui/useKeyboardVisible";
import { Brain } from "../../ui/components/Brain";
import { Banner } from "../../ui/components/Banner";
import { Button } from "../../ui/components/Button";
import { Composer } from "../../ui/components/Composer";
import { Icon } from "../../ui/components/Icon";
import { AssistantBlock, MessageView } from "../../ui/components/Message";
import { Backdrop } from "../../ui/components/Screen";
import { StatusStrip } from "../../ui/components/StatusStrip";
import { Txt } from "../../ui/components/Txt";
import { activeConversation } from "../../ui/useAppLifecycle";
import { useChat } from "../../ui/useChat";
import { GUTTER, radius, space } from "../../ui/theme";

const SUGGESTIONS = {
  mock: [
    "What did I miss?",
    "What's on my schedule today?",
    "Reply to Sarah about her email",
    "Find the photo of my parking spot",
  ],
  real: [
    "What did I miss?",
    "What's on my schedule today?",
    "Who called me today?",
    "Remind me to call Mom tonight",
  ],
};

export default function Chat() {
  const { id, voice, q, focus, notice } = useLocalSearchParams<{
    id: string;
    voice?: string;
    q?: string;
    focus?: string;
    notice?: string;
  }>();
  const { rt, settings, palette: p, reduceMotion } = useApp();
  const insets = useSafeAreaInsets();
  const keyboardUp = useKeyboardVisible();
  const [created, setCreated] = useState<string | null>(null);
  const convId = id && id !== "new" ? id : created;
  const [historyOpen, setHistoryOpen] = useState(false);
  const chat = useChat(convId);
  const list = useRef<FlatList<ChatMessage>>(null);
  const lastSpoken = useRef(false);
  const pendingVoice = useRef(voice === "1");
  const pendingQ = useRef(q);
  const pendingNotice = useRef(notice);
  const [noticeAsk, setNoticeAsk] = useState<string | null>(null);

  useEffect(() => {
    if (id !== "new") return;
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
    chat.setAvatar((a) =>
      mic.listening ? "listening" : a === "listening" ? "idle" : a,
    );
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
    if (pendingNotice.current) {
      // Opened from a notification: show what it said as the first message.
      const raw = pendingNotice.current;
      pendingNotice.current = undefined;
      try {
        const n = JSON.parse(decodeURIComponent(raw)) as {
          title: string;
          body: string;
          ask?: string;
        };
        rt.engine.conversations
          .addMessage(
            convId,
            { role: "assistant", text: `**${n.title}**\n\n${n.body}` },
            new Date(),
          )
          .then(() => {
            chat.reload();
            if (n.ask) setNoticeAsk(n.ask);
          });
      } catch {
        // malformed notice: just open the chat
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId]);

  const items = chat.messages;
  const reversed = [...items].reverse();
  const empty = items.length === 0 && !chat.streaming;

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      {/* Top bar */}
      <View
        style={[
          styles.top,
          { paddingTop: insets.top + space.xs, borderBottomColor: p.line },
        ]}
      >
        <Button
          label="Back"
          icon="chevronLeft"
          iconOnly
          variant="ghost"
          compact
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/")
          }
        />
        <Brain
          size={56}
          state={chat.avatar}
          micLevel={mic.level}
          speechLevel={chat.speechLevel}
          interactive={false}
          onPress={
            mic.listening
              ? mic.stop
              : chat.avatar === "responding" && !chat.streaming
                ? () => {
                    stopSpeaking();
                    chat.setAvatar("idle");
                  }
                : mic.start
          }
        />
        <View style={{ flex: 1, gap: 2 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <Txt variant="heading" numberOfLines={1}>
              Optimus
            </Txt>
            {settings.dataMode === "mock" && (
              <Txt
                variant="mono"
                color={p.textTertiary}
                accessibilityLabel="Using demo data"
              >
                DEMO DATA
              </Txt>
            )}
          </View>
          <StatusStrip state={chat.avatar} />
        </View>
        <Button
          label="Conversation history"
          icon="history"
          iconOnly
          variant="ghost"
          compact
          onPress={() => setHistoryOpen(true)}
        />
        <Button
          label="New conversation"
          icon="plus"
          iconOnly
          variant="ghost"
          compact
          onPress={() => router.replace("/chat/new")}
        />
      </View>

      {/* Android draws edge to edge, so the window no longer resizes for the keyboard: pad instead. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {empty ? (
          <View style={styles.empty}>
            <Brain
              size={220}
              state={chat.avatar}
              micLevel={mic.level}
              speechLevel={chat.speechLevel}
              onPress={mic.start}
              onLongPress={() => router.push("/settings")}
            />
            <Txt variant="display" style={{ textAlign: "center" }}>
              Standing by.
            </Txt>
            {rt.isDemoBrain() && (
              <Txt
                variant="mono"
                color={p.textTertiary}
                style={{ textAlign: "center" }}
              >
                DEMO CORE · CONNECT THE PROXY IN SETTINGS FOR FULL CONVERSATION
              </Txt>
            )}
            <View style={{ gap: space.sm, alignSelf: "stretch" }}>
              {SUGGESTIONS[settings.dataMode].map((s) => (
                <Button
                  key={s}
                  label={s}
                  variant="secondary"
                  compact
                  onPress={() => chat.send(s)}
                />
              ))}
            </View>
          </View>
        ) : (
          // Inverted: the newest message sits at the bottom and the list stays
          // anchored there while replies stream in and when they are saved.
          <FlatList
            ref={list}
            inverted
            data={reversed}
            keyExtractor={(m) => m.id}
            renderItem={({ item, index }) => (
              <MessageView m={item} animate={index < 2 && !reduceMotion} />
            )}
            contentContainerStyle={{
              paddingHorizontal: GUTTER,
              paddingVertical: space.lg,
            }}
            ListHeaderComponent={
              <>
                {chat.streaming && (
                  <AssistantBlock
                    text={chat.streaming.text}
                    cards={chat.streaming.cards}
                    activity={chat.streaming.activity}
                    streaming
                  />
                )}
                {!chat.streaming && !chat.error && (
                  <View style={styles.chips}>
                    {noticeAsk && (
                      <Button
                        label="Do it"
                        compact
                        onPress={() => {
                          setNoticeAsk(null);
                          chat.send(noticeAsk);
                        }}
                      />
                    )}
                    {followUps(items[items.length - 1]).map((f) => (
                      <Button
                        key={f}
                        label={f}
                        variant="secondary"
                        compact
                        onPress={() => chat.send(f)}
                      />
                    ))}
                  </View>
                )}
                {chat.error && (
                  <Banner
                    title={chat.error.title}
                    body={chat.error.body}
                    tone="alert"
                    onDismiss={() => chat.setError(null)}
                    action={{
                      label: "Settings",
                      onPress: () => router.push("/settings"),
                    }}
                  />
                )}
              </>
            }
            keyboardShouldPersistTaps="handled"
          />
        )}
        {mic.error && (
          <View style={{ paddingHorizontal: space.lg }}>
            <Txt variant="small" color={p.redGlow}>
              {mic.error}
            </Txt>
          </View>
        )}
        <View>
          <Composer
            bottomInset={keyboardUp ? 0 : insets.bottom}
            autoFocus={focus === "1"}
            onSend={(t) => chat.send(t)}
            onMic={mic.start}
            onVoiceMode={() =>
              router.push(convId ? `/voice?conv=${convId}` : "/voice")
            }
            onStopMic={mic.stop}
            listening={mic.listening}
            partial={mic.partial}
            level={mic.level}
            busy={!!chat.streaming}
            onStop={chat.stop}
            speaking={!chat.streaming && chat.avatar === "responding"}
            onStopSpeaking={() => {
              stopSpeaking();
              chat.setAvatar("idle");
            }}
          />
        </View>
      </KeyboardAvoidingView>

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        current={convId}
      />
    </View>
  );
}

function HistoryDrawer({
  open,
  onClose,
  current,
}: {
  open: boolean;
  onClose: () => void;
  current: string | null;
}) {
  const { rt, palette: p, reduceMotion } = useApp();
  const insets = useSafeAreaInsets();
  const { data } = useData(() => rt.engine.conversations.list(80), [open]);
  const x = useSharedValue(-1);
  const [w, setW] = useState(320);

  useEffect(() => {
    x.value = reduceMotion
      ? open
        ? 0
        : -1
      : withTiming(open ? 0 : -1, {
          duration: 280,
          easing: Easing.out(Easing.cubic),
        });
  }, [open, x, reduceMotion]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value * (w + 20) }],
  }));

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: p.scrim }]}
        onPress={onClose}
        accessibilityLabel="Close history"
      />
      <Animated.View
        style={[
          styles.drawer,
          {
            paddingTop: insets.top + space.md,
            paddingBottom: insets.bottom,
            backgroundColor: p.surface,
            borderRightColor: p.line,
          },
          style,
        ]}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
      >
        <View style={styles.drawerHead}>
          <Icon name="history" size={20} color={p.textSecondary} />
          <Txt variant="heading" style={{ flex: 1 }} accessibilityRole="header">
            History
          </Txt>
          <Button
            label="Close"
            icon="close"
            iconOnly
            compact
            variant="ghost"
            onPress={onClose}
          />
        </View>
        <FlatList
          data={data ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingHorizontal: space.md, gap: space.xs }}
          ListEmptyComponent={
            <Txt
              variant="small"
              color={p.textSecondary}
              style={{ padding: space.md }}
            >
              No past conversations yet.
            </Txt>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                onClose();
                if (item.id !== current) router.replace(`/chat/${item.id}`);
              }}
              style={[
                styles.convRow,
                {
                  borderColor: p.line,
                  borderLeftColor: item.id === current ? p.red : p.line,
                  backgroundColor:
                    item.id === current ? p.surfaceRaised : "transparent",
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${formatDay(item.updatedAt)}`}
            >
              <Txt variant="smallStrong" numberOfLines={1}>
                {item.title}
              </Txt>
              <Txt variant="mono" color={p.textTertiary}>
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
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    marginTop: space.xs,
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space.lg,
    paddingHorizontal: space.xl,
  },
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "84%",
    maxWidth: 380,
    overflow: "hidden",
    borderRightWidth: 1,
  },
  drawerHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.lg,
    marginBottom: space.md,
  },
  convRow: {
    borderWidth: 1,
    borderLeftWidth: 2,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 56,
    justifyContent: "center",
    gap: 2,
  },
});
