import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Line, LinearGradient, Pattern, Rect, Stop } from 'react-native-svg';
import { useApp } from '../AppContext';
import { space } from '../theme';

/** Engineered backdrop: deep gradient with a faint blueprint grid. */
export function Backdrop() {
  const { palette: p } = useApp();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={p.ground} />
            <Stop offset="1" stopColor={p.groundDeep} />
          </LinearGradient>
          <Pattern id="grid" width={32} height={32} patternUnits="userSpaceOnUse">
            <Line x1={0} y1={0} x2={32} y2={0} stroke={p.seam} strokeWidth={0.5} strokeOpacity={p.mode === 'dark' ? 0.35 : 0.5} />
            <Line x1={0} y1={0} x2={0} y2={32} stroke={p.seam} strokeWidth={0.5} strokeOpacity={p.mode === 'dark' ? 0.35 : 0.5} />
          </Pattern>
          <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={p.ground} stopOpacity={0} />
            <Stop offset="0.55" stopColor={p.ground} stopOpacity={0.4} />
            <Stop offset="1" stopColor={p.groundDeep} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#bg)" />
        <Rect width="100%" height="100%" fill="url(#grid)" />
        <Rect width="100%" height="100%" fill="url(#fade)" />
      </Svg>
    </View>
  );
}

export function Screen({ children, scroll = true, style, contentStyle, padTop = true, ...rest }: { children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle>; padTop?: boolean } & ScrollViewProps) {
  const insets = useSafeAreaInsets();
  const pad = { paddingTop: padTop ? insets.top + space.md : 0, paddingBottom: insets.bottom + 96, paddingHorizontal: space.lg };
  return (
    <View style={[styles.root, style]}>
      <Backdrop />
      {scroll ? (
        <ScrollView contentContainerStyle={[pad, contentStyle]} keyboardShouldPersistTaps="handled" {...rest}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.root, pad, contentStyle]}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });

/** Vertical fade to a solid colour, used behind floating controls. */
export function LinearFade({ color, style }: { color: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="lf" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0} />
            <Stop offset="0.35" stopColor={color} stopOpacity={0.92} />
            <Stop offset="1" stopColor={color} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#lf)" />
      </Svg>
    </View>
  );
}
