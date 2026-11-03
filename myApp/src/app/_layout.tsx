import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Constants from "expo-constants";

import AppSplashScreen from "../components/AppSplashScreen";
import { AuthProvider, useAuth } from "../context/AuthContext";

const SPLASH_MINIMUM_DURATION_MS = 4500;
const splashStartedAt = Date.now();

// True when running inside standard Expo Go (not a dev build)
const isExpoGo = Constants.executionEnvironment === "storeClient";

void SplashScreen.preventAutoHideAsync().catch((error) => {
  console.warn("[Splash] Could not keep the splash screen visible.", error);
});

function SplashGate() {
  const { state } = useAuth();
  const [nativeSplashDismissed, setNativeSplashDismissed] = useState(false);
  const [appSplashVisible, setAppSplashVisible] = useState(true);

  // The native OS splash only needs to stay up until this JS tree has
  // something to paint — our own AppSplashScreen is that thing, and it's
  // mounted below on the very first render, so we hide the native one right
  // away rather than holding it for the full auth/2s wait.
  useEffect(() => {
    void SplashScreen.hideAsync()
      .catch((error) => {
        console.warn("[Splash] Could not hide the native splash screen.", error);
      })
      .finally(() => setNativeSplashDismissed(true));
  }, []);

  const authReady = state.status !== "loading";
  const [minimumDurationElapsed, setMinimumDurationElapsed] = useState(false);

  useEffect(() => {
    const remaining = Math.max(0, SPLASH_MINIMUM_DURATION_MS - (Date.now() - splashStartedAt));
    const timeout = setTimeout(() => setMinimumDurationElapsed(true), remaining);
    return () => clearTimeout(timeout);
  }, []);

  const handleAppSplashHidden = useCallback(() => setAppSplashVisible(false), []);

  // The branded splash is ready to fade out once auth has hydrated, the
  // minimum hold time has passed, and the native splash is out of the way.
  const readyToDismiss = authReady && minimumDurationElapsed && nativeSplashDismissed;

  return (
    <View style={styles.fill}>
      <Stack screenOptions={{ headerShown: false }} />
      {appSplashVisible ? (
        <AppSplashScreen ready={readyToDismiss} onHidden={handleAppSplashHidden} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

export default function RootLayout() {
  useEffect(() => {
    // expo-notifications push support was removed from Expo Go in SDK 53.
    // Skip the channel setup entirely when running in Expo Go to avoid a crash.
    if (Platform.OS !== "android" || isExpoGo) return;

    // Dynamic import so the module is never even loaded in Expo Go.
    void import("expo-notifications").then((Notifications) => {
      void Notifications.setNotificationChannelAsync("default", {
        name: "BloodBridge notifications",
        importance: Notifications.AndroidImportance.MAX,
      }).catch((error) => {
        console.warn("[Notifications] Could not configure the Android channel.", error);
      });
    });
  }, []);

  // AuthProvider sits above the Stack so every route — including the initial
  // one — can read the session. It renders nothing until the stored token has
  // been read, which is a single keychain lookup rather than a network call.
  return (
    <AuthProvider>
      <SplashGate />
    </AuthProvider>
  );
}
