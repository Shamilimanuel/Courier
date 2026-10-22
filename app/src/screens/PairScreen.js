import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, Pressable, ScrollView, ActivityIndicator, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeContext";
import { display, raised, sunken, filled } from "../theme/clay";
import { ClayField, ClayButton, IconButton } from "../components/Clay";
import QRScanner from "../components/QRScanner";
import { addDevice } from "../lib/pairing";
import { checkHealth, introduce, ApiError } from "../lib/api";
import { findStops, askToPair, waitForAnswer } from "../lib/find";
import { Stop, selfForPairing } from "../lib/stop";
import { BackIcon, PcIcon, PhoneIcon, SignalIcon, CheckIcon } from "../components/icons";

/** The agent's QR encodes a URL (so any camera app can open it); parse the
 * pairing fields out of its query string by hand rather than with the `URL`
 * API — Hermes doesn't reliably provide a working `URL`/`URLSearchParams`,
 * and a silent failure there means every scan looks like "not a pairing
 * code" instead of actually parsing. Falls back to the older raw-JSON
 * format in case an agent hasn't been updated yet. */
function parsePairingCode(data) {
  const queryIndex = data.indexOf("?");
  if (queryIndex !== -1) {
    const params = {};
    data
      .slice(queryIndex + 1)
      .split("&")
      .forEach((pair) => {
        const [key, value] = pair.split("=");
        if (key) params[decodeURIComponent(key)] = decodeURIComponent(value || "");
      });
    if (params.ip && params.port && params.token) {
      return { ip: params.ip, port: params.port, token: params.token, securePort: params.securePort, fingerprint: params.fp };
    }
  }
  try {
    const parsed = JSON.parse(data);
    if (parsed.ip && parsed.port && parsed.token) return parsed;
  } catch {
    // not JSON either
  }
  return null;
}

/**
 * Adding a stop, the three ways the prototype shows: find it on this Wi-Fi
 * (a code on both screens, Allow on the other one), scan its QR code, or
 * type its address.
 */
