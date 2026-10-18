import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useRef, useState } from 'react';
import { useSharedValue } from 'react-native-reanimated';

/**
 * Voice in (speech-to-text) and out (text-to-speech).
 */

export function useVoiceInput(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const level = useSharedValue(0);
  const finalText = useRef('');

  useSpeechRecognitionEvent('start', () => {
    setListening(true);
    setError(null);
  });
  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    level.set(0);
    const text = finalText.current.trim();
    finalText.current = '';
    setPartial('');
    if (text) onFinal(text);
  });
  useSpeechRecognitionEvent('result', (e) => {
    const t = e.results[0]?.transcript ?? '';
    if (e.isFinal) finalText.current = t;
    setPartial(t);
  });
  useSpeechRecognitionEvent('volumechange', (e) => {
    level.set(Math.max(0, Math.min(1, (e.value + 2) / 12)));
  });
  useSpeechRecognitionEvent('error', (e) => {
    setListening(false);
    level.set(0);
    if (e.error !== 'aborted' && e.error !== 'no-speech') setError(e.error === 'not-allowed' ? 'Microphone permission is off.' : 'I didn’t catch that.');
  });

  const start = useCallback(async () => {
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        setError('Microphone permission is off. Enable it in Settings › Data sources.');
        return;
      }
      Speech.stop();
      ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: true, continuous: false, volumeChangeEventOptions: { enabled: true, intervalMillis: 80 } });
    } catch {
      setError('Voice input isn’t available on this device.');
    }
  }, []);

  const stop = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      setListening(false);
    }
  }, []);

  return { listening, partial, error, level, start, stop };
}

let chosenVoice: string | null | undefined;

/** Prefer a lower, steady English voice when the device has one. */
async function pickVoice(): Promise<string | null> {
  if (chosenVoice !== undefined) return chosenVoice;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const en = voices.filter((v) => v.language?.toLowerCase().startsWith('en'));
    const prefs = [/en-us-x-iom/i, /en-us-x-iol/i, /en-gb-x-rjs/i, /en-us-x-tpd/i, /male/i];
    for (const re of prefs) {
      const v = en.find((x) => re.test(x.identifier) || re.test(x.name));
      if (v) return (chosenVoice = v.identifier);
    }
    chosenVoice = null;
  } catch {
    chosenVoice = null;
  }
  return chosenVoice;
}

/** Speaks a reply. Strips list markers so it sounds natural. */
export async function speak(text: string, opts: { rate: number; pitch: number; onStart?: () => void; onDone?: () => void }) {
  const clean = text.replace(/[•*_#>`]/g, '').replace(/\n+/g, '. ').slice(0, 1200);
  const voice = await pickVoice();
  Speech.stop();
  Speech.speak(clean, {
    language: 'en-US',
    voice: voice ?? undefined,
    rate: opts.rate,
    pitch: opts.pitch,
    onStart: opts.onStart,
    onDone: opts.onDone,
    onStopped: opts.onDone,
    onError: opts.onDone,
  });
}

export function stopSpeaking() {
  Speech.stop();
}
