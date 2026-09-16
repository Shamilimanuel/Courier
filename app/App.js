import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";
import { loadPairing } from "./src/lib/pairing";
import PairScreen from "./src/screens/PairScreen";
import HomeScreen from "./src/screens/HomeScreen";
import SyncScreen from "./src/screens/SyncScreen";
import TransferScreen from "./src/screens/TransferScreen";

function Root() {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [pairing, setPairing] = useState(null);
  const [screen, setScreen] = useState("pair");
  const [transferCategory, setTransferCategory] = useState(null);

  useEffect(() => {
    loadPairing().then((p) => {
      setPairing(p);
      setScreen(p ? "home" : "pair");
      setLoading(false);
    });
  }, []);

  function handlePaired(p) {
    setPairing(p);
    setScreen("home");
  }

  function handleUnpair() {
    setPairing(null);
    setScreen("pair");
  }

  function handleNavigate(target, category) {
    if (target === "transfer") setTransferCategory(category);
    setScreen(target);
  }

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.ground }]}>
        <ActivityIndicator color={theme.ink2} />
      </View>
    );
  }

  if (screen === "pair" || !pairing) {
    return <PairScreen onPaired={handlePaired} />;
  }
  if (screen === "text") {
    return <SyncScreen pairing={pairing} onBack={() => setScreen("home")} />;
  }
  if (screen === "transfer") {
    return (
      <TransferScreen
        category={transferCategory}
        pairing={pairing}
        onBack={() => setScreen("home")}
      />
    );
  }
  return <HomeScreen pairing={pairing} onNavigate={handleNavigate} onUnpair={handleUnpair} />;
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