export default function PairScreen({ onPaired, onBack }) {
  const { theme } = useTheme();
  const [view, setView] = useState(Stop ? "find" : "manual"); // find | asking | manual
  const [found, setFound] = useState([]);
  const [asking, setAsking] = useState(null); // { target, code }
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("5544");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (view !== "find") return undefined;
    setFound([]);
    return findStops(setFound);
  }, [view]);

  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  async function pairFound(target) {
    setError(null);
    try {
      const { requestId, code } = await askToPair(target);
      cancelled.current = false;
      setAsking({ target, code });
      setView("asking");
      const answer = await waitForAnswer(target, requestId, () => cancelled.current);
      if (answer.state === "allowed" && answer.stop) {
        const s = answer.stop;
        const device = await addDevice({
          ip: target.ip,
          port: s.port || target.port,
          token: s.token,
          hostname: s.name || target.name,
          peerId: s.id,
          kind: s.kind,
          securePort: s.securePort,
          fingerprint: s.fingerprint,
        });
        onPaired(device);
        return;
      }
      if (answer.state === "cancelled") return;
      setError(answer.state === "denied" ? `${target.name} said no. Nothing was paired.` : "No answer in time. Try again.");
      setView("find");
    } catch (err) {
      setError(err.message || "Couldn't ask it to pair.");
      setView("find");
    }
  }

  async function attemptPair(draft) {
    setError(null);
    if (!String(draft.ip).trim() || !String(draft.port).trim() || !String(draft.token).trim()) {
      setError("Fill in the PC's address, port, and token.");
      return;
    }
    const clean = { ip: String(draft.ip).trim(), port: String(draft.port).trim(), token: String(draft.token).trim() };
    if (draft.securePort && draft.fingerprint) {
      clean.securePort = Number(draft.securePort);
      clean.fingerprint = draft.fingerprint;
    }
    setBusy(true);
    try {
      const health = await checkHealth(clean);
      const device = await addDevice({ ...clean, hostname: health.name || health.hostname, peerId: health.id, kind: health.kind });
      // Tell the PC how to reach this phone back, so it can send here too.
      const me = selfForPairing();
      if (me) introduce(device, me).catch(() => {});
      onPaired(device);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not connect.");
    } finally {
      setBusy(false);
    }
  }

  function handleScanned(data) {
    setScannerOpen(false);
    const parsed = parsePairingCode(data);
    if (!parsed) {
      const preview = String(data).slice(0, 90);
      setError(`That QR code isn't a Courier pairing code. Scanned: "${preview}"`);
      return;
    }
    setIp(parsed.ip);
    setPort(String(parsed.port));
    setToken(parsed.token);
    attemptPair(parsed);
  }

  const title = onBack ? "Add a stop" : "Add your first stop";

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.ground }]} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.backRow}>
          {view === "asking" || (view === "manual" && Stop) ? (
            <IconButton accessibilityLabel="Back" onPress={() => { cancelled.current = true; setView("find"); setError(null); }}>
              <BackIcon size={17} color={theme.ink} strokeWidth={2.2} />
            </IconButton>
          ) : onBack ? (
            <IconButton accessibilityLabel="Back" onPress={onBack}>
              <BackIcon size={17} color={theme.ink} strokeWidth={2.2} />
            </IconButton>
          ) : null}
        </View>

        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          {view === "find" && (
            <>
              <Text style={[styles.title, display(theme), { color: theme.ink }]}>{title}</Text>
              <Text style={[styles.subtitle, { color: theme.ink2 }]}>
                A stop is a PC or phone with Courier on it. Open Courier there, on this same Wi-Fi.
              </Text>
              <Radar />
              {found.length === 0 ? (
                <Text style={[styles.hint, { color: theme.ink3 }]}>Looking on this Wi-Fi…</Text>
              ) : (
                found.map((f) => (
                  <Pressable key={f.id} onPress={() => pairFound(f)} style={[styles.row, raised(theme, 0.6)]} accessibilityRole="button">
                    <View style={[styles.rowIcon, { backgroundColor: theme.clayLo }]}>
                      {f.kind === "phone" ? <PhoneIcon size={18} color={theme.dusk} strokeWidth={1.9} /> : <PcIcon size={18} color={theme.dusk} strokeWidth={1.9} />}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.rowName, { color: theme.ink }]} numberOfLines={1}>{f.name}</Text>
                      <Text style={[styles.rowMeta, { color: theme.ink2 }]}>{f.kind === "phone" ? "Phone" : "PC"} · tap to pair</Text>
                    </View>
                  </Pressable>
                ))
              )}
              {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
              <Text style={[styles.hint, { color: theme.ink3, marginTop: 18 }]}>Nothing turning up? Some Wi-Fi hides devices from each other.</Text>
              <ClayButton label="Scan a QR code" onPress={() => setScannerOpen(true)} style={{ marginTop: 10 }} />
              <ClayButton label="Type the address" tone="quiet" onPress={() => { setError(null); setView("manual"); }} style={{ marginTop: 10 }} />
            </>
          )}

          {view === "asking" && asking && (
            <View style={styles.center}>
              <View style={[styles.bigIcon, raised(theme, 0.7)]}>
                {asking.target.kind === "phone" ? <PhoneIcon size={28} color={theme.dusk} strokeWidth={1.8} /> : <PcIcon size={28} color={theme.dusk} strokeWidth={1.8} />}
              </View>
              <Text style={[styles.title, display(theme), { color: theme.ink, textAlign: "center" }]}>Pairing with {asking.target.name}</Text>
              <View style={styles.code}>
                {String(asking.code).split("").map((d, i) => (
                  <View key={i} style={[styles.digit, raised(theme, 0.7)]}>
                    <Text style={[styles.digitText, display(theme), { color: theme.ink }]}>{d}</Text>
                  </View>
                ))}
              </View>
              <Text style={[styles.subtitle, { color: theme.ink2, textAlign: "center" }]}>
                Same code on {asking.target.name}? Allow it there.
              </Text>
              <ActivityIndicator color={theme.dusk} style={{ marginTop: 6 }} />
              <ClayButton label="Cancel" tone="quiet" onPress={() => { cancelled.current = true; setView("find"); }} style={{ marginTop: 22, alignSelf: "stretch" }} />
            </View>
          )}

          {view === "manual" && (
            <>
              <Text style={[styles.title, display(theme), { color: theme.ink }]}>{Stop ? "Type the address" : title}</Text>
              <Text style={[styles.subtitle, { color: theme.ink2 }]}>
                On the PC, open Courier and go to Pair: the address, port and token are under the QR code.
              </Text>
              {!Stop && <ClayButton label="Scan QR code" tone="accent" onPress={() => setScannerOpen(true)} style={{ marginBottom: 16 }} />}

              <Text style={[styles.label, { color: theme.ink2 }]}>PC address</Text>
              <ClayField placeholder="192.168.1.42" value={ip} onChangeText={setIp} autoCapitalize="none" autoCorrect={false} />
              <Text style={[styles.label, { color: theme.ink2 }]}>Port</Text>
              <ClayField placeholder="5544" value={port} onChangeText={setPort} autoCapitalize="none" autoCorrect={false} keyboardType="number-pad" />
              <Text style={[styles.label, { color: theme.ink2 }]}>Token</Text>
              <ClayField placeholder="paste the token here" value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} />

              {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
              <ClayButton label="Pair" tone="accent" onPress={() => attemptPair({ ip, port, token })} busy={busy} style={{ marginTop: 22 }} />
            </>
          )}
        </ScrollView>

        <QRScanner visible={scannerOpen} onClose={() => setScannerOpen(false)} onScanned={handleScanned} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** The sweeping circle from the prototype's "Find a PC". */
