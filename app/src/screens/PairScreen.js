import { useState } from "react";
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeContext";
import { ClayField, ClayButton, IconButton } from "../components/Clay";
import QRScanner from "../components/QRScanner";
import { addDevice } from "../lib/pairing";
import { checkHealth, ApiError } from "../lib/api";
import { BackIcon } from "../components/icons";

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
      return { ip: params.ip, port: params.port, token: params.token };
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

export default function PairScreen({ onPaired, onBack }) {
  const { theme } = useTheme();
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("5544");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  async function attemptPair(draft) {
    setError(null);
    if (!draft.ip.trim() || !draft.port.trim() || !draft.token.trim()) {
      setError("Fill in the PC's address, port, and token.");
      return;
    }
    const clean = { ip: draft.ip.trim(), port: String(draft.port).trim(), token: draft.token.trim() };
    setBusy(true);
    try {
      const health = await checkHealth(clean);
      const device = await addDevice({ ...clean, hostname: health.hostname });
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

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.ground }]} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      {onBack && (
        <View style={styles.backRow}>
          <IconButton accessibilityLabel="Back" onPress={onBack}>
            <BackIcon size={17} color={theme.ink} strokeWidth={2.2} />
          </IconButton>
        </View>
      )}

      <Text style={[styles.title, { color: theme.ink }]}>
        {onBack ? "Add a stop" : "Add your first stop"}
      </Text>
      <Text style={[styles.subtitle, { color: theme.ink2 }]}>
        Run the Courier installer or `npm run pair` on that PC, then scan the
        code it shows — or enter the details by hand below.
      </Text>

      <View style={styles.scanWrap}>
        <ClayButton label="Scan QR code" tone="accent" onPress={() => setScannerOpen(true)} />
      </View>

      <Text style={[styles.label, { color: theme.ink2 }]}>PC address</Text>
      <ClayField
        placeholder="192.168.1.42"
        value={ip}
        onChangeText={setIp}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={[styles.label, { color: theme.ink2 }]}>Port</Text>
      <ClayField
        placeholder="5544"
        value={port}
        onChangeText={setPort}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="number-pad"
      />

      <Text style={[styles.label, { color: theme.ink2 }]}>Token</Text>
      <ClayField
        placeholder="paste the token here"
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}

      <View style={styles.buttonWrap}>
        <ClayButton label="Pair" onPress={() => attemptPair({ ip, port, token })} busy={busy} />
      </View>

      <QRScanner visible={scannerOpen} onClose={() => setScannerOpen(false)} onScanned={handleScanned} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1, padding: 24, justifyContent: "center" },
  backRow: { position: "absolute", top: 8, left: 0 },
  title: { fontSize: 22, fontWeight: "800", marginBottom: 8 },
  subtitle: { fontSize: 13, lineHeight: 19, marginBottom: 20 },
  scanWrap: { marginBottom: 22 },
  label: { fontSize: 12, fontWeight: "700", marginBottom: 6, marginTop: 14 },
  error: { fontSize: 12.5, fontWeight: "700", marginTop: 16 },
  buttonWrap: { marginTop: 22 },
});
