import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useTheme, useThemedStyles } from "../theme/ThemeContext";
import { raised, sunken, filled, display } from "../theme/clay";
import { ClayButton, IconButton, CategoryTile } from "../components/Clay";
import { CATEGORY_ICONS, GearIcon, SignalIcon, CheckIcon, RefreshIcon } from "../components/icons";
import UpdateBanner from "../components/UpdateBanner";
import { pingHealth, listFiles, deleteFile, fileDownloadUrl, ApiError } from "../lib/api";
import { getHistory, addHistoryEntry } from "../lib/history";
import { uploadFile, formatBytes } from "../lib/upload";

const CATEGORIES = [
  { key: "file", label: "File" },
  { key: "media", label: "Media" },
  { key: "text", label: "Text" },
  { key: "app", label: "App" },
];

/** Section labels: the look's display face and letter spacing. */
function label(theme) {
  return theme.fontDisplay ? { fontFamily: theme.fontDisplay, fontWeight: "normal", fontSize: 12, letterSpacing: theme.labelSpacing } : null;
}

function relativeTime(at) {
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function HomeScreen({ devices, activeDevice, onSwitchDevice, onAddDevice, onNavigate }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [tab, setTab] = useState("send");
  const [history, setHistory] = useState([]);
  const [online, setOnline] = useState({});
  const [files, setFiles] = useState(null);
  const [filesError, setFilesError] = useState(null);
  const [busyFile, setBusyFile] = useState(null);
  const [savedFiles, setSavedFiles] = useState({});
  const [resendingAt, setResendingAt] = useState(null);

  useEffect(() => {
    getHistory().then(setHistory);
  }, []);

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

  useEffect(() => {
    if (tab === "receive") loadFiles();
  }, [tab, activeDevice.id]);

  async function loadFiles() {
    setFilesError(null);
    try {
      const list = await listFiles(activeDevice);
      setFiles(list);
    } catch (err) {
      setFilesError(err instanceof ApiError ? err.message : "Could not reach this Stop.");
      setFiles([]);
    }
  }

  async function handleSave(file) {
    setBusyFile(file.name);
    try {
      const localUri = FileSystem.cacheDirectory + file.name;
      await FileSystem.downloadAsync(fileDownloadUrl(activeDevice, file.name), localUri);
      setSavedFiles((current) => ({ ...current, [file.name]: true }));
      await addHistoryEntry({
        name: file.name,
        size: file.size,
        category: "file",
        direction: "received",
        hostname: activeDevice.hostname || activeDevice.ip,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(localUri);
      } else {
        Alert.alert("Courier", `Saved to ${localUri}`);
      }
    } catch (err) {
      Alert.alert("Courier", err instanceof ApiError ? err.message : "Could not save that file.");
    } finally {
      setBusyFile(null);
    }
  }

  async function handleRemove(file) {
    setBusyFile(file.name);
    try {
      await deleteFile(activeDevice, file.name);
      setFiles((current) => current.filter((f) => f.name !== file.name));
    } catch (err) {
      Alert.alert("Courier", err instanceof ApiError ? err.message : "Could not remove that file.");
    } finally {
      setBusyFile(null);
    }
  }

  async function handleResend(entry) {
    if (!entry.uri) {
      Alert.alert("Courier", "Can't resend that — the original file isn't around anymore.");
      return;
    }
    setResendingAt(entry.at);
    const asset = { uri: entry.uri, name: entry.name, mimeType: entry.mimeType, size: entry.size };
    try {
      let { promise } = uploadFile(activeDevice, asset, {});
      let result = await promise;
      if (result.duplicate) {
        ({ promise } = uploadFile(activeDevice, asset, { onDuplicate: "rename" }));
        result = await promise;
      }
      await addHistoryEntry({
        name: result.name || entry.name,
        size: result.size || entry.size,
        category: entry.category,
        direction: "sent",
        hostname: activeDevice.hostname || activeDevice.ip,
        uri: entry.uri,
        mimeType: entry.mimeType,
      });
      setHistory(await getHistory());
    } catch (err) {
      Alert.alert(
        "Courier",
        err?.message || "Couldn't resend — the original file isn't available anymore."
      );
    } finally {
      setResendingAt(null);
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.ground }]} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={[styles.brandMark, filled(theme, theme.dusk, theme.duskDeep)]}>
            <Text style={[styles.brandMarkText, display(theme), { color: theme.onFill }]}>C</Text>
          </View>
          <Text style={[styles.brandName, display(theme), { color: theme.ink }]}>Courier</Text>
        </View>
        <IconButton accessibilityLabel="Settings" onPress={() => onNavigate("settings")}>
          <GearIcon size={18} color={theme.ink2} strokeWidth={1.8} />
        </IconButton>
      </View>

      <UpdateBanner />

      <Text style={[styles.sectionLabel, label(theme), { color: theme.ink3 }]}>Your stops</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.deviceScroll}
        contentContainerStyle={styles.deviceRow}
      >
        {devices.map((d) => {
          const isActive = d.id === activeDevice.id;
          const isOnline = online[d.id];
          return (
            <Pressable
              key={d.id}
              onPress={() => onSwitchDevice(d.id)}
              style={[
                styles.deviceChip,
                isActive ? [filled(theme, theme.dusk, theme.duskDeep)] : raised(theme, 0.8),
              ]}
            >
              <View
                style={[
                  styles.deviceDot,
                  { backgroundColor: isOnline == null ? theme.ink3 : isOnline ? theme.moss : theme.danger },
                ]}
              />
              <Text
                style={[styles.deviceChipText, { color: isActive ? theme.onFill : theme.ink }]}
                numberOfLines={1}
              >
                {d.hostname}
              </Text>
            </Pressable>
          );
        })}
        <Pressable onPress={onAddDevice} style={[styles.deviceChip, sunken(theme, 0.7)]}>
          <Text style={[styles.deviceChipText, { color: theme.ink2 }]}>+ Add a stop</Text>
        </Pressable>
      </ScrollView>

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
          <Text style={[styles.sectionLabel, label(theme), { color: theme.ink3 }]}>Choose what to send</Text>
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

          <Text style={[styles.sectionLabel, label(theme), { color: theme.ink3, marginTop: 22 }]}>Recent</Text>
          {history.length === 0 ? (
            <View style={[styles.emptyCard, raised(theme, 0.8)]}>
              <Text style={[styles.emptyText, { color: theme.ink3 }]}>Nothing sent yet</Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.recentScroll}
              contentContainerStyle={styles.recentRow}
            >
              {history.slice(0, 8).map((entry, i) => {
                const { Icon, color } = CATEGORY_ICONS[entry.category] || CATEGORY_ICONS.file;
                const canResend = entry.direction === "sent" && entry.uri;
                const resending = resendingAt === entry.at;
                return (
                  <View key={i} style={[styles.recentChip, raised(theme, 0.8)]}>
                    <View style={styles.recentTopRow}>
                      <View style={[styles.recentIcon, { backgroundColor: color }]}>
                        <Icon size={14} color="#FFFFFF" strokeWidth={1.8} />
                      </View>
                      {canResend && (
                        <Pressable
                          onPress={() => handleResend(entry)}
                          disabled={resending}
                          hitSlop={8}
                          accessibilityLabel={`Resend ${entry.name}`}
                        >
                          {resending ? (
                            <ActivityIndicator size="small" color={theme.ink3} />
                          ) : (
                            <RefreshIcon size={14} color={theme.ink3} strokeWidth={2} />
                          )}
                        </Pressable>
                      )}
                    </View>
                    <Text style={[styles.recentName, { color: theme.ink }]} numberOfLines={1}>
                      {entry.name}
                    </Text>
                    <Text style={[styles.recentMeta, { color: theme.ink3 }]} numberOfLines={1}>
                      {formatBytes(entry.size || 0)} · {relativeTime(entry.at)}
                    </Text>
                    {entry.hostname && (
                      <Text style={[styles.recentTarget, { color: theme.ink3 }]} numberOfLines={1}>
                        {entry.direction === "received" ? "←" : "→"} {entry.hostname}
                      </Text>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </>
      ) : (
        <View style={styles.receivePane}>
          {files === null ? (
            <>
              <View style={[styles.radarCore, filled(theme, theme.dusk, theme.duskDeep)]}>
                <SignalIcon size={24} color={theme.onFill} strokeWidth={1.8} />
              </View>
              <Text style={[styles.receiveTitle, { color: theme.ink }]}>Checking {activeDevice.hostname}…</Text>
            </>
          ) : filesError ? (
            <>
              <Text style={[styles.receiveTitle, { color: theme.ink }]}>Can't reach this stop</Text>
              <Text style={[styles.receiveSub, { color: theme.ink2 }]}>{filesError}</Text>
              <View style={{ marginTop: 16, width: "100%" }}>
                <ClayButton label="Try again" onPress={loadFiles} />
              </View>
            </>
          ) : files.length === 0 ? (
            <>
              <View style={[styles.radarCore, filled(theme, theme.dusk, theme.duskDeep)]}>
                <SignalIcon size={24} color={theme.onFill} strokeWidth={1.8} />
              </View>
              <Text style={[styles.receiveTitle, { color: theme.ink }]}>Nothing waiting here</Text>
              <Text style={[styles.receiveSub, { color: theme.ink2 }]}>
                Files sent to {activeDevice.hostname} from any other stop will show up here.
              </Text>
            </>
          ) : (
            <ScrollView style={{ width: "100%" }} contentContainerStyle={{ gap: 10 }}>
              {files.map((file) => (
                <View key={file.name} style={[styles.fileRow, raised(theme, 0.8)]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.fileName, { color: theme.ink }]} numberOfLines={1}>
                      {file.name}
                    </Text>
                    <Text style={[styles.fileMeta, { color: theme.ink3 }]}>
                      {formatBytes(file.size)} · {relativeTime(file.mtime)}
                    </Text>
                  </View>
                  {savedFiles[file.name] ? (
                    <View style={[styles.checkDot, { backgroundColor: theme.moss }]}>
                      <CheckIcon size={11} color="#FFFFFF" strokeWidth={3} />
                    </View>
                  ) : (
                    <View style={styles.fileActions}>
                      <ClayButton
                        label="Save"
                        tone="accent"
                        busy={busyFile === file.name}
                        onPress={() => handleSave(file)}
                        style={styles.fileBtn}
                      />
                      <ClayButton
                        label="Remove"
                        busy={busyFile === file.name}
                        onPress={() => handleRemove(file)}
                        style={styles.fileBtn}
                      />
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}

    </SafeAreaView>
  );
}

const makeStyles = (c) => ({
  container: { flex: 1, paddingHorizontal: 22, paddingTop: 12 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandMark: { width: 34, height: 34, borderRadius: c(11), alignItems: "center", justifyContent: "center" },
  brandMarkText: { fontWeight: "900", fontSize: 15 },
  brandName: { fontWeight: "800", fontSize: 19 },

  deviceScroll: { flexGrow: 0, marginBottom: 18 },
  deviceRow: { gap: 8, alignItems: "center" },
  deviceChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: c(999),
    maxWidth: 160,
  },
  deviceDot: { width: 7, height: 7, borderRadius: c(4) },
  deviceChipText: { fontWeight: "800", fontSize: 12.5 },

  tabs: { flexDirection: "row", gap: 4, padding: 4, borderRadius: c(16), marginBottom: 18 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: c(12), alignItems: "center" },
  tabLabel: { fontWeight: "800", fontSize: 13 },

  sectionLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },

  emptyCard: { borderRadius: c(16), paddingVertical: 22, alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: 12.5, fontWeight: "700" },

  recentScroll: { flexGrow: 0 },
  recentRow: { gap: 10, paddingRight: 4, alignItems: "center" },
  recentChip: { width: 118, borderRadius: c(16), padding: 10, alignSelf: "flex-start" },
  recentTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  recentIcon: { width: 28, height: 28, borderRadius: c(9), alignItems: "center", justifyContent: "center" },
  recentName: { fontSize: 11.5, fontWeight: "800" },
  recentMeta: { fontSize: 10, fontWeight: "600", marginTop: 2 },
  recentTarget: { fontSize: 9.5, fontWeight: "600", marginTop: 1 },

  receivePane: { flex: 1, alignItems: "center", paddingHorizontal: 0 },
  radarCore: { width: 64, height: 64, borderRadius: c(32), alignItems: "center", justifyContent: "center", marginBottom: 18, marginTop: 30 },
  receiveTitle: { fontWeight: "800", fontSize: 15, marginBottom: 6, textAlign: "center" },
  receiveSub: { fontSize: 12.5, lineHeight: 18, textAlign: "center" },

  fileRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: c(16), padding: 12 },
  fileName: { fontWeight: "800", fontSize: 12.5 },
  fileMeta: { fontSize: 10.5, fontWeight: "600", marginTop: 2 },
  fileActions: { flexDirection: "row", gap: 6 },
  fileBtn: { width: 78, paddingVertical: 9 },
  checkDot: { width: 22, height: 22, borderRadius: c(11), alignItems: "center", justifyContent: "center" },


});
