import * as LocalAuthentication from "expo-local-authentication";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { shouldRelock } from "../core/security/lock";
import { useApp } from "./AppContext";
import { Brain } from "./components/Brain";
import { Button } from "./components/Button";
import { Backdrop } from "./components/Screen";
import { StatusStrip } from "./components/StatusStrip";
import { Txt } from "./components/Txt";
import { feedback } from "./feedback";
import { space } from "./theme";

/**
 * App lock: biometric (fingerprint/face) on open, styled as a visor scan.
 * Re-locks after 5 minutes in the background.
 */
export function LockGate({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const { palette: p, reduceMotion } = useApp();
  const insets = useSafeAreaInsets();
  const [locked, setLocked] = useState(enabled && Platform.OS !== "web");
  const [message, setMessage] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const bgAt = useRef<number | null>(null);
  const scan = useSharedValue(0);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") bgAt.current = Date.now();
      if (s === "active") {
        if (
          enabled &&
          Platform.OS !== "web" &&
          shouldRelock(bgAt.current, Date.now())
        )
          setLocked(true);
        bgAt.current = null;
      }
    });
    return () => sub.remove();
  }, [enabled]);

  const attempt = useRef(0);

  const unlock = useCallback(async () => {
    const my = ++attempt.current;
    setMessage(null);
    setScanning(true);
    // A prompt that never showed (app not in front yet, or a previous prompt
    // still open) would otherwise leave the scan pending forever.
    try {
      await LocalAuthentication.cancelAuthenticate();
    } catch {
      // nothing to cancel
    }
    const timeout = new Promise<LocalAuthentication.LocalAuthenticationResult>(
      (resolve) =>
        setTimeout(
          () => resolve({ success: false, error: "timeout" as never }),
          25_000,
        ),
    );
    try {
      const [hasHw, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      const res = await Promise.race([
        LocalAuthentication.authenticateAsync({
          promptMessage: "Unlock Optimus",
          cancelLabel: "Cancel",
          disableDeviceFallback: false,
        }),
        timeout,
      ]);
      if (my !== attempt.current) return;
      if (res.success) {
        feedback.fire("confirm");
        setLocked(false);
      } else if (
        res.error === "not_enrolled" ||
        res.error === "not_available" ||
        (!hasHw && !enrolled)
      ) {
        setMessage(
          "No fingerprint, face or screen lock is set up on this phone, so Optimus can’t be locked. Set one up in Samsung Settings › Security.",
        );
        setLocked(false);
      } else if (String(res.error) === "timeout") {
        setMessage(
          "The unlock prompt didn’t appear. Tap Scan to unlock to try again.",
        );
      } else if (res.error !== "user_cancel" && res.error !== "system_cancel") {
        feedback.fire("error");
        setMessage("Scan didn’t match. Try again.");
      }
    } catch {
      if (my === attempt.current)
        setMessage(
          "Biometric unlock isn’t available right now. Tap Scan to unlock to try again.",
        );
    } finally {
      if (my === attempt.current) setScanning(false);
    }
  }, []);

  // Prompt automatically once the lock screen has rendered, and again
  // whenever the app comes back to the front while still locked.
  useEffect(() => {
    if (!locked || !enabled) return;
    const t = setTimeout(unlock, 150);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setTimeout(unlock, 300);
    });
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, [locked, enabled, unlock]);

  useEffect(() => {
    if (reduceMotion) return;
    scan.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Easing.bezier(0.2, 0, 0, 1) }),
        withTiming(0, { duration: 1100, easing: Easing.bezier(0.2, 0, 0, 1) }),
      ),
      -1,
    );
  }, [scan, reduceMotion]);
  const beam = useAnimatedStyle(() => ({
    transform: [{ translateY: scan.value * 220 - 110 }],
  }));

  return (
    <View style={{ flex: 1 }}>
      {children}
      {locked && enabled && (
        <View
          style={[StyleSheet.absoluteFill, { zIndex: 50 }]}
          accessibilityViewIsModal
        >
          <Backdrop />
          <View
            style={[
              styles.center,
              {
                paddingTop: insets.top,
                paddingBottom: insets.bottom + space.xl,
              },
            ]}
          >
            <StatusStrip
              state={scanning ? "listening" : "idle"}
              detail="IDENTITY CHECK"
            />
            <View style={styles.scanner}>
              <Brain
                size={230}
                state={scanning ? "listening" : "idle"}
                interactive={false}
                accessibilityLabel="Optimus"
              />
              {!reduceMotion && (
                <Animated.View
                  style={[styles.beam, { backgroundColor: p.red }, beam]}
                  pointerEvents="none"
                />
              )}
            </View>
            <Txt variant="display" style={{ textAlign: "center" }}>
              Locked
            </Txt>
            <Txt
              variant="body"
              color={p.textSecondary}
              style={{ textAlign: "center", maxWidth: 300 }}
            >
              {message ?? "Use your fingerprint or face to unlock."}
            </Txt>
            <Button
              label={scanning ? "Scanning… tap to retry" : "Scan to unlock"}
              icon="scan"
              onPress={unlock}
              style={{ alignSelf: "stretch", marginTop: space.lg }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: space.lg,
    paddingHorizontal: space.xl,
  },
  scanner: {
    width: 260,
    height: 260,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: space.xl,
  },
  beam: { position: "absolute", left: 16, right: 16, height: 1, opacity: 0.8 },
});
