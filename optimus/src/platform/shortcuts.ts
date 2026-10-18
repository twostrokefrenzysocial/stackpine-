import * as QuickActions from 'expo-quick-actions';
import { router } from 'expo-router';
import { Platform } from 'react-native';

/** Long-press app icon shortcuts. */
const ACTIONS: QuickActions.Action[] = [
  { id: 'ask', title: 'Ask Optimus', params: { href: '/chat/new' } },
  { id: 'brief', title: 'Today’s brief', params: { href: '/' } },
  { id: 'voice', title: 'Voice', params: { href: '/chat/new?voice=1' } },
];

export async function installShortcuts(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    if (await QuickActions.isSupported()) await QuickActions.setItems(ACTIONS);
  } catch {
    // Launcher without shortcut support: nothing to do.
  }
}

/** Routes a shortcut tap (cold start or while running). Returns an unsubscribe. */
export function handleShortcuts(): () => void {
  if (Platform.OS === 'web') return () => undefined;
  const go = (a?: QuickActions.Action) => {
    const href = a?.params?.href;
    if (typeof href === 'string') router.push(href as never);
  };
  if (QuickActions.initial) setTimeout(() => go(QuickActions.initial), 300);
  const sub = QuickActions.addListener(go);
  return () => sub.remove();
}
