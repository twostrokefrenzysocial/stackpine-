import { Inter_200ExtraLight, Inter_300Light, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { registerBackgroundWork } from '../platform/backgroundTask';
import { routeNotificationTaps, scheduleDailyBrief } from '../platform/notify';
import { boot, type Runtime } from '../platform/runtime';
import { handleShortcuts, installShortcuts } from '../platform/shortcuts';
import { AppProvider, useApp } from '../ui/AppContext';
import { BootSplash } from '../ui/components/BootSplash';
import { LockGate } from '../ui/LockGate';
import { useAppLifecycle } from '../ui/useAppLifecycle';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Shell() {
  const { palette, settings } = useApp();
  useAppLifecycle();
  useEffect(() => {
    registerBackgroundWork().catch(() => undefined);
    installShortcuts();
    const a = handleShortcuts();
    const b = routeNotificationTaps((href) => router.push(href as never));
    return () => {
      a();
      b();
    };
  }, []);
  useEffect(() => {
    scheduleDailyBrief(settings.briefEnabled, settings.briefTime).catch(() => undefined);
  }, [settings.briefEnabled, settings.briefTime]);
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(palette.bg).catch(() => undefined);
  }, [palette.bg]);
  return (
    <View style={[styles.root, { backgroundColor: palette.bg }]}>
      <StatusBar style="dark" />
      <LockGate enabled={settings.appLockEnabled}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.bg },
            animation: 'fade',
            animationDuration: 240,
          }}
        >
          <Stack.Screen name="chat/[id]" options={{ animation: 'slide_from_right', animationDuration: 300 }} />
          <Stack.Screen name="onboarding" options={{ animation: 'fade_from_bottom', animationDuration: 300 }} />
          <Stack.Screen name="voice" options={{ animation: 'fade', animationDuration: 250 }} />
        </Stack>
      </LockGate>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_200ExtraLight,
    Inter_300Light,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  const [rt, setRt] = useState<Runtime | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    boot()
      .then(setRt)
      .catch((e) => {
        console.error("Optimus boot failed", e);
        setFailed(e instanceof Error ? e.message : String(e));
      });
  }, []);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        {rt ? (
          <AppProvider rt={rt}>
            <Shell />
            {!introDone && <BootSplash onDone={() => setIntroDone(true)} />}
          </AppProvider>
        ) : (
          <BootSplash standalone error={failed} onDone={() => undefined} />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
