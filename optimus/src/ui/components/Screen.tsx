import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useApp } from '../AppContext';
import { GUTTER, space } from '../theme';

/** True black canvas. */
export function Backdrop() {
  const { palette: p } = useApp();
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: p.bg }]} pointerEvents="none" />;
}

export function Screen({ children, scroll = true, style, contentStyle, padTop = true, ...rest }: { children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle>; contentStyle?: StyleProp<ViewStyle>; padTop?: boolean } & ScrollViewProps) {
  const insets = useSafeAreaInsets();
  const { palette: p } = useApp();
  const pad = { paddingTop: padTop ? insets.top + space.lg : 0, paddingBottom: insets.bottom + 96, paddingHorizontal: GUTTER };
  return (
    <View style={[styles.root, { backgroundColor: p.bg }, style]}>
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

/** Fade to black behind floating controls (a functional scrim, not decoration). */
export function LinearFade({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="lf" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity={0} />
            <Stop offset="0.3" stopColor="#000" stopOpacity={0.94} />
            <Stop offset="1" stopColor="#000" stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#lf)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
