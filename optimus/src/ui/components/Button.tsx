import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { useApp } from '../AppContext';
import { feedback, type FeedbackKind } from '../feedback';
import { TOUCH, chamfer, motion, space } from '../theme';
import { Icon, type IconName } from './Icon';
import { chamferPath } from './Panel';
import { Txt } from './Txt';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'amber' | 'danger';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  compact?: boolean;
  feedbackKind?: FeedbackKind;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  /** Hide the text label (icon-only); the label is still read by screen readers. */
  iconOnly?: boolean;
}

/** Chamfered command button with a short press "depress" and haptic tap. */
export function Button({ label, onPress, variant = 'primary', icon, disabled, compact, feedbackKind = 'tap', accessibilityHint, style, iconOnly }: ButtonProps) {
  const { palette: p, reduceMotion } = useApp();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const pressed = useSharedValue(0);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: 1 - pressed.value * 0.03 }, { translateY: pressed.value * 1 }] }));

  const fill =
    variant === 'primary' ? p.cyan : variant === 'amber' ? p.amber : variant === 'danger' ? p.danger : variant === 'secondary' ? p.surfaceHi : 'transparent';
  const edge = variant === 'secondary' ? p.seamHi : variant === 'ghost' ? p.seam : fill;
  const fg = variant === 'primary' || variant === 'amber' || variant === 'danger' ? p.onAccent : variant === 'ghost' ? p.cyanText : p.text;
  const h = compact ? 44 : TOUCH;
  const c = compact ? chamfer.sm : chamfer.sm + 2;

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <Pressable
      onPress={() => {
        feedback.fire(feedbackKind);
        onPress();
      }}
      onPressIn={() => {
        if (!reduceMotion) pressed.value = withTiming(1, { duration: motion.fast / 2 });
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, { duration: motion.fast });
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={compact ? 4 : 0}
      style={[{ minHeight: h, minWidth: iconOnly ? h : undefined, opacity: disabled ? 0.45 : 1 }, style]}
    >
      <Animated.View style={[styles.inner, { minHeight: h, paddingHorizontal: iconOnly ? 0 : compact ? space.md : space.lg }, anim]} onLayout={onLayout}>
        {size.w > 0 && (
          <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id={`b${variant}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={fill} stopOpacity={variant === 'ghost' ? 0 : 1} />
                <Stop offset="1" stopColor={fill} stopOpacity={variant === 'ghost' ? 0 : variant === 'secondary' ? 1 : 0.86} />
              </LinearGradient>
            </Defs>
            <Path d={chamferPath(size.w, size.h, c)} fill={`url(#b${variant})`} stroke={edge} strokeWidth={1} />
          </Svg>
        )}
        <View style={styles.row}>
          {icon && <Icon name={icon} size={compact ? 18 : 20} color={fg} />}
          {!iconOnly && (
            <Txt variant="heading" color={fg} style={{ fontSize: compact ? 14 : 15, letterSpacing: 1.2 }} numberOfLines={1}>
              {label.toUpperCase()}
            </Txt>
          )}
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  inner: { justifyContent: 'center', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