function Radar() {
  const { theme } = useTheme();
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <View style={styles.radar}>
      <View style={[styles.ring, { borderColor: theme.clayLo, width: 160, height: 160, borderRadius: 80 }]} />
      <View style={[styles.ring, { borderColor: theme.clayLo, width: 100, height: 100, borderRadius: 50 }]} />
      <Animated.View style={[styles.sweep, { transform: [{ rotate }] }]}>
        <View style={[styles.sweepArm, { backgroundColor: theme.dusk }]} />
      </Animated.View>
      <View style={[styles.me, filled(theme, theme.dusk, theme.duskDeep)]}>
        <SignalIcon size={20} color={theme.onFill} strokeWidth={2} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { padding: 24, paddingTop: 56, flexGrow: 1 },
  backRow: { position: "absolute", top: 8, left: 8, zIndex: 2 },
  title: { fontSize: 22, fontWeight: "800", marginBottom: 8 },
  subtitle: { fontSize: 13, lineHeight: 19, marginBottom: 16 },
  hint: { fontSize: 12.5, fontWeight: "600", textAlign: "center", lineHeight: 18 },
  label: { fontSize: 12, fontWeight: "700", marginBottom: 6, marginTop: 14 },
  error: { fontSize: 12.5, fontWeight: "700", marginTop: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 12, marginBottom: 10 },
  rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowName: { fontWeight: "800", fontSize: 14.5 },
  rowMeta: { fontWeight: "600", fontSize: 12, marginTop: 2 },
  center: { alignItems: "center", paddingTop: 20 },
  bigIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  code: { flexDirection: "row", gap: 10, marginVertical: 18 },
  digit: { width: 52, height: 64, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  digitText: { fontSize: 32, fontWeight: "800" },
  radar: { width: 170, height: 170, alignSelf: "center", alignItems: "center", justifyContent: "center", marginVertical: 14 },
  ring: { position: "absolute", borderWidth: 2 },
  sweep: { position: "absolute", width: 160, height: 160, alignItems: "center" },
  sweepArm: { width: 2, height: 80, opacity: 0.5, borderRadius: 1 },
  me: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
});
