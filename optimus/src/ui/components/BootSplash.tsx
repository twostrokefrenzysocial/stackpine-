import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { dark, fonts } from '../theme';
import { Emblem } from './Emblem';

/**
 * Launch transform-in: the two shield halves slide together, the visor
 * ignites, then the splash lifts away (total < 400ms per step).
 */
export function BootSplash({ onDone, standalone, error }: { onDone: () => void; standalone?: boolean; error?: string | null }) {
  const assemble = useSharedValue(0);
  const visor = useSharedValue(0);
  const exit = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) {
        assemble.value = 1;
        visor.value = 1;
        if (!standalone) exit.value = withDelay(200, withTiming(1, { duration: 150 }, () => scheduleOnRN(onDone)));
        return;
      }
      assemble.value = withTiming(1, { duration: 340, easing: Easing.out(Easing.back(1.4)) });
      visor.value = withDelay(300, withTiming(1, { duration: 200 }));
      if (!standalone) exit.value = withDelay(700, withTiming(1, { duration: 260, easing: Easing.in(Easing.cubic) }, () => scheduleOnRN(onDone)));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const left = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - assemble.value) * -40 }], opacity: assemble.value }));
  const right = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - assemble.value) * 40 }], opacity: assemble.value }));
  const visorStyle = useAnimatedStyle(() => ({ opacity: visor.value, transform: [{ scaleX: 0.4 + visor.value * 0.6 }] }));
  const root = useAnimatedStyle(() => ({ opacity: 1 - exit.value, transform: [{ scale: 1 + exit.value * 0.06 }] }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, root]} pointerEvents={standalone ? 'auto' : 'none'} accessibilityLabel="Optimus is starting">
      <View style={styles.mark}>
        <Animated.View style={[StyleSheet.absoluteFill, left]}>
          <Emblem size={132} part="left" />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, right]}>
          <Emblem size={132} part="right" />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, visorStyle]}>
          <Emblem size={132} part="visor" />
        </Animated.View>
      </View>
      <Text style={styles.word}>OPTIMUS</Text>
      {error && <Text style={styles.err}>I couldn’t open secure storage. Restart the app; if it keeps happening, reinstall.</Text>}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: dark.ground, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  mark: { width: 132, height: 132 },
  word: { marginTop: 20, color: dark.textDim, fontFamily: fonts.display, fontSize: 16, letterSpacing: 8 },
  err: { marginTop: 24, color: dark.amberText, fontFamily: fonts.body, fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },
});
