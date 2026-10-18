import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { useApp } from '../AppContext';
import { feedback } from '../feedback';
import { TOUCH, fonts, motion, space, type as T } from '../theme';
import { Button } from './Button';
import { Icon } from './Icon';
import { PanelSurface } from './Panel';
import { Txt } from './Txt';

const BARS = 28;

function Bar({ i, level, t }: { i: number; level: SharedValue<number>; t: SharedValue<number> }) {
  const { palette: p } = useApp();
  const style = useAnimatedStyle(() => {
    const wobble = Math.abs(Math.sin(t.value * Math.PI * 2 + i * 0.9)) * 0.6 + Math.abs(Math.sin(t.value * Math.PI * 4 + i * 0.37)) * 0.4;
    const center = 1 - Math.abs(i - BARS / 2) / (BARS / 2);
    const h = 4 + (6 + 30 * center) * (0.25 + level.value * 0.95) * wobble;
    return { height: h };
  });
  return <Animated.View style={[styles.bar, { backgroundColor: i % 7 === 0 ? p.cyanText : p.cyan }, style]} />;
}

/** The waveform the mic unfolds into while listening. */
export function Waveform({ level }: { level: SharedValue<number> }) {
  const { reduceMotion } = useApp();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    t.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.linear }), -1);
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
  autoFocus?: boolean;
}

/**
 * "Ask Optimus" input. The mic unfolds into a live waveform while listening
 * (the plate slides open from the mic's edge, < 400ms).
 */
export function Composer({ onSend, onMic, onStopMic, listening, partial, level, busy, onStop, placeholder = 'Ask Optimus', autoFocus }: ComposerProps) {
  const { palette: p, reduceMotion } = useApp();
  const [text, setText] = useState('');
  const [w, setW] = useState(0);
  const unfold = useSharedValue(0);

  useEffect(() => {
    feedback.fire('transform');
    unfold.value = reduceMotion ? (listening ? 1 : 0) : withTiming(listening ? 1 : 0, { duration: motion.slow - 60, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  const waveStyle = useAnimatedStyle(() => {
    const sx = 0.12 + unfold.value * 0.88;
    return { opacity: unfold.value < 0.02 ? 0 : 1, transform: [{ translateX: ((1 - sx) * w) / 2 }, { scaleX: sx }] };
  });
  const inputStyle = useAnimatedStyle(() => ({ opacity: 1 - unfold.value }));

  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    feedback.fire('send');
    onSend(t);
    setText('');
  };

  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  return (
    <View style={styles.root} onLayout={onLayout}>
      <PanelSurface width={w} height={TOUCH + 12} tone={listening ? 'cyan' : 'inset'} glow={listening} />
      <Animated.View style={[styles.row, inputStyle]} pointerEvents={listening ? 'none' : 'auto'}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={p.textFaint}
          onSubmitEditing={send}
          returnKeyType="send"
          autoFocus={autoFocus}
          multiline
          accessibilityLabel="Message to Optimus"
          style={[T.body, styles.input, { color: p.text, fontFamily: fonts.body }]}
        />
        {busy && onStop ? (
          <Button label="Stop reply" icon="stop" iconOnly variant="secondary" compact onPress={onStop} />
        ) : text.trim() ? (
          <Button label="Send" icon="send" iconOnly compact onPress={send} feedbackKind="send" />
        ) : (
          <Pressable onPress={onMic} accessibilityRole="button" accessibilityLabel="Speak to Optimus" accessibilityHint="Starts voice input" style={[styles.mic, { borderColor: p.cyan, backgroundColor: p.cyanDim }]}>
            <Icon name="mic" size={22} color={p.mode === 'dark' ? p.cyanText : p.cyan} />
          </Pressable>
        )}
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.waveWrap, waveStyle]} pointerEvents={listening ? 'auto' : 'none'}>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          {partial ? (
            <Txt variant="small" numberOfLines={1} color={p.text} style={{ marginBottom: 2 }}>
              {partial}
            </Txt>
          ) : (
            <Txt variant="label" color={p.cyanText}>
              Listening
            </Txt>
          )}
          <Waveform level={level} />
        </View>
        <Button label="Stop listening" icon="stop" iconOnly compact variant="secondary" onPress={onStopMic} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { minHeight: TOUCH + 12, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, paddingRight: space.xs + 2, gap: space.sm, minHeight: TOUCH + 12 },
  input: { flex: 1, maxHeight: 140, paddingVertical: space.sm },
  mic: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  waveWrap: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, paddingRight: space.xs + 2, gap: space.sm },
  wave: { flexDirection: 'row', alignItems: 'center', height: 40, gap: 3 },
  bar: { width: 3, borderRadius: 0 },
});
