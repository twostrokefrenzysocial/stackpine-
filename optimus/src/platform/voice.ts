import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";
import * as Speech from "expo-speech";
import { forSpeech } from "../core/util/speech";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useCallback, useRef, useState } from "react";
import { useSharedValue } from "react-native-reanimated";

/**
 * Voice in (speech-to-text) and out (text-to-speech).
 */

/**
 * How long you can pause mid-sentence before Optimus takes the turn. The
 * phone's recognizer wants to stop at the first short pause; instead we keep
 * it running and end the utterance ourselves after real silence.
 */
export const SILENCE_MS = 2200;

export function useVoiceInput(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const level = useSharedValue(0);
  // Finished segments so far, and the segment still being spoken.
  const finalText = useRef("");
  const interim = useRef("");
  const silence = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSilence = () => {
    if (silence.current) clearTimeout(silence.current);
    silence.current = null;
  };
  const armSilence = () => {
    clearSilence();
    silence.current = setTimeout(() => {
      silence.current = null;
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        // The 'end' event delivers whatever was heard.
      }
    }, SILENCE_MS);
  };

  useSpeechRecognitionEvent("start", () => {
    setListening(true);
    setError(null);
  });
  useSpeechRecognitionEvent("end", () => {
    clearSilence();
    setListening(false);
    level.set(0);
    const text = [finalText.current, interim.current]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    finalText.current = "";
    interim.current = "";
    setPartial("");
    if (text) onFinal(text);
  });
  useSpeechRecognitionEvent("result", (e) => {
    const t = (e.results[0]?.transcript ?? "").trim();
    if (e.isFinal) {
      // Continuous mode hands back one segment at a time: keep them all.
      if (t)
        finalText.current = [finalText.current, t].filter(Boolean).join(" ");
      interim.current = "";
    } else interim.current = t;
    setPartial([finalText.current, interim.current].filter(Boolean).join(" "));
    // Only count silence once something has been said.
    if (finalText.current || interim.current) armSilence();
  });
  useSpeechRecognitionEvent("volumechange", (e) => {
    level.set(Math.max(0, Math.min(1, (e.value + 2) / 12)));
  });
  useSpeechRecognitionEvent("error", (e) => {
    clearSilence();
    setListening(false);
    level.set(0);
    // Stopping a continuous session can surface a timeout/client error even
    // though words were heard: deliver them instead of complaining.
    const text = [finalText.current, interim.current]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    finalText.current = "";
    interim.current = "";
    setPartial("");
    if (text) {
      onFinal(text);
      return;
    }
    if (
      e.error === "aborted" ||
      e.error === "no-speech" ||
      e.error === "speech-timeout" ||
      e.error === "client"
    )
      return;
    setError(
      e.error === "not-allowed"
        ? "Microphone permission is off."
        : e.error === "network"
          ? "Voice input needs a connection."
          : "I didn’t catch that.",
    );
  });

  const start = useCallback(async () => {
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        setError(
          "Microphone permission is off. Enable it in Settings › Data sources.",
        );
        return;
      }
      Speech.stop();
      finalText.current = "";
      interim.current = "";
      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        // Keep listening through pauses; we end the turn after SILENCE_MS of quiet.
        continuous: true,
        androidIntentOptions: {
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: SILENCE_MS,
          EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS:
            SILENCE_MS,
          EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 8000,
        },
        volumeChangeEventOptions: { enabled: true, intervalMillis: 80 },
      });
    } catch {
      setError("Voice input isn’t available on this device.");
    }
  }, []);

  const stop = useCallback(() => {
    clearSilence();
    setError(null);
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      setListening(false);
    }
  }, []);

  return { listening, partial, error, level, start, stop };
}

export type VoiceAccent = "british" | "american";

/** OpenAI voice and delivery notes per accent. */
export const NATURAL_VOICE: Record<
  VoiceAccent,
  { voice: string; instructions: string }
> = {
  british: {
    voice: "fable",
    instructions:
      "A British English (received pronunciation) male voice. Calm, warm, confident and unhurried, like a trusted personal assistant. Natural conversational pacing.",
  },
  american: {
    voice: "onyx",
    instructions:
      "Calm, warm, confident and unhurried, like a trusted personal assistant. Natural conversational pacing.",
  },
};

const chosenVoices: Partial<Record<VoiceAccent, string | null>> = {};

