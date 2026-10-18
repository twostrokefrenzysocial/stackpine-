import { ChakraPetch_500Medium, ChakraPetch_600SemiBold, ChakraPetch_700Bold } from '@expo-google-fonts/chakra-petch';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { boot, type Runtime } from '../platform/runtime';
import { AppProvider, useApp } from '../ui/AppContext';
import { BootSplash } from '../ui/components/BootSplash';
import { LockGate } from '../ui/LockGate';
import { useAppLifecycle } from '../ui/useAppLifecycle';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Shell() {
  const { palette, settings } = useApp();
  useAppLifecycle();
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(palette.ground).catch(() => undefined);
  }, [palette.ground]);
  return (
    <View style={[styles.root, { backgroundColor: palette.ground }]}>
      <StatusBar style={palette.mode === 'dark' ? 'light' : 'dark'} />
      <LockGate enabled={settings.appLockEnabled}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.ground },
            animation: 'fade',
            animationDuration: 240,
          }}
        >
          <Stack.Screen name="chat/[id]" options={{ animation: 'slide_from_right', animationDuration: 300 }} />
          <Stack.Screen name="onboarding" options={{ animation: 'fade_from_bottom', animationDuration: 300 }} />
        </Stack>
      </LockGate>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    ChakraPetch_500Medium,
    ChakraPetch_600SemiBold,
    ChakraPetch_700Bold,
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
