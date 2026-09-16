import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { raised, filled, RADIUS } from "../theme/clay";
import { ClayButton, IconButton, StatusPill, CategoryTile } from "../components/Clay";
import { CATEGORY_ICONS, KebabIcon, SignalIcon } from "../components/icons";
import { clearPairing } from "../lib/pairing";
import { getHistory } from "../lib/history";
import { formatBytes } from "../lib/upload";

const CATEGORIES = [
  { key: "file", label: "File" },
  { key: "media", label: "Media" },
  { key: "text", label: "Text" },
  { key: "app", label: "App" },
];

function relativeTime(at) {
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function HomeScreen({ pairing, onNavigate, onUnpair }) {
  const { theme } = useTheme();
  const [tab, setTab] = useState("send");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    getHistory().then(setHistory);
  }, []);

  async function handleUnpair() {
    setConfirmOpen(false);
    await clearPairing();
    onUnpair();
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.ground }]}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={[styles.brandMark, filled(theme, theme.dusk, theme.duskDeep)]}>
            <Text style={[styles.brandMarkText, { color: theme.onFill }]}>C</Text>
          </View>
          <View>
            <Text style={[styles.brandName, { color: theme.ink }]}>Courier</Text>
            <StatusPill label={pairing.hostname || pairing.ip} />
          </View>
        </View>
        <IconButton accessibilityLabel="Settings" onPress={() => setConfirmOpen(true)}>
          <KebabIcon size={17} color={theme.ink2} strokeWidth={1.8} />
        </IconButton>
      </View>

      <View style={[styles.tabs, { backgroundColor: theme.clayLo }]}>
        <Pressable
          style={[styles.tab, tab === "send" && [raised(theme, 0.7), { backgroundColor: theme.clayHi }]]}
          onPress={() => setTab("send")}
        >
          <Text style={[styles.tabLabel, { color: tab === "send" ? theme.ink : theme.ink3 }]}>Send</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === "receive" && [raised(theme, 0.7), { backgroundColor: theme.clayHi }]]}
          onPress={() => setTab("receive")}
        >
          <Text style={[styles.tabLabel, { color: tab === "receive" ? theme.ink : theme.ink3 }]}>Receive</Text>
        </Pressable>
      </View>

      {tab === "send" ? (
        <>
          <Text style={[styles.sectionLabel, { color: theme.ink3 }]}>Choose what to send</Text>
          <View style={styles.grid}>
            {CATEGORIES.map((cat) => {
              const { Icon, color } = CATEGORY_ICONS[cat.key];
              return (
                <CategoryTile
                  key={cat.key}
                  label={cat.label}
                  Icon={Icon}
                  color={color}
                  onPress={() => onNavigate(cat.key === "text" ? "text" : "transfer", cat.key)}
                />
              );
            })}
          </View>

          <Text style={[styles.sectionLabel, { color: theme.ink3, marginTop: 22 }]}>Recent</Text>
          {history.length === 0 ? (
            <View style={[styles.emptyCard, raised(theme, 0.8)]}>
              <Text style={[styles.emptyText, { color: theme.ink3 }]}>Nothing sent yet</Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
              {history.slice(0, 8).map((entry, i) => {
                const { Icon, color } = CATEGORY_ICONS[entry.category] || CATEGORY_ICONS.file;
                return (
                  <View key={i} style={[styles.recentChip, raised(theme, 0.8)]}>
                    <View style={[styles.recentIcon, { backgroundColor: color }]}>
                      <Icon size={14} color="#FFFFFF" strokeWidth={1.8} />
                    </View>
                    <Text style={[styles.recentName, { color: theme.ink }]} numberOfLines={1}>
                      {entry.name}
                    </Text>
                    <Text style={[styles.recentMeta, { color: theme.ink3 }]}>
                      {formatBytes(entry.size || 0)} · {relativeTime(entry.at)}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </>
      ) : (
        <View style={styles.receivePane}>
          <View style={[styles.radarCore, filled(theme, theme.dusk, theme.duskDeep)]}>
            <SignalIcon size={24} color={theme.onFill} strokeWidth={1.8} />
          </View>
          <Text style={[styles.receiveTitle, { color: theme.ink }]}>Receiving isn't built yet</Text>
          <Text style={[styles.receiveSub, { color: theme.ink2 }]}>
            Text sync works both ways already. File and media receiving is next
            on the list.
          </Text>
        </View>
      )}

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={styles.veil}>
          <View style={[styles.sheet, { backgroundColor: theme.ground }]}>
            <Text style={[styles.sheetTitle, { color: theme.ink }]}>Unpair</Text>
            <Text style={[styles.sheetSub, { color: theme.ink2 }]}>Forget this PC?</Text>
            <View style={styles.sheetRow}>
              <View style={{ flex: 1 }}>
                <ClayButton label="Cancel" onPress={() => setConfirmOpen(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <ClayButton label="Unpair" tone="danger" onPress={handleUnpair} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 22, paddingTop: 56 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandMark: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  brandMarkText: { fontWeight: "900", fontSize: 15 },
  brandName: { fontWeight: "800", fontSize: 17 },

  tabs: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 16, marginBottom: 18 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 12, alignItems: "center" },
  tabLabel: { fontWeight: "800", fontSize: 13 },

  sectionLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },

  emptyCard: { borderRadius: 16, paddingVertical: 22, alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: 12.5, fontWeight: "700" },

  recentRow: { gap: 10, paddingRight: 4 },
  recentChip: { width: 118, borderRadius: 16, padding: 10 },
  recentIcon: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  recentName: { fontSize: 11.5, fontWeight: "800" },
  recentMeta: { fontSize: 10, fontWeight: "600", marginTop: 2 },

  receivePane: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  radarCore: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  receiveTitle: { fontWeight: "800", fontSize: 15, marginBottom: 6, textAlign: "center" },
  receiveSub: { fontSize: 12.5, lineHeight: 18, textAlign: "center" },

  veil: { flex: 1, backgroundColor: "rgba(20,14,30,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, padding: 22, paddingBottom: 34 },
  sheetTitle: { fontSize: 16, fontWeight: "800", marginBottom: 6 },
  sheetSub: { fontSize: 13, marginBottom: 18 },
  sheetRow: { flexDirection: "row", gap: 10 },
});
