import { useEffect } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useApp } from '../AppContext';
import { feedback } from '../feedback';
import { EASE, TOUCH, fonts, motion, radius, space, type as T } from '../theme';
import { Txt } from './Txt';

/** Switch: grey track, white knob; ink track when on. */
export function Toggle({ value, onChange, label, hint }: { value: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const { palette: p, reduceMotion } = useApp();
  const x = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    x.value = reduceMotion ? (value ? 1 : 0) : withTiming(value ? 1 : 0, { duration: motion.tap, easing: Easing.bezier(...EASE) });
  }, [value, reduceMotion, x]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 20 }] }));
  return (
    <Pressable
      onPress={() => {
        feedback.fire('tap');
        onChange(!value);
      }}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value }}
      style={styles.row}
    >
      <View style={{ flex: 1, paddingRight: space.md }}>
        <Txt variant="bodyStrong">{label}</Txt>
        {hint && (
          <Txt variant="small" color={p.textSecondary}>
            {hint}
          </Txt>
        )}
      </View>
      <View style={[styles.track, { backgroundColor: value ? p.ink : p.surfaceRaised }]}>
        <Animated.View style={[styles.knob, { backgroundColor: p.bg }, knob]} />
      </View>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const { palette: p } = useApp();
  return (
    <View style={{ gap: space.xs }}>
      <Txt variant="label" color={p.textSecondary}>
        {label}
      </Txt>
      <TextInput
        placeholderTextColor={p.textTertiary}
        selectionColor={p.text}
        cursorColor={p.text}
        accessibilityLabel={label}
        {...props}
        style={[T.body, styles.input, { color: p.text, backgroundColor: p.bg, borderColor: p.line, fontFamily: fonts.body }, props.style]}
      />
    </View>
  );
}

/** Segmented control: grey track, the selected item is a white pill. */
export function Segmented<V extends string>({ value, options, onChange, label }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void; label: string }) {
  const { palette: p } = useApp();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.seg, { backgroundColor: p.surfaceRaised }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              feedback.fire('tap');
              onChange(o.value);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            style={[styles.segItem, on && styles.segOn, { backgroundColor: on ? p.bg : 'transparent' }]}
          >
            <Txt variant="label" color={on ? p.text : p.textSecondary}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: TOUCH + 8, paddingVertical: space.sm },
  track: { width: 46, height: 26, borderRadius: 13, padding: 3 },
  knob: { width: 20, height: 20, borderRadius: 10 },
  input: { minHeight: TOUCH, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.lg },
  seg: { flexDirection: 'row', borderRadius: radius.sm + 2, padding: 3 },
  segItem: { flex: 1, minHeight: TOUCH - 6, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segOn: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
});
