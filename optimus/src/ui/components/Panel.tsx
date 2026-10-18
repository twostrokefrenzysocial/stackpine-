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
  /** Thin HUD corner brackets. Use on at most one or two panels per screen. */
  hud?: boolean;
  /** Position in a list: staggers the entrance. */
  index?: number;
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/** HUD corner brackets drawn as hairlines. */
export function HudCorners({ color, size = 12 }: { color: string; size?: number }) {
  const s = { position: 'absolute' as const, width: size, height: size, borderColor: color };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[s, { top: -1, left: -1, borderTopWidth: 1, borderLeftWidth: 1 }]} />
      <View style={[s, { top: -1, right: -1, borderTopWidth: 1, borderRightWidth: 1 }]} />
      <View style={[s, { bottom: -1, left: -1, borderBottomWidth: 1, borderLeftWidth: 1 }]} />
      <View style={[s, { bottom: -1, right: -1, borderBottomWidth: 1, borderRightWidth: 1 }]} />
    </View>
  );
}

/**
 * A flat surface block with a hairline outline. Enters with a fade and a
 * 12dp rise (300ms, ease-out, no overshoot).
 */
export function Panel({ children, tone = 'default', label, code, right, hud, index = 0, animate = true, style, contentStyle, accessibilityLabel }: PanelProps) {
  const { palette: p, reduceMotion } = useApp();
  const run = animate && !reduceMotion;
  const t = useSharedValue(run ? 0 : 1);
  useEffect(() => {
    if (run) t.value = withDelay(Math.min(index, 5) * 40, withTiming(1, { duration: motion.panel, easing: Easing.bezier(...EASE) }));
  }, [run, index, t]);
  const enter = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ translateY: (1 - t.value) * 12 }] }));

  const border = tone === 'active' || tone === 'alert' ? p.red : p.line;
  const bg = tone === 'inset' ? p.bg : p.surface;
  return (
    <Animated.View style={[styles.wrap, { backgroundColor: bg, borderColor: border }, style, enter]} accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel}>
      {hud && <HudCorners color={p.textSecondary} />}
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
  wrap: { borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: radius.md },
  content: { padding: space.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md, gap: space.sm },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
});
