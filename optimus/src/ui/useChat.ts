import { useCallback, useEffect, useRef, useState } from 'react';
import { useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import type { BrainState } from '../core/brain/state';
import type { TurnEvent } from '../core/llm/agent';
import { friendlyError } from '../core/llm/transport';
import type { ChatCard, ChatMessage } from '../core/types';
import { proxyToken } from '../platform/secrets';
import { speakNatural, stopSpeaking } from '../platform/voice';
import { useApp } from './AppContext';
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
  const [avatar, setAvatar] = useState<BrainState>('idle');
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
    async (text: string, opts: { spoken?: boolean; voice?: boolean; onSpoken?: () => void } = {}): Promise<ChatMessage | null> => {
      if (!conversationId || streaming) return null;
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
            setAvatar('responding');
            feedback.fire('tap');
          }
          // No TTS amplitude while streaming: pulse once per chunk.
          speechLevel.set(withSequence(withTiming(0.6 + Math.random() * 0.4, { duration: 60 }), withTiming(0, { duration: 320 })));
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
        const { assistant } = await rt.engine.send(conversationId, text, onEvent, controller.signal, { voice: opts.voice });
        // Swap the streaming block for the saved message in one render, so it never shows twice.
        const fresh = await rt.engine.conversations.messages(conversationId);
        setMessages(fresh);
        setStreaming(null);
        bump();
        if ((opts.spoken || opts.voice) && settings.voiceReplies && assistant.text) {
          setAvatar('responding');
          const token = settings.provider === 'openai' ? await proxyToken.get().catch(() => null) : null;
          await speakNatural(assistant.text, {
            proxyUrl: settings.provider === 'openai' ? settings.proxyUrl : undefined,
            token,
            rate: settings.voiceRate,
            pitch: settings.voicePitch,
            onLevel: (v) => speechLevel.set(v),
            onDone: () => {
              speechLevel.set(0);
              setAvatar('idle');
              opts.onSpoken?.();
            },
          });
        } else {
          setAvatar('idle');
          opts.onSpoken?.();
        }
        return assistant;
      } catch (e) {
        const f = friendlyError(e);
        if (f.kind !== 'aborted') {
          setError(f);
          feedback.fire('error');
        }
        await reload();
        setAvatar('idle');
        opts.onSpoken?.();
        return null;
      } finally {
        setStreaming(null);
        abortRef.current = null;
      }
    },
    [conversationId, streaming, rt, reload, bump, settings.voiceReplies, settings.voiceRate, settings.voicePitch, settings.provider, settings.proxyUrl, speechLevel],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    stopSpeaking();
  }, []);

  return { messages, streaming, avatar, setAvatar, error, setError, send, stop, speechLevel, reload };
}
