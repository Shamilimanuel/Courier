import { useState } from "react";
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { ClayField, ClayButton } from "../components/Clay";
import { savePairing } from "../lib/pairing";
import { checkHealth, ApiError } from "../lib/api";

export default function PairScreen({ onPaired }) {
  const { theme } = useTheme();
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("5544");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handlePair() {
    setError(null);
    if (!ip.trim() || !port.trim() || !token.trim()) {
      setError("Fill in the PC's address, port, and token.");
      return;
    }
    const pairing = { ip: ip.trim(), port: port.trim(), token: token.trim() };
    setBusy(true);
    try {
      const health = await checkHealth(pairing);
      await savePairing({ ...pairing, hostname: health.hostname });
      onPaired({ ...pairing, hostname: health.hostname });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not connect.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.ground }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={[styles.title, { color: theme.ink }]}>Pair with your PC</Text>
      <Text style={[styles.subtitle, { color: theme.ink2 }]}>
        Run `npm run pair` in the Courier agent folder on your PC, then enter
        what it shows here.
      </Text>

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
        <ClayButton label="Pair" tone="accent" onPress={handlePair} busy={busy} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "800", marginBottom: 8 },
  subtitle: { fontSize: 13, lineHeight: 19, marginBottom: 22 },
  label: { fontSize: 12, fontWeight: "700", marginBottom: 6, marginTop: 14 },
  error: { fontSize: 12.5, fontWeight: "700", marginTop: 16 },
  buttonWrap: { marginTop: 22 },
});
