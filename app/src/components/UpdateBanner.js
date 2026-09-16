import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Linking } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { RADIUS, raised, filled } from "../theme/clay";
import { checkForUpdate } from "../lib/updates";

/** Checks GitHub once on mount. The repo is public, so this needs no token
 * and no sign-in. Stays quiet on failure — Settings is where you go to find
 * out why, this is just the passive nudge when there's good news. */
export default function UpdateBanner() {
  const { theme } = useTheme();
  const [update, setUpdate] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    checkForUpdate().then((found) => {
      if (!cancelled) setUpdate(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update || dismissed) return null;

  return (
    <View style={[styles.banner, raised(theme, 0.7)]}>
      <View style={styles.text}>
        <Text style={[styles.title, { color: theme.ink }]}>Courier {update.version} is out</Text>
        <Text style={[styles.subtitle, { color: theme.ink3 }]}>Installs over this one, keeps your stops</Text>
      </View>
      <Pressable
        style={[styles.action, filled(theme, theme.dusk, theme.duskDeep)]}
        onPress={() => Linking.openURL(update.downloadUrl)}
        accessibilityRole="button"
      >
        <Text style={[styles.actionText, { color: theme.onFill }]}>Get it</Text>
      </Pressable>
      <Pressable onPress={() => setDismissed(true)} hitSlop={12} accessibilityLabel="Dismiss">
        <Text style={[styles.dismiss, { color: theme.ink3 }]}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: RADIUS.field,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  text: { flex: 1, minWidth: 0 },
  title: { fontWeight: "800", fontSize: 13 },
  subtitle: { fontSize: 10.5, marginTop: 2, fontWeight: "600" },
  action: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 },
  actionText: { fontWeight: "800", fontSize: 12.5 },
  dismiss: { fontSize: 15, paddingHorizontal: 2 },
});
