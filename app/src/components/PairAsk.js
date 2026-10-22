import { View, Text } from "react-native";
import { useTheme, useThemedStyles } from "../theme/ThemeContext";
import { raised, display } from "../theme/clay";
import { ClayButton } from "./Clay";
import { BottomSheet } from "./Sheets";
import { PcIcon, PhoneIcon } from "./icons";

/**
 * Another PC or phone asked to pair with this phone: it shows a 4-digit
 * code, this shows the same one, and the person allows it only when they
 * match. `ask` is { requestId, code, name, kind }.
 */
export default function PairAsk({ ask, onAnswer }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (!ask) return null;
  const Icon = ask.kind === "phone" ? PhoneIcon : PcIcon;
  return (
    <BottomSheet visible onClose={() => onAnswer(false)}>
      <View style={styles.head}>
        <View style={[styles.icon, raised(theme, 0.6)]}>
          <Icon size={22} color={theme.dusk} strokeWidth={1.9} />
        </View>
        <Text style={[styles.title, display(theme), { color: theme.ink }]} numberOfLines={2}>{ask.name} wants to pair</Text>
      </View>
      <Text style={[styles.meta, { color: theme.ink2 }]}>{ask.kind === "phone" ? "That phone" : "That PC"} shows this code:</Text>
      <View style={styles.code}>
        {String(ask.code).split("").map((d, i) => (
          <View key={i} style={[styles.digit, raised(theme, 0.7)]}>
            <Text style={[styles.digitText, display(theme), { color: theme.ink }]}>{d}</Text>
          </View>
        ))}
      </View>
      <Text style={[styles.meta, { color: theme.ink2 }]}>
        Only allow it if {ask.name} shows the same code. Then it can send to this phone, and you to it.
      </Text>
      <View style={styles.acts}>
        <ClayButton label="Deny" onPress={() => onAnswer(false)} style={{ flex: 1 }} />
        <ClayButton label="Allow" tone="accent" onPress={() => onAnswer(true)} style={{ flex: 1 }} />
      </View>
    </BottomSheet>
  );
}

const makeStyles = (c) => ({
  head: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  icon: { width: 44, height: 44, borderRadius: c(14), alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 19, fontWeight: "800" },
  meta: { fontSize: 13, fontWeight: "600", lineHeight: 19 },
  code: { flexDirection: "row", gap: 10, justifyContent: "center", marginVertical: 16 },
  digit: { width: 52, height: 64, borderRadius: c(14), alignItems: "center", justifyContent: "center" },
  digitText: { fontSize: 32, fontWeight: "800" },
  acts: { flexDirection: "row", gap: 10, marginTop: 18 },
});
