import { Image } from 'expo-image';
import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { EASE, fonts, palette } from '../theme';

const ease = Easing.bezier(...EASE);

/** Launch: the brain mark and wordmark fade up, then the splash lifts away. */
export function BootSplash({ onDone, standalone, error }: { onDone: () => void; standalone?: boolean; error?: string | null }) {
  const enter = useSharedValue(0);
  const exit = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      enter.value = withTiming(1, { duration: reduce ? 0 : 340, easing: ease });
      if (!standalone) exit.value = withDelay(reduce ? 150 : 650, withTiming(1, { duration: reduce ? 100 : 260, easing: ease }, () => scheduleOnRN(onDone)));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mark = useAnimatedStyle(() => ({ opacity: enter.value, transform: [{ translateY: (1 - enter.value) * 12 }] }));
  const root = useAnimatedStyle(() => ({ opacity: 1 - exit.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, root]} pointerEvents={standalone ? 'auto' : 'none'} accessibilityLabel="Optimus is starting">
      <Animated.View style={[styles.center, mark]}>
        <Image source={require('../../../assets/brand/splash-emblem.png')} style={styles.mark} contentFit="contain" />
        <Text style={styles.word}>OPTIMUS</Text>
        <Text style={styles.status}>STATUS: {error ? 'FAULT' : 'INITIALIZING'}</Text>
      </Animated.View>
      {error && <Text style={styles.err}>I couldn’t open secure storage. Restart the app; if it keeps happening, reinstall.</Text>}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  center: { alignItems: 'center' },
  mark: { width: 180, height: 180 },
  word: { marginTop: 16, color: palette.text, fontFamily: fonts.displayLight, fontSize: 18, letterSpacing: 9 },
  status: { marginTop: 8, color: palette.textTertiary, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.6 },
  err: { marginTop: 24, color: palette.redGlow, fontFamily: fonts.body, fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },
});
