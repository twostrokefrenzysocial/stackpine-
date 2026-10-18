import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Short mechanical feedback: haptic taps on confirm/send/transform, and
 * (off by default) subtle servo/click sounds on transformations.
 */
export type FeedbackKind = 'tap' | 'send' | 'confirm' | 'transform' | 'error';

const SOUND_FILES = {
  click: require('../../assets/sounds/click.wav'),
  lock: require('../../assets/sounds/lock.wav'),
  servo: require('../../assets/sounds/servo.wav'),
  send: require('../../assets/sounds/send.wav'),
} as const;

const SOUND_FOR: Record<FeedbackKind, keyof typeof SOUND_FILES | null> = {
  tap: 'click',
  send: 'send',
  confirm: 'lock',
  transform: 'servo',
  error: null,
};

const players = new Map<string, AudioPlayer>();

function play(name: keyof typeof SOUND_FILES) {
  try {
    let p = players.get(name);
    if (!p) {
      p = createAudioPlayer(SOUND_FILES[name]);
      p.volume = 0.35;
      players.set(name, p);
    }
    p.seekTo(0);
    p.play();
  } catch {
    // Sound is decorative; never fail an interaction because of it.
  }
}

export const feedback = {
  hapticsEnabled: true,
  soundEnabled: false,
  fire(kind: FeedbackKind) {
    if (this.hapticsEnabled && Platform.OS !== 'web') {
      const h =
        kind === 'confirm'
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          : kind === 'error'
            ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
            : kind === 'tap'
              ? Haptics.selectionAsync()
              : Haptics.impactAsync(kind === 'send' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Rigid);
      h.catch(() => undefined);
    }
    const s = SOUND_FOR[kind];
    if (this.soundEnabled && s) play(s);
  },
};
