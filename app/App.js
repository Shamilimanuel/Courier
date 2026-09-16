import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";
import { getDevices, getActiveDeviceId, setActiveDeviceId } from "./src/lib/pairing";
import PairScreen from "./src/screens/PairScreen";
import HomeScreen from "./src/screens/HomeScreen";
import SyncScreen from "./src/screens/SyncScreen";
import TransferScreen from "./src/screens/TransferScreen";

function Root() {
  const { theme } = useTheme();
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
  return (
    <HomeScreen
      devices={devices}
      activeDevice={activeDevice}
      onSwitchDevice={handleSwitchDevice}
      onAddDevice={() => setScreen("pair")}
      onDevicesChanged={handleDevicesChanged}
      onNavigate={handleNavigate}
    />
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Root />
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
