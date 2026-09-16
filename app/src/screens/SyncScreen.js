import { useState } from "react";
import { View, Text, StyleSheet, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { useTheme } from "../theme/ThemeContext";
import { ClayField, ClayButton, IconButton } from "../components/Clay";
import { BackIcon } from "../components/icons";
import { getClipboard, setClipboard, ApiError } from "../lib/api";

export default function SyncScreen({ pairing, onBack }) {
  const { theme } = useTheme();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  function showError(err) {
    Alert.alert("Courier", err instanceof ApiError ? err.message : String(err));
  }

  async function sendToPc() {
    setBusy(true);
    try {
      const clip = await Clipboard.getStringAsync();
      await setClipboard(pairing, clip);
      setText(clip);
      Alert.alert("Courier", "Sent your clipboard to the PC.");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  async function getFromPc() {
    setBusy(true);
    try {
      const remote = await getClipboard(pairing);
      await Clipboard.setStringAsync(remote);
      setText(remote);
      Alert.alert("Courier", "PC's clipboard copied to your phone.");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  async function sendTyped() {
    setBusy(true);
    try {
      await setClipboard(pairing, text);
      Alert.alert("Courier", "Sent to the PC's clipboard.");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.ground }]} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <IconButton accessibilityLabel="Back" onPress={onBack}>
          <BackIcon size={17} color={theme.ink} strokeWidth={2.2} />
        </IconButton>
        <View>
          <Text style={[styles.title, { color: theme.ink }]}>Text</Text>
          <Text style={[styles.subtitle, { color: theme.ink3 }]}>
            {pairing.ip}:{pairing.port}
          </Text>
        </View>
      </View>

      <View style={styles.fieldWrap}>
        <ClayField
          multiline
          placeholder="Type or paste text here..."
          value={text}
          onChangeText={setText}
        />
      </View>

      <View style={styles.actions}>
        <ClayButton label="Send phone clipboard → PC" tone="accent" onPress={sendToPc} busy={busy} />
        <ClayButton label="Get PC clipboard → phone" tone="accent" onPress={getFromPc} busy={busy} />
        <ClayButton label="Send text above → PC" onPress={sendTyped} busy={busy} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 22, paddingTop: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
  title: { fontWeight: "800", fontSize: 17 },
  subtitle: { fontSize: 11, fontWeight: "600", marginTop: 1 },
  fieldWrap: { marginBottom: 14 },
  actions: { gap: 10 },
});
