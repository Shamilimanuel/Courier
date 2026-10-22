import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme, useThemedStyles } from "../theme/ThemeContext";
import { THEMES, THEME_ORDER, raised, sunken, display } from "../theme/clay";
import { ClayButton, IconButton } from "../components/Clay";
import { BackIcon } from "../components/icons";
import { removeDevice } from "../lib/pairing";
import { pingHealth } from "../lib/api";
import { checkForUpdateDetailed, installedVersionLabel } from "../lib/updates";

/**
 * Laid out like Reveille's settings: the looks as a grid of chips, then
 * groups of rows. Removing a stop asks once, inside the row, instead of a
 * dialog.
 */
export default function SettingsScreen({ devices, onDevicesChanged, onBack }) {
  const { theme, themeName, setThemeName } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [online, setOnline] = useState({});
  const [confirmId, setConfirmId] = useState(null);
  const [updateState, setUpdateState] = useState("idle");
  const [updateResult, setUpdateResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    devices.forEach((d) => {
      pingHealth(d).then((ok) => {
        if (!cancelled) setOnline((current) => ({ ...current, [d.id]: ok }));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [devices]);

  async function handleRemove(id) {
    setConfirmId(null);
    const remaining = await removeDevice(id);
    onDevicesChanged(remaining);
  }

  async function handleCheckUpdate() {
    setUpdateState("checking");
    setUpdateResult(null);
    setUpdateResult(await checkForUpdateDetailed());
    setUpdateState("idle");
  }

  const labelStyle = [styles.label, theme.fontDisplay && { fontFamily: theme.fontDisplay, fontWeight: "normal", fontSize: 12, letterSpacing: theme.labelSpacing }, { color: theme.ink3 }];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.ground }]} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <IconButton accessibilityLabel="Back" onPress={onBack}>
          <BackIcon size={17} color={theme.ink2} strokeWidth={2} />
        </IconButton>
        <Text style={[styles.title, display(theme), { color: theme.ink }]}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={labelStyle}>Look</Text>
        <View style={styles.themeGrid}>
          {THEME_ORDER.map((name) => {
            const t = THEMES[name];
            const selected = themeName === name;
            return (
              <Pressable
                key={name}
                onPress={() => setThemeName(name)}
                style={[styles.themeChip, raised(theme, 0.7), selected && { borderWidth: 2.5, borderColor: theme.dusk }]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Look: ${t.label}`}
              >
                <View style={styles.swatch}>
                  <View style={[styles.swatchHalf, { backgroundColor: t.ground }]} />
                  <View style={[styles.swatchHalf, { backgroundColor: t.dusk }]} />
                </View>
                <Text style={[styles.themeName, { color: selected ? theme.ink : theme.ink2 }]} numberOfLines={2}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={labelStyle}>Your stops</Text>
        {devices.map((d) => {
          const isOnline = online[d.id];
          const asking = confirmId === d.id;
          return (
            <View key={d.id} style={[styles.row, sunken(theme, 0.8)]}>
              <View style={[styles.dot, { backgroundColor: isOnline == null ? theme.ink3 : isOnline ? theme.moss : theme.danger }]} />
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: theme.ink }]} numberOfLines={1}>{d.hostname || d.ip}</Text>
                <Text style={[styles.rowHint, { color: theme.ink3 }]} numberOfLines={1}>
                  {asking ? "Remove this stop from the phone?" : `${d.ip}:${d.port} · ${isOnline == null ? "checking…" : isOnline ? "on this Wi-Fi" : "not reachable"}`}
                </Text>
              </View>
              {asking ? (
                <View style={styles.askRow}>
                  <Pressable onPress={() => setConfirmId(null)} hitSlop={8}>
                    <Text style={[styles.rowAction, { color: theme.ink2 }]}>Keep</Text>
                  </Pressable>
                  <Pressable onPress={() => handleRemove(d.id)} hitSlop={8}>
                    <Text style={[styles.rowAction, { color: theme.danger }]}>Remove</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setConfirmId(d.id)} hitSlop={8} accessibilityLabel={`Remove ${d.hostname}`}>
                  <Text style={[styles.rowAction, { color: theme.danger }]}>Remove</Text>
                </Pressable>
              )}
            </View>
          );
        })}

        <Text style={labelStyle}>About</Text>
        <View style={[styles.about, sunken(theme, 0.8)]}>
          <Text style={[styles.rowTitle, { color: theme.ink }]}>Courier {installedVersionLabel()}</Text>
          <Text
            style={[
              styles.rowHint,
              {
                color: !updateResult
                  ? theme.ink3
                  : updateResult.state === "available"
                  ? theme.dusk
                  : updateResult.state === "error"
                  ? theme.danger
                  : theme.moss,
              },
            ]}
          >
            {!updateResult
              ? "Also checks itself when you open Courier"
              : updateResult.state === "current"
              ? "You're up to date"
              : updateResult.state === "available"
              ? `${updateResult.info.version} is available`
              : updateResult.reason}
          </Text>
          <ClayButton
            label={updateState === "checking" ? "Checking…" : "Check for updates"}
            busy={updateState === "checking"}
            onPress={handleCheckUpdate}
            style={{ marginTop: 12 }}
          />
          {updateResult?.state === "available" && (
            <ClayButton
              label={`Download ${updateResult.info.version}`}
              tone="accent"
              onPress={() => Linking.openURL(updateResult.info.downloadUrl)}
              style={{ marginTop: 8 }}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c) => ({
  container: { flex: 1, paddingHorizontal: 22, paddingTop: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 18 },
  title: { fontSize: 22, fontWeight: "800" },
  scroll: { paddingBottom: 30 },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10, marginTop: 6 },

  themeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  themeChip: { width: "31%", flexGrow: 1, borderRadius: c(18), paddingVertical: 12, paddingHorizontal: 4, alignItems: "center", gap: 8, borderWidth: 2.5, borderColor: "transparent" },
  swatch: { width: 30, height: 30, borderRadius: 15, overflow: "hidden", flexDirection: "row", transform: [{ rotate: "45deg" }] },
  swatchHalf: { flex: 1 },
  themeName: { fontSize: 11.5, fontWeight: "800", textAlign: "center" },

  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: c(16), paddingVertical: 12, paddingHorizontal: 14, marginBottom: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, fontWeight: "800" },
  rowHint: { fontSize: 11.5, fontWeight: "600", marginTop: 2 },
  rowAction: { fontSize: 12.5, fontWeight: "800" },
  askRow: { flexDirection: "row", gap: 16 },

  about: { borderRadius: c(16), padding: 14, marginBottom: 10 },
});
