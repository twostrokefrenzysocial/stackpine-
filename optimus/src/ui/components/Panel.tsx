import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { useApp } from '../AppContext';
import { chamfer as CH, motion, space, type Palette } from '../theme';
import { Rivet } from './Icon';
import { Txt } from './Txt';

export type Tone = 'default' | 'cyan' | 'amber' | 'danger' | 'inset';

function toneColors(p: Palette, tone: Tone) {
  switch (tone) {
    case 'cyan':
      return { edge: p.cyan, top: p.surfaceHi, bottom: p.surfaceLo, accent: p.cyan };
    case 'amber':
      return { edge: p.amber, top: p.surfaceHi, bottom: p.surfaceLo, accent: p.amber };
    case 'danger':
      return { edge: p.danger, top: p.surfaceHi, bottom: p.surfaceLo, accent: p.danger };
    case 'inset':
      return { edge: p.seam, top: p.inset, bottom: p.inset, accent: p.seam };
    default:
      return { edge: p.seam, top: p.surfaceHi, bottom: p.surfaceLo, accent: p.cyan };
  }
}

/** Chamfered outline: top-left and bottom-right corners cut at 45°. */
export function chamferPath(w: number, h: number, c: number, inset = 0.5): string {
  const i = inset;
  return `M${c + i},${i} H${w - i} V${h - c - i} L${w - c - i},${h - i} H${i} V${c + i} Z`;
}

export function PanelSurface({ width, height, tone = 'default', c = CH.md, glow }: { width: number; height: number; tone?: Tone; c?: number; glow?: boolean }) {
  const { palette: p } = useApp();
  const col = toneColors(p, tone);
  const id = `g${tone}${p.mode}`;
  if (width <= 0 || height <= 0) return null;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0.35" y2="1">
          <Stop offset="0" stopColor={col.top} />
          <Stop offset="1" stopColor={col.bottom} />
        </LinearGradient>
        <LinearGradient id={`${id}sheen`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={p.seamHi} stopOpacity={0} />
          <Stop offset="0.5" stopColor={p.seamHi} stopOpacity={p.mode === 'dark' ? 0.5 : 0.9} />
          <Stop offset="1" stopColor={p.seamHi} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {glow && <Path d={chamferPath(width, height, c, 0)} stroke={col.edge} strokeOpacity={0.35} strokeWidth={4} fill="none" />}
      <Path d={chamferPath(width, height, c)} fill={`url(#${id})`} stroke={col.edge} strokeWidth={tone === 'default' || tone === 'inset' ? 1 : 1.5} />
      {/* bevel highlight along the top edge */}
      <Line x1={c + 2} y1={1.5} x2={width - 2} y2={1.5} stroke={`url(#${id}sheen)`} strokeWidth={1} />
      {/* accent tab on the chamfer */}
      {tone !== 'inset' && <Line x1={2} y1={c + 6} x2={2} y2={c + 22} stroke={col.accent} strokeWidth={2} />}
    </Svg>
  );
}

export interface PanelProps {
  children?: ReactNode;
  tone?: Tone;
  label?: string;
  code?: string;
  right?: ReactNode;
  rivets?: boolean;
  glow?: boolean;
  /** Position in a list: staggers the assembly animation. */
  index?: number;
  assemble?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/**
 * A brushed-steel data panel. When `assemble` is on it builds itself from two
 * plates sliding in from opposite sides, then the contents fade up (< 400ms).
 */
export function Panel({ children, tone = 'default', label, code, right, rivets, glow, index = 0, assemble = true, style, contentStyle, accessibilityLabel }: PanelProps) {
  const { palette: p, reduceMotion } = useApp();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const animate = assemble && !reduceMotion;
  const progress = useSharedValue(animate ? 0 : 1);

  useEffect(() => {
    if (!animate) return;
    progress.value = withDelay(Math.min(index, 4) * 40, withTiming(1, { duration: motion.slow - 40, easing: Easing.out(Easing.cubic) }));
  }, [animate, index, progress]);

  const leftPlate = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value * 2),
    transform: [{ translateX: (1 - progress.value) * -28 }],
  }));
  const rightPlate = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value * 2),
    transform: [{ translateX: (1 - progress.value) * 28 }],
  }));
  const content = useAnimatedStyle(() => ({
    opacity: Math.max(0, (progress.value - 0.45) / 0.55),
    transform: [{ translateY: (1 - progress.value) * 6 }],
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - size.w) > 0.5 || Math.abs(height - size.h) > 0.5) setSize({ w: width, h: height });
  };

  const half = size.w / 2;
  return (
    <View style={[styles.wrap, style]} onLayout={onLayout} accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel}>
      {size.w > 0 && (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, { width: half + 1, overflow: 'hidden' }, leftPlate]} pointerEvents="none">
            <View style={{ width: size.w, height: size.h }}>
              <PanelSurface width={size.w} height={size.h} tone={tone} glow={glow} />
            </View>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, { left: half, width: half, overflow: 'hidden' }, rightPlate]} pointerEvents="none">
            <View style={{ width: size.w, height: size.h, marginLeft: -half }}>
              <PanelSurface width={size.w} height={size.h} tone={tone} glow={glow} />
            </View>
          </Animated.View>
        </>
      )}
      {rivets && (
        <>
          <View style={styles.rivetTR} pointerEvents="none">
            <Rivet color={p.rivet} highlight={p.seamHi} />
          </View>
          <View style={styles.rivetBL} pointerEvents="none">
            <Rivet color={p.rivet} highlight={p.seamHi} />
          </View>
        </>
      )}
      <Animated.View style={[styles.content, contentStyle, content]}>
        {(label || right) && (
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              {code && (
                <Txt variant="label" color={tone === 'amber' ? p.amberText : tone === 'danger' ? p.dangerText : p.cyanText}>
                  {code}
                </Txt>
              )}
              {label && (
                <Txt variant="label" color={p.textDim} accessibilityRole="header">
                  {label.toUpperCase()}
                </Txt>
              )}
            </View>
            {right}
          </View>
        )}
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  content: { padding: space.lg, paddingLeft: space.lg + 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md, gap: space.sm },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  rivetTR: { position: 'absolute', top: 7, right: 7 },
  rivetBL: { position: 'absolute', bottom: 7, left: 7 },
});