/** Prefer a lower, steady male voice in the chosen accent when the device has one. */
async function pickVoice(
  accent: VoiceAccent = "british",
): Promise<string | null> {
  const cached = chosenVoices[accent];
  if (cached !== undefined) return cached;
  let chosenVoice: string | null = null;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const en = voices.filter((v) => v.language?.toLowerCase().startsWith("en"));
    const prefs =
      accent === "british"
        ? [
            /en-gb-x-rjs/i,
            /en-gb-x-gbb/i,
            /en-gb.*male/i,
            /en-gb/i,
            /en-us-x-iom/i,
            /male/i,
          ]
        : [
            /en-us-x-iom/i,
            /en-us-x-iol/i,
            /en-gb-x-rjs/i,
            /en-us-x-tpd/i,
            /male/i,
          ];
    for (const re of prefs) {
      const v = en.find((x) => re.test(x.identifier) || re.test(x.name));
      if (v) {
        chosenVoice = v.identifier;
        break;
      }
    }
  } catch {
    chosenVoice = null;
  }
  chosenVoices[accent] = chosenVoice;
  return chosenVoice;
}

/** Speaks a reply. Strips list markers so it sounds natural. */
export async function speak(
  text: string,
  opts: {
    rate: number;
    pitch: number;
    accent?: VoiceAccent;
    onStart?: () => void;
    onDone?: () => void;
  },
) {
  const clean = text
    .replace(/[•*_#>`]/g, "")
    .replace(/\n+/g, ". ")
    .slice(0, 1200);
  const voice = await pickVoice(opts.accent);
  Speech.stop();
  Speech.speak(clean, {
    language: "en-US",
    voice: voice ?? undefined,
    rate: opts.rate,
    pitch: opts.pitch,
    onStart: opts.onStart,
    onDone: opts.onDone,
    onStopped: opts.onDone,
    onError: opts.onDone,
  });
}

let player: AudioPlayer | null = null;
let speechToken = 0;

/**
 * Speaks with OpenAI's natural voice through the proxy, falling back to the
 * phone's own voice when that isn't available (Anthropic only, offline, or
 * an error). `onLevel` gets a rough loudness for the brain while speaking.
 */
export async function speakNatural(
  text: string,
  opts: {
    proxyUrl?: string;
    token?: string | null;
    accent?: VoiceAccent;
    rate: number;
    pitch: number;
    onStart?: () => void;
    onDone?: () => void;
    onLevel?: (v: number) => void;
  },
): Promise<void> {
  const my = ++speechToken;
  stopSpeaking();
  const clean = forSpeech(text);
  if (!clean) return opts.onDone?.();
  let pulse: ReturnType<typeof setInterval> | null = null;
  const done = () => {
    if (pulse) clearInterval(pulse);
    opts.onLevel?.(0);
    if (my === speechToken) opts.onDone?.();
  };
  const startPulse = () => {
    opts.onStart?.();
    pulse = setInterval(() => opts.onLevel?.(0.3 + Math.random() * 0.7), 110);
  };
  if (opts.proxyUrl && opts.token) {
    try {
      const res = await fetch(
        `${opts.proxyUrl.replace(/\/+$/, "")}/openai/v1/audio/speech`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-optimus-token": opts.token,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini-tts",
            ...NATURAL_VOICE[opts.accent ?? "british"],
            input: clean,
            response_format: "mp3",
          }),
        },
      );
      if (!res.ok) throw new Error(`tts ${res.status}`);
      const bytes = await res.arrayBuffer();
      if (my !== speechToken) return;
      const file = new File(Paths.cache, `optimus-reply-${my}.mp3`);
      if (file.exists) file.delete();
      file.create();
      await file.write(bytes);
      player = createAudioPlayer(file.uri);
      const sub = player.addListener("playbackStatusUpdate", (st) => {
        if (st.didJustFinish) {
          sub.remove();
          player?.remove();
          player = null;
          try {
            file.delete();
          } catch {
            // cache file; fine to leave
          }
          done();
        }
      });
      startPulse();
      player.play();
      return;
    } catch {
      // Fall through to the phone's voice.
    }
  }
  if (my !== speechToken) return;
  await speak(clean, {
    rate: opts.rate,
    pitch: opts.pitch,
    accent: opts.accent,
    onStart: startPulse,
    onDone: done,
  });
}

export function stopSpeaking() {
  Speech.stop();
  if (player) {
    try {
      player.pause();
      player.remove();
    } catch {
      // already gone
    }
    player = null;
  }
}
