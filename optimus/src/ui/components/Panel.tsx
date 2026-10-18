import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useApp } from '../AppContext';
import { EASE, motion, radius, space } from '../theme';
import { Txt } from './Txt';

export type Tone = 'default' | 'active' | 'alert' | 'inset';

export interface PanelProps {
  children?: ReactNode;
  tone?: Tone;
  /** Small uppercase label. */
  label?: string;
  /** Monospace readout on the left of the label, e.g. "01". */
  code?: string;
  right?: ReactNode;
  /** Position in a list: staggers the entrance. */
  index?: number;
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/**
 * A flat, borderless light-grey card. `active` and `alert` add a thin red
 * outline; `inset` is a hairline outline on white. Enters with a fade and a
 * 12dp rise (300ms, ease-out, no overshoot).
 */
export function Panel({ children, tone = 'default', label, code, right, index = 0, animate = true, style, contentStyle, accessibilityLabel }: PanelProps) {
  const { palette: p, reduceMotion } = useApp();
  const run = animate && !reduceMotion;
  const t = useSharedValue(run ? 0 : 1);
  useEffect(() => {
    if (run) t.value = withDelay(Math.min(index, 5) * 40, withTiming(1, { duration: motion.panel, easing: Easing.bezier(...EASE) }));
  }, [run, index, t]);
  const enter = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ translateY: (1 - t.value) * 12 }] }));

  const border = tone === 'active' || tone === 'alert' ? p.red : tone === 'inset' ? p.line : 'transparent';
  const bg = tone === 'inset' ? p.bg : p.surface;
  return (
    <Animated.View style={[styles.wrap, { backgroundColor: bg, borderColor: border }, style, enter]} accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel}>
      <View style={[styles.content, contentStyle]}>
        {(label || right || code) && (
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              {code && (
                <Txt variant="mono" color={tone === 'alert' ? p.redGlow : p.textTertiary}>
                  {code}
                </Txt>
              )}
              {label && (
                <Txt variant="label" color={tone === 'alert' ? p.redGlow : p.textSecondary} accessibilityRole="header" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {label}
                </Txt>
              )}
            </View>
            {right}
          </View>
        )}
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: radius.md },
  content: { padding: space.xl - 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md, gap: space.sm },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
});
