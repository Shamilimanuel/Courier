import { useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator, StyleSheet, AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { Cinzel_700Bold } from "@expo-google-fonts/cinzel/700Bold";
import { BarlowCondensed_700Bold } from "@expo-google-fonts/barlow-condensed/700Bold";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";
import { getDevices, getActiveDeviceId, setActiveDeviceId, addDevice, updateDevices } from "./src/lib/pairing";
import { Stop, onStop, startStop, shareNames, startFinding, stopFinding, targetOf } from "./src/lib/stop";
import PairAsk from "./src/components/PairAsk";
import PairScreen from "./src/screens/PairScreen";
import HomeScreen from "./src/screens/HomeScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import ShareScreen from "./src/screens/ShareScreen";

function Root() {
  const { theme } = useTheme();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState([]);
  const [activeDeviceId, setActiveId] = useState(null);
  const [screen, setScreen] = useState("pair");
  const [ask, setAsk] = useState(null);
  const activeRef = useRef(null);
  activeRef.current = activeDeviceId;

  useEffect(() => {
    Promise.all([getDevices(), getActiveDeviceId()]).then(([list, activeId]) => {
      setDevices(list);
      const resolved = list.find((d) => d.id === activeId)?.id || list[0]?.id || null;
      setActiveId(resolved);
      setScreen(list.length ? "home" : "pair");
      setLoading(false);
      followStops();
    });
  }, []);

  // ------------------------------------------------- this phone as a stop --
  // Courier listens in the background (the quiet "Courier is ready"
  // notification), so PCs and other phones can send here. On unless turned
  // off in Settings.
  useEffect(() => {
    if (!Stop) return;
    AsyncStorage.getItem("courier.stopOff").then((off) => {
      if (off !== "1") startStop();
    });
  }, []);

  useEffect(() => {
    shareNames(devices);
  }, [devices]);

  /** Applies what the stop learned while the app was closed: stops that
   * introduced themselves, and new addresses stops sent from. Then pins
   * PCs paired before the phone could check certificates. */
  async function followStops() {
    if (!Stop) return;
    let list = await getDevices();
    try {
      for (const peer of Stop.takeIntroductions()) await addPeer(peer, false);
      const addresses = Stop.getPeerAddresses() || {};
      list = (await updateDevices((d) => (d.peerId && addresses[d.peerId] ? { ip: addresses[d.peerId] } : null))) || (await getDevices());
      setDevices(list);
    } catch {
      // nothing new
    }
    for (const d of list) {
      if (d.kind === "phone" || d.fingerprint) continue;
      try {
        const securePort = Number(d.port) + 1;
        const fingerprint = await Stop.probeFingerprint(d.ip, securePort);
        // Only pin it once the token works over that secure port: proof it
        // is the same PC, not something else answering on this address.
        const res = await Stop.request({ ...targetOf(d), securePort, fingerprint }, "GET", "/health", null);
        if (res.status !== 200) continue;
        const health = JSON.parse(res.body || "{}");
        const check = await Stop.request({ ...targetOf(d), securePort, fingerprint }, "GET", "/files", null);
        if (check.status !== 200) continue;
        const next = await updateDevices((x) => (x.id === d.id ? { securePort, fingerprint, peerId: x.peerId || health.id } : null));
        if (next) setDevices(next);
      } catch {
        // off or old: try again next time
      }
    }
  }

  async function addPeer(peer, makeActive) {
    const device = await addDevice(
      {
        ip: peer.ip,
        port: peer.port,
        token: peer.token,
        hostname: peer.name,
        peerId: peer.id,
        kind: peer.kind,
        securePort: peer.securePort,
        fingerprint: peer.fingerprint,
      },
      { makeActive }
    );
    const list = await getDevices();
    setDevices(list);
    if (makeActive || !activeRef.current) setActiveId(device.id);
    return device;
  }

  useEffect(() => {
    if (!Stop) return undefined;
    const offs = [
      onStop("onPeerIntroduced", () => followStops()),
      onStop("onPeerSeen", async ({ id, ip }) => {
        const next = await updateDevices((d) => (d.peerId === id ? { ip } : null));
        if (next) setDevices(next);
      }),
      // A paired stop announcing itself somewhere new on the Wi-Fi.
      onStop("onFound", async (f) => {
        const next = await updateDevices((d) => (d.peerId === f.id ? { ip: f.ip, port: String(f.port) } : null));
        if (next) setDevices(next);
      }),
      onStop("onPairRequest", (r) => setAsk(r)),
      onStop("onPairSettled", ({ requestId }) => setAsk((cur) => (cur && cur.requestId === requestId ? null : cur))),
    ];
    try {
      const pending = Stop.getPendingPairs();
      if (pending.length) setAsk(pending[pending.length - 1]);
    } catch {
      // none
    }
    // Listen for stops while the app is open; let go in the background.
    startFinding();
    let listening = true;
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active" && !listening) {
        listening = true;
        startFinding();
        followStops();
        try {
          const pending = Stop.getPendingPairs();
          if (pending.length) setAsk(pending[pending.length - 1]);
        } catch {
          // none
        }
      } else if (state !== "active" && listening) {
        listening = false;
        stopFinding();
      }
    });
    return () => {
      offs.forEach((off) => off());
      appState.remove();
      if (listening) stopFinding();
    };
  }, []);

  async function answerAsk(allow) {
    const current = ask;
    setAsk(null);
    if (!current) return;
    let peer = null;
    try {
      peer = Stop.answerPair(current.requestId, allow);
    } catch {
      peer = null;
    }
    if (peer) {
      await addPeer(peer, true);
      setScreen("home");
    }
  }

  function handlePaired(device) {
    // Pairing the same stop again updates it rather than adding a second one.
    getDevices().then(setDevices);
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

  function handleNavigate(target) {
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
  const askSheet = <PairAsk ask={ask} onAnswer={answerAsk} />;

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
    return (
      <>
        <PairScreen onPaired={handlePaired} onBack={devices.length ? () => setScreen("home") : undefined} />
        {askSheet}
      </>
    );
  }
  if (screen === "settings") {
    return (
      <>
        <SettingsScreen
          devices={devices}
          onDevicesChanged={handleDevicesChanged}
          onBack={() => setScreen("home")}
        />
        {askSheet}
      </>
    );
  }
  return (
    <>
      <HomeScreen
        devices={devices}
        activeDevice={activeDevice}
        onSwitchDevice={handleSwitchDevice}
        onAddDevice={() => setScreen("pair")}
        onNavigate={handleNavigate}
      />
      {askSheet}
    </>
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
