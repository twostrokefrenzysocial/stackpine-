import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../AppContext';
import { feedback } from '../feedback';
import { space } from '../theme';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

const ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/chat/new', label: 'Chat', icon: 'chat' },
  { href: '/memory', label: 'Memory', icon: 'core' },
  { href: '/activity', label: 'Activity', icon: 'activity' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

/** Bottom navigation: black, hairline top border, red dot marks the active screen. */
export function Dock() {
  const { palette: p } = useApp();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom, backgroundColor: p.bg, borderTopColor: p.line }]} accessibilityRole="tablist">
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
            <Icon name={it.icon} size={22} color={active ? p.text : p.textSecondary} />
            <Txt variant="label" color={active ? p.text : p.textTertiary}>
              {it.label}
            </Txt>
            <View style={[styles.dot, { backgroundColor: active ? p.red : 'transparent' }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth * 2, paddingHorizontal: space.sm },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 60, paddingTop: space.xs },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 1 },
});
