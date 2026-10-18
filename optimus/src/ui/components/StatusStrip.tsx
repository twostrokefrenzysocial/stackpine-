import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { STATUS_LABEL, type BrainState } from '../../core/brain/state';
import { useApp } from '../AppContext';
import { space } from '../theme';
import { Txt } from './Txt';

/** Monospace status readout: READY / LISTENING / PROCESSING / RESPONDING. */
export function StatusStrip({ state, detail }: { state: BrainState; detail?: string }) {
  const { palette: p, reduceMotion } = useApp();
  const active = state !== 'idle';
  const o = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(o);
    if (active && !reduceMotion) o.value = withRepeat(withSequence(withTiming(0.25, { duration: 450 }), withTiming(1, { duration: 450 })), -1);
    else o.value = 1;
  }, [active, reduceMotion, o]);
  const dot = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLabel={`Status: ${STATUS_LABEL[state].toLowerCase()}`} accessibilityLiveRegion="polite">
      <Animated.View style={[styles.dot, { backgroundColor: active ? p.red : p.textTertiary }, dot]} />
      <Txt variant="mono" color={active ? p.text : p.textSecondary} numberOfLines={1}>
        STATUS: {STATUS_LABEL[state]}
      </Txt>
      {detail && (
        <Txt variant="mono" color={p.textTertiary} numberOfLines={1} style={{ flexShrink: 1 }}>
          {detail}
        </Txt>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
