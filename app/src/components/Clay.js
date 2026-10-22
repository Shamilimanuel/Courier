import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { raised, sunken, pressed, filled, RADIUS } from "../theme/clay";

/** A raised or sunken block — the base every other clay element sits on. */
export function Surface({ style, children, inset, scale }) {
  const { theme } = useTheme();
  return <View style={[inset ? sunken(theme, scale) : raised(theme, scale), style]}>{children}</View>;
}

/** A full-width button — Pair, Send, Unpair. */
export function ClayButton({ label, onPress, tone = "plain", busy, disabled, style }) {
  const { theme } = useTheme();
  const [down, setDown] = useState(false);

  const base =
    tone === "accent"
      ? filled(theme, theme.dusk, theme.duskDeep)
      : tone === "danger"
      ? filled(theme, theme.danger, "rgba(0,0,0,0.25)")
      : tone === "quiet"
      ? sunken(theme)
      : raised(theme);

  const colour =
    tone === "accent" || tone === "danger" ? theme.onFill : tone === "quiet" ? theme.ink2 : theme.ink;

  return (
    <Pressable
      style={[styles.button, base, down && pressed(theme), disabled && styles.disabled, style]}
      onPressIn={() => setDown(true)}
      onPressOut={() => setDown(false)}
      onPress={onPress}
      disabled={busy || disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? (
        <ActivityIndicator color={colour} />
      ) : (
        <Text style={[styles.buttonLabel, { color: colour }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/** A small square icon button — settings, back. */
export function IconButton({ children, onPress, style, accessibilityLabel }) {
  const { theme } = useTheme();
  const [down, setDown] = useState(false);
  return (
    <Pressable
      style={[styles.iconButton, raised(theme, 0.7), down && pressed(theme), style]}
      onPressIn={() => setDown(true)}
      onPressOut={() => setDown(false)}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </Pressable>
  );
}

/** A sunken text field. */
export function ClayField({ style, multiline, ...props }) {
  const { theme } = useTheme();
  return (
    <TextInput
      style={[
        styles.field,
        sunken(theme),
        { color: theme.ink, borderRadius: RADIUS.field },
        multiline && styles.fieldMultiline,
        style,
      ]}
      placeholderTextColor={theme.ink3}
      multiline={multiline}
      {...props}
    />
  );
}

/** A small sunken pill with a status dot — "Connected to X". */
export function StatusPill({ label, tone = "ok" }) {
  const { theme } = useTheme();
  const dotColour = tone === "ok" ? theme.moss : theme.danger;
  return (
    <View style={[styles.statusPill, sunken(theme, 0.6)]}>
      <View style={[styles.statusDot, { backgroundColor: dotColour }]} />
      <Text style={[styles.statusLabel, { color: theme.ink2 }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** One tile in the Send category grid. */
export function CategoryTile({ label, Icon, color, onPress }) {
  const { theme } = useTheme();
  const [down, setDown] = useState(false);
  return (
    <Pressable
      style={[styles.catTile, raised(theme), down && pressed(theme)]}
      onPressIn={() => setDown(true)}
      onPressOut={() => setDown(false)}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.catIcon, { backgroundColor: color }]}>
        <Icon size={22} color="#FFFFFF" strokeWidth={1.8} />
      </View>
      <Text style={[styles.catLabel, { color: theme.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: RADIUS.field,
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonLabel: { fontWeight: "800", fontSize: 14.5 },
  disabled: { opacity: 0.45 },

  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },

  field: {
    width: "100%",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: "600",
  },
  fieldMultiline: { minHeight: 100, textAlignVertical: "top" },

  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: RADIUS.pill,
    marginTop: 3,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusLabel: { fontSize: 10.5, fontWeight: "700" },

  catTile: {
    flex: 1,
    aspectRatio: 1.05,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  catIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  catLabel: { fontWeight: "800", fontSize: 13 },
});
