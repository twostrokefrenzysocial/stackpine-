import { useEffect } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useApp } from '../AppContext';
import { feedback } from '../feedback';
import { EASE, TOUCH, fonts, motion, radius, space, type as T } from '../theme';
import { Txt } from './Txt';

/** Switch: hairline track, white knob; red track when on. */
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
      <View style={[styles.track, { backgroundColor: value ? p.red : 'transparent', borderColor: value ? p.red : p.line }]}>
        <Animated.View style={[styles.knob, { backgroundColor: value ? p.onRed : p.textSecondary }, knob]} />
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
        selectionColor={p.red}
        cursorColor={p.red}
        accessibilityLabel={label}
        {...props}
        style={[T.body, styles.input, { color: p.text, backgroundColor: p.surface, borderColor: p.line, fontFamily: fonts.body }, props.style]}
      />
    </View>
  );
}

/** Segmented control: the selected item gets a 2px red underline. */
export function Segmented<V extends string>({ value, options, onChange, label }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void; label: string }) {
  const { palette: p } = useApp();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.seg, { borderColor: p.line }]}>
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
            style={[styles.segItem, { borderBottomColor: on ? p.red : 'transparent', backgroundColor: on ? p.surfaceRaised : 'transparent' }]}
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
  track: { width: 46, height: 26, borderWidth: 1, borderRadius: 13, padding: 3 },
  knob: { width: 18, height: 18, borderRadius: 9 },
  input: { minHeight: TOUCH, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.md },
  seg: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.sm, overflow: 'hidden' },
  segItem: { flex: 1, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2 },
});
