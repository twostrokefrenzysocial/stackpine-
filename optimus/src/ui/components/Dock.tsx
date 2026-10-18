import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useApp } from '../AppContext';
import { feedback } from '../feedback';
import { space } from '../theme';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

const ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Command', icon: 'home' },
  { href: '/chat/new', label: 'Chat', icon: 'chat' },
  { href: '/memory', label: 'Memory', icon: 'core' },
  { href: '/activity', label: 'Activity', icon: 'activity' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

/** Bottom command dock: a machined rail with a lit indicator. */
export function Dock() {
  const { palette: p } = useApp();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const [w, setW] = useState(0);
  const h = 64;
  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom }]} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityRole="tablist">
      {w > 0 && (
        <Svg width={w} height={h + insets.bottom} style={StyleSheet.absoluteFill}>
          <Path d={`M0,10 L14,0 H${w - 14} L${w},10 V${h + insets.bottom} H0 Z`} fill={p.surface} stroke={p.seam} strokeWidth={1} />
          <Path d={`M16,1.5 H${w - 16}`} stroke={p.seamHi} strokeWidth={1} opacity={0.6} />
        </Svg>
      )}
      <View style={[styles.row, { height: h }]}>
        {ITEMS.map((it) => {
          const active = it.href === '/' ? path === '/' : path.startsWith(it.href.replace('/new', ''));
          return (
            <Pressable
              key={it.href}
              onPress={() => {
                if (active && it.href !== '/chat/new') return;
                feedback.fire('tap');
                if (it.href === '/chat/new') router.push('/chat/new');
                else router.replace(it.href as never);
              }}
              style={styles.item}
              accessibilityRole="tab"
              accessibilityLabel={it.label}
              accessibilityState={{ selected: active }}
            >
              <View style={[styles.indicator, { backgroundColor: active ? p.cyan : 'transparent' }]} />
              <Icon name={it.icon} size={22} color={active ? p.cyanText : p.textDim} />
              <Txt variant="label" color={active ? p.cyanText : p.textFaint} style={{ fontSize: 10, letterSpacing: 1.2 }}>
                {it.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  row: { flexDirection: 'row', paddingHorizontal: space.sm },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 56 },
  indicator: { position: 'absolute', top: 4, width: 22, height: 3 },
});
