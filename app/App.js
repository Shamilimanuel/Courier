import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { Cinzel_700Bold } from "@expo-google-fonts/cinzel/700Bold";
import { BarlowCondensed_700Bold } from "@expo-google-fonts/barlow-condensed/700Bold";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";
import { getDevices, getActiveDeviceId, setActiveDeviceId } from "./src/lib/pairing";
import PairScreen from "./src/screens/PairScreen";
import HomeScreen from "./src/screens/HomeScreen";
import SyncScreen from "./src/screens/SyncScreen";
import TransferScreen from "./src/screens/TransferScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import ShareScreen from "./src/screens/ShareScreen";

function Root() {
  const { theme } = useTheme();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState([]);
  const [activeDeviceId, setActiveId] = useState(null);
  const [screen, setScreen] = useState("pair");
  const [transferCategory, setTransferCategory] = useState(null);

  useEffect(() => {
    Promise.all([getDevices(), getActiveDeviceId()]).then(([list, activeId]) => {
      setDevices(list);
      const resolved = list.find((d) => d.id === activeId)?.id || list[0]?.id || null;
      setActiveId(resolved);
      setScreen(list.length ? "home" : "pair");
      setLoading(false);
    });
  }, []);

  function handlePaired(device) {
    setDevices((current) => [...current, device]);
    setActiveId(device.id);
    setScreen("home");
  }

  function handleSwitchDevice(id) {
    setActiveId(id);
    setActiveDeviceId(id);
  }

  function handleDevicesChanged(remaining) {
    setDevices(remaining);
    if (remaining.length === 0) {
      setActiveId(null);
      setScreen("pair");
      return;
    }
    if (!remaining.some((d) => d.id === activeDeviceId)) {
      setActiveId(remaining[0].id);
    }
  }

  function handleNavigate(target, category) {
    if (target === "transfer") setTransferCategory(category);
    setScreen(target);
  }

  const activeDevice = devices.find((d) => d.id === activeDeviceId) || null;

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.ground }]}>
        <ActivityIndicator color={theme.ink2} />
      </View>
    );
  }

  // Something shared from another app ("Share → Courier") wins over whatever
  // screen was open: pick a stop, send, then back to where it was.
  if (hasShareIntent && devices.length) {
    return (
      <ShareScreen
        devices={devices}
        activeDeviceId={activeDeviceId}
        shareIntent={shareIntent}
        onClose={() => {
          resetShareIntent();
          setScreen("home");
        }}
      />
    );
  }

  if (screen === "pair" || !activeDevice) {
    return <PairScreen onPaired={handlePaired} onBack={devices.length ? () => setScreen("home") : undefined} />;
  }
  if (screen === "text") {
    return <SyncScreen pairing={activeDevice} onBack={() => setScreen("home")} />;
  }
  if (screen === "transfer") {
    return (
      <TransferScreen
        category={transferCategory}
        pairing={activeDevice}
        onBack={() => setScreen("home")}
      />
    );
  }
  if (screen === "settings") {
    return (
      <SettingsScreen
        devices={devices}
        onDevicesChanged={handleDevicesChanged}
        onBack={() => setScreen("home")}
      />
    );
  }
  return (
    <HomeScreen
      devices={devices}
      activeDevice={activeDevice}
      onSwitchDevice={handleSwitchDevice}
      onAddDevice={() => setScreen("pair")}
      onNavigate={handleNavigate}
    />
  );
}

/** Light status-bar text on the dark looks, dark text on the light ones. */
function ThemedStatusBar() {
  const { theme } = useTheme();
  return <StatusBar style={theme.dark ? "light" : "dark"} />;
}

export default function App() {
  // Titles in Night & Gold and Airmail. Until they load (a moment, from the
  // app itself) those titles fall back to the system font.
  useFonts({ Cinzel_700Bold, BarlowCondensed_700Bold });
  return (
    <ShareIntentProvider>
      <SafeAreaProvider>
        <ThemeProvider>
          <Root />
          <ThemedStatusBar />
        </ThemeProvider>
      </SafeAreaProvider>
    </ShareIntentProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
