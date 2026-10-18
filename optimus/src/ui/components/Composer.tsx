import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { useApp } from '../AppContext';
import { feedback } from '../feedback';
import { EASE, GUTTER, TOUCH, fonts, motion, radius, space, type as T } from '../theme';
import { Button } from './Button';
import { Icon } from './Icon';
import { Txt } from './Txt';

const BARS = 32;

function Bar({ i, level, t }: { i: number; level: SharedValue<number>; t: SharedValue<number> }) {
  const { palette: p } = useApp();
  const style = useAnimatedStyle(() => {
    const wobble = Math.abs(Math.sin(t.value * Math.PI * 2 + i * 0.9)) * 0.6 + Math.abs(Math.sin(t.value * Math.PI * 4 + i * 0.37)) * 0.4;
    const center = 1 - Math.abs(i - BARS / 2) / (BARS / 2);
    return { height: 2 + (4 + 24 * center) * (0.2 + level.value) * wobble };
  });
  return <Animated.View style={[styles.bar, { backgroundColor: p.text }, style]} />;
}

/** Live mic level as thin ink bars. */
export function Waveform({ level }: { level: SharedValue<number> }) {
  const { reduceMotion } = useApp();
  const t = useSharedValue(0);
  useEffect(() => {
    if (!reduceMotion) t.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.linear }), -1);
  }, [t, reduceMotion]);
  return (
    <View style={styles.wave} accessibilityElementsHidden>
      {Array.from({ length: BARS }, (_, i) => (
        <Bar key={i} i={i} level={level} t={t} />
      ))}
    </View>
  );
}

export interface ComposerProps {
  onSend: (text: string) => void;
  onMic: () => void;
  onStopMic: () => void;
  listening: boolean;
  partial?: string;
  level: SharedValue<number>;
  busy?: boolean;
  onStop?: () => void;
  placeholder?: string;
  bottomInset?: number;
}

/**
 * Input bar pinned to the bottom: white, hairline top border, a rounded
 * grey field. The mic turns solid red while listening (a live signal) and
 * the field becomes a waveform.
 */
export function Composer({ onSend, onMic, onStopMic, listening, partial, level, busy, onStop, placeholder = 'Ask Optimus', bottomInset = 0 }: ComposerProps) {
  const { palette: p, reduceMotion } = useApp();
  const [text, setText] = useState('');
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = reduceMotion ? (listening ? 1 : 0) : withTiming(listening ? 1 : 0, { duration: motion.panel - 50, easing: Easing.bezier(...EASE) });
  }, [listening, reduceMotion, shown]);
  const waveStyle = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * 8 }] }));
  const inputStyle = useAnimatedStyle(() => ({ opacity: 1 - shown.value }));

  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    feedback.fire('send');
    onSend(t);
    setText('');
  };

  return (
    <View style={[styles.bar_, { backgroundColor: p.bg, borderTopColor: p.line, paddingBottom: bottomInset + space.sm }]}>
      <View style={styles.row}>
        <View style={[styles.field, { backgroundColor: p.surface }]}>
          <Animated.View style={inputStyle} pointerEvents={listening ? 'none' : 'auto'}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={placeholder}
              placeholderTextColor={p.textTertiary}
              selectionColor={p.text}
              cursorColor={p.text}
              onSubmitEditing={send}
              returnKeyType="send"
              multiline
              accessibilityLabel="Message to Optimus"
              style={[T.bodyLarge, styles.input, { color: p.text, fontFamily: fonts.body }]}
            />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, styles.waveWrap, waveStyle]} pointerEvents="none">
            {partial ? (
              <Txt variant="small" numberOfLines={1}>
                {partial}
              </Txt>
            ) : null}
            <Waveform level={level} />
          </Animated.View>
        </View>
        {busy && onStop ? (
          <Button label="Stop reply" icon="stop" iconOnly variant="secondary" onPress={onStop} />
        ) : text.trim() && !listening ? (
          <Button label="Send" icon="send" iconOnly onPress={send} feedbackKind="send" />
        ) : (
          <Pressable
            onPress={listening ? onStopMic : onMic}
            accessibilityRole="button"
            accessibilityLabel={listening ? 'Stop listening' : 'Speak to Optimus'}
            accessibilityState={{ selected: listening }}
            style={[styles.mic, { backgroundColor: listening ? p.red : p.surface }]}
          >
            <Icon name={listening ? 'stop' : 'mic'} size={22} color={listening ? p.onRed : p.text} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar_: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: GUTTER, paddingTop: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  field: { flex: 1, justifyContent: 'center', minHeight: TOUCH, borderRadius: TOUCH / 2, paddingHorizontal: space.lg },
  input: { maxHeight: 140, paddingVertical: space.sm },
  mic: { width: TOUCH, height: TOUCH, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  waveWrap: { justifyContent: 'center', gap: 2 },
  wave: { flexDirection: 'row', alignItems: 'center', height: 32, gap: 3 },
  bar: { width: 2, borderRadius: 1 },
});
