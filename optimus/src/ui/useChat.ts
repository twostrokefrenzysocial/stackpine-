import { useCallback, useEffect, useRef, useState } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import type { TurnEvent } from '../core/llm/agent';
import { friendlyError } from '../core/llm/transport';
import type { ChatCard, ChatMessage } from '../core/types';
import { speak, stopSpeaking } from '../platform/voice';
import { useApp } from './AppContext';
import type { AvatarState } from './components/Avatar';
import { feedback } from './feedback';

export interface StreamingTurn {
  text: string;
  cards: ChatCard[];
  activity?: string;
}

export function useChat(conversationId: string | null) {
  const { rt, settings, bump } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<StreamingTurn | null>(null);
  const [avatar, setAvatar] = useState<AvatarState>('idle');
  const [error, setError] = useState<{ title: string; body: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const speechLevel = useSharedValue(0);

  const reload = useCallback(async () => {
    if (!conversationId) return setMessages([]);
    setMessages(await rt.engine.conversations.messages(conversationId));
  }, [conversationId, rt]);

  useEffect(() => {
    let alive = true;
    (conversationId ? rt.engine.conversations.messages(conversationId) : Promise.resolve([])).then((m) => alive && setMessages(m));
    return () => {
      alive = false;
    };
  }, [conversationId, rt]);

  const send = useCallback(
    async (text: string, opts: { spoken?: boolean } = {}) => {
      if (!conversationId || streaming) return;
      setError(null);
      stopSpeaking();
      const optimistic: ChatMessage = { id: `local-${Date.now()}`, conversationId, role: 'user', text, cards: [], createdAt: new Date().toISOString() };
      setMessages((m) => [...m, optimistic]);
      setStreaming({ text: '', cards: [] });
      setAvatar('thinking');
      const controller = new AbortController();
      abortRef.current = controller;

      let firstText = true;
      const onEvent = (e: TurnEvent) => {
        if (e.type === 'text') {
          if (firstText) {
            firstText = false;
            setAvatar('speaking');
          }
          setStreaming((s) => (s ? { ...s, text: s.text + e.delta } : s));
        } else if (e.type === 'tool-start') {
          setAvatar('thinking');
          firstText = true;
          setStreaming((s) => (s ? { ...s, activity: e.label } : s));
        } else if (e.type === 'tool-done') {
          setStreaming((s) => (s ? { ...s, activity: undefined } : s));
        } else if (e.type === 'cards') {
          setStreaming((s) => (s ? { ...s, cards: e.cards } : s));
        }
      };

      try {
        const { assistant } = await rt.engine.send(conversationId, text, onEvent, controller.signal);
        await reload();
        bump();
        if (opts.spoken && settings.voiceReplies && assistant.text) {
          setAvatar('speaking');
          let t: ReturnType<typeof setInterval> | null = null;
          speak(assistant.text, {
            rate: settings.voiceRate,
            pitch: settings.voicePitch,
            onStart: () => {
              t = setInterval(() => speechLevel.set(0.3 + Math.random() * 0.7), 120);
            },
            onDone: () => {
              if (t) clearInterval(t);
              speechLevel.set(0);
              setAvatar('idle');
            },
          });
        } else {
          setAvatar('idle');
        }
      } catch (e) {
        const f = friendlyError(e);
        if (f.kind !== 'aborted') {
          setError(f);
          feedback.fire('error');
        }
        await reload();
        setAvatar('idle');
      } finally {
        setStreaming(null);
        abortRef.current = null;
      }
    },
    [conversationId, streaming, rt, reload, bump, settings.voiceReplies, settings.voiceRate, settings.voicePitch, speechLevel],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    stopSpeaking();
  }, []);

  return { messages, streaming, avatar, setAvatar, error, setError, send, stop, speechLevel, reload };
}
