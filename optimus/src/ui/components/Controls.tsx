import { useEffect } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useApp } from '../AppContext';
import { feedback } from '../feedback';
import { TOUCH, fonts, motion, space, type as T } from '../theme';
import { Txt } from './Txt';

/** Mechanical slide switch. */
export function Toggle({ value, onChange, label, hint }: { value: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const { palette: p, reduceMotion } = useApp();
  const x = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    x.value = reduceMotion ? (value ? 1 : 0) : withTiming(value ? 1 : 0, { duration: motion.fast });
  }, [value, reduceMotion, x]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 22 }] }));
  return (
    <Pressable
      onPress={() => {
        feedback.fire('transform');
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
          <Txt variant="small" color={p.textDim}>
            {hint}
          </Txt>
        )}
      </View>
      <View style={[styles.track, { backgroundColor: value ? p.cyanDim : p.inset, borderColor: value ? p.cyan : p.seam }]}>
        <Animated.View style={[styles.knob, { backgroundColor: value ? p.cyan : p.rivet }, knob]} />
      </View>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const { palette: p } = useApp();
  return (
    <View style={{ gap: space.xs }}>
      <Txt variant="label" color={p.textDim}>
        {label}
      </Txt>
      <TextInput
        placeholderTextColor={p.textFaint}
        accessibilityLabel={label}
        {...props}
        style={[T.body, styles.input, { color: p.text, backgroundColor: p.inset, borderColor: p.seam, fontFamily: fonts.body }, props.style]}
      />
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const { palette: p } = useApp();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.seg, { borderColor: p.seam, backgroundColor: p.inset }]}>
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
            style={[styles.segItem, on && { backgroundColor: p.surfaceHi, borderColor: p.cyan }]}
          >
            <Txt variant="label" color={on ? p.cyanText : p.textDim}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: TOUCH, paddingVertical: space.sm },
  track: { width: 52, height: 30, borderWidth: 1, padding: 3, transform: [{ skewX: '-8deg' }] },
  knob: { width: 22, height: 22 },
  input: { minHeight: TOUCH, borderWidth: 1, paddingHorizontal: space.md },
  seg: { flexDirection: 'row', borderWidth: 1, padding: 3, gap: 3 },
  segItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
});
