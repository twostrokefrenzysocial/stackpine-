import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';
import { useApp } from '../AppContext';

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking';

/**
 * Optimus: an original geometric robot head (designed for this app).
 * Layers animate independently:
 *  - idle: slow visor pulse
 *  - listening: visor brightens, cheek plates part
 *  - thinking: forehead panels rotate and shift, a scan line sweeps the visor
 *  - speaking: visor pulses with `level` (0..1)
 */
export function Avatar({ size = 120, state = 'idle', level, label = 'Optimus' }: { size?: number; state?: AvatarState; level?: SharedValue<number>; label?: string }) {
  const { palette: p, reduceMotion } = useApp();
  const s = size / 200;

  const pulse = useSharedValue(0.7);
  const part = useSharedValue(0);
  const spin = useSharedValue(0);
  const scan = useSharedValue(0);
  const bright = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(pulse);
    cancelAnimation(spin);
    cancelAnimation(scan);
    const ease = Easing.inOut(Easing.sin);
    part.value = withTiming(state === 'listening' ? 1 : state === 'thinking' ? 0.4 : 0, { duration: 260 });
    bright.value = withTiming(state === 'listening' ? 1 : state === 'speaking' ? 0.7 : 0, { duration: 220 });
    if (reduceMotion) {
      pulse.value = state === 'idle' ? 0.8 : 1;
      spin.value = 0;
      scan.value = 0.5;
      return;
    }
    if (state === 'idle') {
      pulse.value = withRepeat(withSequence(withTiming(1, { duration: 1400, easing: ease }), withTiming(0.62, { duration: 1400, easing: ease })), -1);
    } else if (state === 'thinking') {
      pulse.value = withTiming(0.85, { duration: 200 });
      spin.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.linear }), -1);
      scan.value = withRepeat(withSequence(withTiming(1, { duration: 380, easing: ease }), withTiming(0, { duration: 380, easing: ease })), -1);
    } else if (state === 'speaking') {
      pulse.value = withRepeat(withSequence(withTiming(1, { duration: 140 }), withTiming(0.75, { duration: 180 })), -1);
    } else {
      pulse.value = withTiming(1, { duration: 200 });
    }
  }, [state, reduceMotion, pulse, part, spin, scan, bright]);

  const visor = useAnimatedStyle(() => {
    const lv = level ? level.value : 0;
    return { opacity: Math.min(1, pulse.value + lv * 0.4), transform: [{ scaleX: 1 + bright.value * 0.04 + lv * 0.05 }] };
  });
  const glow = useAnimatedStyle(() => ({ opacity: 0.25 + pulse.value * 0.35 + bright.value * 0.4, transform: [{ scale: 1 + bright.value * 0.08 }] }));
  const leftPlate = useAnimatedStyle(() => ({ transform: [{ translateX: -part.value * 7 * s }, { rotate: `${-part.value * 4}deg` }] }));
  const rightPlate = useAnimatedStyle(() => ({ transform: [{ translateX: part.value * 7 * s }, { rotate: `${part.value * 4}deg` }] }));
  const crest = useAnimatedStyle(() => ({ transform: [{ translateY: -part.value * 4 * s }] }));
  const panels = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }, { scale: 1 + Math.sin(spin.value * Math.PI * 2) * 0.06 }] }));
  const scanLine = useAnimatedStyle(() => ({
    opacity: state === 'thinking' ? 0.9 : 0,
    transform: [{ translateX: (scan.value - 0.5) * 70 * s }],
  }));

  const steel = p.mode === 'dark' ? ['#5B6670', '#2A3138'] : ['#E3E8EC', '#9AA6B0'];
  const plate = p.mode === 'dark' ? ['#46515A', '#20262C'] : ['#F2F5F7', '#B4BEC6'];
  const visorColor = p.cyan;

  const layer = (children: ReactNode) => (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Defs>
        <LinearGradient id="steel" x1="0" y1="0" x2="0.4" y2="1">
          <Stop offset="0" stopColor={steel[0]} />
          <Stop offset="1" stopColor={steel[1]} />
        </LinearGradient>
        <LinearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={plate[0]} />
          <Stop offset="1" stopColor={plate[1]} />
        </LinearGradient>
      </Defs>
      {children}
    </Svg>
  );

  return (
    <View style={{ width: size, height: size }} accessible accessibilityRole="image" accessibilityLabel={`${label}, ${state}`}>
      {/* aura */}
      <Animated.View style={[StyleSheet.absoluteFill, glow]} pointerEvents="none">
        {layer(
          <G>
            <Circle cx={100} cy={100} r={92} fill={p.cyan} opacity={0.06} />
            <Circle cx={100} cy={100} r={74} fill={p.cyan} opacity={0.07} />
          </G>,
        )}
      </Animated.View>
      {/* cheek plates */}
      <Animated.View style={[StyleSheet.absoluteFill, leftPlate]}>
        {layer(<Polygon points="34,82 52,70 58,138 44,150 30,122" fill="url(#plate)" stroke={p.seam} strokeWidth={1.5} />)}
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, rightPlate]}>
        {layer(<Polygon points="166,82 148,70 142,138 156,150 170,122" fill="url(#plate)" stroke={p.seam} strokeWidth={1.5} />)}
      </Animated.View>
      {/* crest */}
      <Animated.View style={[StyleSheet.absoluteFill, crest]}>
        {layer(<Polygon points="100,14 112,40 100,52 88,40" fill="url(#steel)" stroke={p.seam} strokeWidth={1.5} />)}
      </Animated.View>
      {/* head shell */}
      <View style={StyleSheet.absoluteFill}>
        {layer(
          <G>
            <Polygon points="62,40 138,40 156,72 150,140 124,168 76,168 50,140 44,72" fill="url(#steel)" stroke={p.seam} strokeWidth={2} />
            {/* brow ridge */}
            <Path d="M54 78 L100 66 L146 78" stroke={p.seamHi} strokeWidth={2} fill="none" opacity={0.7} />
            {/* visor well */}
            <Polygon points="56,84 144,84 136,106 64,106" fill={p.inset} stroke={p.seam} strokeWidth={1.5} />
            {/* jaw plate with vents */}
            <Polygon points="74,120 126,120 118,154 82,154" fill="url(#plate)" stroke={p.seam} strokeWidth={1.5} />
            {[86, 94, 102, 110].map((x) => (
              <Rect key={x} x={x} y={128} width={3} height={18} fill={p.inset} opacity={0.8} />
            ))}
            {/* seams */}
            <Path d="M100 40 V66 M62 40 L70 66 M138 40 L130 66 M50 140 L74 120 M150 140 L126 120" stroke={p.seam} strokeWidth={1.2} opacity={0.9} />
            {/* rivets */}
            <Circle cx={66} cy={56} r={2.2} fill={p.rivet} />
            <Circle cx={134} cy={56} r={2.2} fill={p.rivet} />
            <Circle cx={62} cy={146} r={2.2} fill={p.rivet} />
            <Circle cx={138} cy={146} r={2.2} fill={p.rivet} />
          </G>,
        )}
      </View>
      {/* forehead core panels (rotate while thinking) */}
      <Animated.View style={[styles.core, { left: 100 * s - 14 * s, top: 52 * s - 2 * s, width: 28 * s, height: 28 * s }, panels]} pointerEvents="none">
        <Svg width={28 * s} height={28 * s} viewBox="0 0 28 28">
          <Rect x={11} y={2} width={6} height={9} fill={visorColor} opacity={0.85} />
          <Rect x={11} y={17} width={6} height={9} fill={visorColor} opacity={0.45} />
          <Rect x={2} y={11} width={9} height={6} fill={visorColor} opacity={0.45} />
          <Rect x={17} y={11} width={9} height={6} fill={visorColor} opacity={0.85} />
        </Svg>
      </Animated.View>
      {/* visor glow */}
      <Animated.View style={[StyleSheet.absoluteFill, visor]} pointerEvents="none">
        {layer(
          <G>
            <Polygon points="58,86 142,86 135,104 65,104" fill={visorColor} opacity={0.18} />
            <Polygon points="62,90 138,90 133,100 67,100" fill={visorColor} opacity={0.55} />
            <Polygon points="68,93.5 132,93.5 130,96.5 70,96.5" fill="#FFFFFF" opacity={0.85} />
          </G>,
        )}
      </Animated.View>
      {/* thinking scan line */}
      <Animated.View style={[StyleSheet.absoluteFill, scanLine]} pointerEvents="none">
        {layer(<Rect x={97} y={86} width={6} height={18} fill="#FFFFFF" opacity={0.9} />)}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({ core: { position: 'absolute' } });
