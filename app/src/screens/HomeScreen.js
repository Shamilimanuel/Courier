import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import * as Clipboard from "expo-clipboard";
import { useTheme, useThemedStyles } from "../theme/ThemeContext";
import { raised, sunken, pressed, filled, display } from "../theme/clay";
import { ClayButton, IconButton } from "../components/Clay";
import {
  GearIcon, PlaneIcon, PhotoIcon, FileIcon, ClipboardIcon, TextIcon, CATEGORY_ICONS,
  DownloadIcon, TrashIcon, CheckIcon, PcIcon, SignalIcon, PhoneIcon, CopyIcon,
} from "../components/icons";
import UpdateBanner from "../components/UpdateBanner";
import { SendSheet, ClipboardSheet, TextSheet } from "../components/Sheets";
import { pingHealth, listFiles, deleteFile, fileDownloadUrl, ApiError } from "../lib/api";
import { getHistory, addHistoryEntry } from "../lib/history";
import { formatBytes } from "../lib/upload";
import { Stop, onStop } from "../lib/stop";

/**
 * Home, laid out like the prototype (docs/app.html): your stops as chips,
 * Send with four tiles and a Recent list, Receive with what arrived on this
 * phone and what waits on the stop. Sending, the clipboard and text slide up
 * as panels over it instead of opening screens of their own.
 */

const TILES = [
  { key: "photos", label: "Photos", hint: "From your gallery", Icon: PhotoIcon },
  { key: "files", label: "Files", hint: "Any file", Icon: FileIcon },
  { key: "clip", label: "Clipboard", hint: "Both ways", Icon: ClipboardIcon },
  { key: "text", label: "Text", hint: "Type or paste", Icon: TextIcon },
];

function relativeTime(at) {
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** Section labels: the look's display face and letter spacing. */
function label(theme) {
  return theme.fontDisplay ? { fontFamily: theme.fontDisplay, fontWeight: "normal", fontSize: 12, letterSpacing: theme.labelSpacing } : null;
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
  const [sendJob, setSendJob] = useState(null);
  const [sheet, setSheet] = useState(null); // clip | text
  const [inbox, setInbox] = useState([]);
  const host = activeDevice.hostname || activeDevice.ip;
  const activeOnline = online[activeDevice.id];
  const activeIsPhone = activeDevice.kind === "phone";

  useEffect(() => {
    getHistory().then(setHistory);
  }, []);

  // What PCs and phones sent here (kept by the phone's own stop, so it
  // includes what arrived while Courier was closed).
  function loadInbox() {
    try {
      if (Stop) setInbox(Stop.getInbox());
    } catch {
      // nothing to show
    }
  }
  useEffect(() => {
    loadInbox();
    const offs = [onStop("onFileArrived", loadInbox), onStop("onTextArrived", loadInbox)];
    return () => offs.forEach((off) => off());
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
    if (tab === "receive") {
      loadInbox();
      if (!activeIsPhone) loadFiles();
    }
  }, [tab, activeDevice.id]);

  async function refreshHistory() {
    setHistory(await getHistory());
  }

  async function loadFiles() {
    setFiles(null);
    setFilesError(null);
    try {
      setFiles(await listFiles(activeDevice));
    } catch (err) {
      setFilesError(err instanceof ApiError ? err.message : "Could not reach this stop.");
      setFiles([]);
    }
  }

  async function pickAndSend(kind) {
    const result = await DocumentPicker.getDocumentAsync({
      type: kind === "photos" ? ["image/*", "video/*"] : "*/*",
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;
    setSendJob({
      device: activeDevice,
      category: kind === "photos" ? "media" : "file",
      assets: result.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size })),
    });
  }

  function onTile(key) {
    if (key === "photos" || key === "files") pickAndSend(key);
    else setSheet(key);
  }

  function resend(entry) {
    if (!entry.uri) {
      Alert.alert("Courier", "Can't resend that: the original file isn't around anymore.");
      return;
    }
    setSendJob({
      device: activeDevice,
      category: entry.category || "file",
      assets: [{ uri: entry.uri, name: entry.name, mimeType: entry.mimeType, size: entry.size }],
    });
  }

  async function save(file) {
    setBusyFile(file.name);
    try {
      const localUri = FileSystem.cacheDirectory + file.name;
      await FileSystem.downloadAsync(fileDownloadUrl(activeDevice, file.name), localUri);
      await addHistoryEntry({ name: file.name, size: file.size, category: "file", direction: "received", hostname: host, uri: localUri });
      await refreshHistory();
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(localUri);
      else Alert.alert("Courier", `Saved to ${localUri}`);
    } catch (err) {
      Alert.alert("Courier", err instanceof ApiError ? err.message : "Could not save that file.");
    } finally {
      setBusyFile(null);
    }
  }

  async function remove(file) {
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

  async function openArrival(entry) {
    if (entry.kind !== "file") {
      await Clipboard.setStringAsync(entry.text || "");
      Alert.alert("Courier", "Copied. Paste it anywhere.");
      return;
    }
    const ok = await Stop.openFile(entry.uri, entry.mime || null).catch(() => false);
    if (!ok) Alert.alert("Courier", "No app on this phone opens this kind of file. It's in Downloads › Courier.");
  }

  function forget(entry) {
    Stop?.removeFromInbox(entry.id);
    loadInbox();
  }

  async function open(entry) {
    try {
      if (entry.uri && (await Sharing.isAvailableAsync())) await Sharing.shareAsync(entry.uri);
    } catch {
      Alert.alert("Courier", "That file isn't on this phone anymore.");
    }
  }

  const sent = history.filter((h) => h.direction !== "received").slice(0, 6);
  const arrived = history.filter((h) => h.direction === "received").slice(0, 5);
  const arrivedHere = inbox.slice(0, 10);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.ground }]} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View style={[styles.mark, filled(theme, theme.dusk, theme.duskDeep)]}>
          <PlaneIcon size={19} color={theme.onFill} strokeWidth={2} />
        </View>
        <Text style={[styles.brandName, display(theme), { color: theme.ink }]}>Courier</Text>
        <View style={{ flex: 1 }} />
        <IconButton accessibilityLabel="Settings" onPress={() => onNavigate("settings")}>
          <GearIcon size={18} color={theme.ink2} strokeWidth={1.8} />
        </IconButton>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <UpdateBanner />

        <Text style={[styles.label, label(theme), { color: theme.ink3 }]}>Your stops</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.chips}>
          {devices.map((d) => {
            const on = d.id === activeDevice.id;
            const isOnline = online[d.id];
            return (
              <Pressable
                key={d.id}
                onPress={() => onSwitchDevice(d.id)}
                style={[styles.chip, on ? sunken(theme, 0.7) : raised(theme, 0.6)]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <View style={[styles.dot, { backgroundColor: isOnline == null ? theme.ink3 : isOnline ? theme.moss : theme.danger }]} />
                {d.kind === "phone" ? <PhoneIcon size={14} color={on ? theme.ink : theme.ink2} strokeWidth={2} /> : <PcIcon size={14} color={on ? theme.ink : theme.ink2} strokeWidth={2} />}
                <Text style={[styles.chipText, { color: on ? theme.ink : theme.ink2 }]} numberOfLines={1}>{d.hostname || d.ip}</Text>
              </Pressable>
            );
          })}
          <Pressable onPress={onAddDevice} style={[styles.chip, raised(theme, 0.6)]} accessibilityRole="button">
            <Text style={[styles.chipText, { color: theme.ink2 }]}>+ Add</Text>
          </Pressable>
        </ScrollView>

        <View style={[styles.tabs, { backgroundColor: theme.clayLo }]}>
          {["send", "receive"].map((t) => (
            <Pressable
              key={t}
              style={[styles.tab, tab === t && [raised(theme, 0.5), { backgroundColor: theme.clayHi }]]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabLabel, { color: tab === t ? theme.ink : theme.ink3 }]}>{t === "send" ? "Send" : "Receive"}</Text>
            </Pressable>
          ))}
        </View>

        {tab === "send" ? (
          <>
            <Text style={[styles.label, label(theme), { color: theme.ink3 }]}>Send to {host}</Text>
            <View style={styles.tiles}>
              {TILES.map((t) => (
                <Tile key={t.key} tile={t} onPress={() => onTile(t.key)} disabled={activeOnline === false} />
              ))}
            </View>
            {activeOnline === false && (
              <Text style={[styles.note, { color: theme.danger }]}>{host} isn't reachable right now: it's off, or on another Wi-Fi.</Text>
            )}

            <Text style={[styles.label, label(theme), { color: theme.ink3, marginTop: 20 }]}>Recent</Text>
            {sent.length === 0 ? (
              <Text style={[styles.note, { color: theme.ink3 }]}>Nothing sent yet.</Text>
            ) : (
              sent.map((h, i) => {
                const { Icon } = CATEGORY_ICONS[h.category] || CATEGORY_ICONS.file;
                return (
                  <View key={`${h.at}-${i}`} style={[styles.row, raised(theme, 0.6)]}>
                    <View style={[styles.rowIcon, { backgroundColor: theme.clayLo }]}>
                      <Icon size={17} color={theme.dusk} strokeWidth={1.9} />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={[styles.rowName, { color: theme.ink }]} numberOfLines={1}>{h.name}</Text>
                      <Text style={[styles.rowMeta, { color: theme.ink2 }]} numberOfLines={1}>
                        To {h.hostname} · {relativeTime(h.at)}{h.category !== "text" ? ` · ${formatBytes(h.size || 0)}` : ""}
                      </Text>
                    </View>
                    {h.uri ? <SmallButton label="Resend" onPress={() => resend(h)} /> : null}
                  </View>
                );
              })
            )}
          </>
        ) : (
          <>
            {Stop && (
              <>
                <Text style={[styles.label, label(theme), { color: theme.ink3 }]}>Arrived on this phone</Text>
                {arrivedHere.length === 0 ? (
                  <View style={[styles.empty, raised(theme, 0.6), { marginBottom: 20 }]}>
                    <View style={[styles.emptyIcon, { backgroundColor: theme.clayLo }]}>
                      <SignalIcon size={22} color={theme.dusk} strokeWidth={1.8} />
                    </View>
                    <Text style={[styles.rowName, { color: theme.ink }]}>Nothing yet</Text>
                    <Text style={[styles.rowMeta, { color: theme.ink2, textAlign: "center" }]}>
                      When a PC or phone sends you something, it lands in Downloads › Courier and you get a notification.
                    </Text>
                  </View>
                ) : (
                  arrivedHere.map((h) => (
                    <View key={h.id} style={[styles.row, raised(theme, 0.6)]}>
                      <View style={[styles.rowIcon, { backgroundColor: theme.clayLo }]}>
                        {h.kind === "file" ? <FileIcon size={17} color={theme.dusk} strokeWidth={1.9} /> : <TextIcon size={17} color={theme.dusk} strokeWidth={1.9} />}
                      </View>
                      <View style={styles.rowText}>
                        <Text style={[styles.rowName, { color: theme.ink }]} numberOfLines={1}>{h.kind === "file" ? h.name : h.text}</Text>
                        <Text style={[styles.rowMeta, { color: theme.ink2 }]} numberOfLines={1}>
                          {h.from ? `From ${h.from} · ` : ""}{relativeTime(h.at)}{h.kind === "file" ? ` · ${formatBytes(h.size || 0)}` : h.kind === "clip" ? " · clipboard" : ""}
                        </Text>
                      </View>
                      <SmallButton label={h.kind === "file" ? "Open" : "Copy"} onPress={() => openArrival(h)} />
                      <IconAction label="Remove from this list" onPress={() => forget(h)}>
                        <TrashIcon size={16} color={theme.ink3} strokeWidth={1.9} />
                      </IconAction>
                    </View>
                  ))
                )}
              </>
            )}

            {!Stop && arrived.length > 0 && (
              <>
                <Text style={[styles.label, label(theme), { color: theme.ink3 }]}>Arrived on this phone</Text>
                {arrived.map((h, i) => (
                  <View key={`${h.at}-${i}`} style={[styles.row, raised(theme, 0.6)]}>
                    <View style={[styles.rowIcon, { backgroundColor: theme.clayLo }]}>
                      <FileIcon size={17} color={theme.dusk} strokeWidth={1.9} />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={[styles.rowName, { color: theme.ink }]} numberOfLines={1}>{h.name}</Text>
                      <Text style={[styles.rowMeta, { color: theme.ink2 }]} numberOfLines={1}>From {h.hostname} · {relativeTime(h.at)} · {formatBytes(h.size || 0)}</Text>
                    </View>
                    {h.uri ? <SmallButton label="Open" onPress={() => open(h)} /> : null}
                  </View>
                ))}
              </>
            )}

            {!activeIsPhone && (<>
            <Text style={[styles.label, label(theme), { color: theme.ink3, marginTop: Stop || arrived.length ? 12 : 0 }]}>Waiting on {host}</Text>
            {files === null ? (
              <View style={[styles.empty, raised(theme, 0.6)]}>
                <ActivityIndicator color={theme.ink2} />
                <Text style={[styles.rowMeta, { color: theme.ink2, marginTop: 8 }]}>Checking {host}…</Text>
              </View>
            ) : filesError ? (
              <View style={[styles.empty, raised(theme, 0.6)]}>
                <View style={[styles.emptyIcon, { backgroundColor: theme.clayLo }]}>
                  <PcIcon size={22} color={theme.ink3} strokeWidth={1.8} />
                </View>
                <Text style={[styles.rowName, { color: theme.ink }]}>Can't reach {host}</Text>
                <Text style={[styles.rowMeta, { color: theme.ink2, textAlign: "center" }]}>It's off, or on another Wi-Fi.</Text>
                <ClayButton label="Try again" onPress={loadFiles} style={{ marginTop: 12, alignSelf: "stretch" }} />
              </View>
            ) : files.length === 0 ? (
              <View style={[styles.empty, raised(theme, 0.6)]}>
                <View style={[styles.emptyIcon, { backgroundColor: theme.clayLo }]}>
                  <SignalIcon size={22} color={theme.dusk} strokeWidth={1.8} />
                </View>
                <Text style={[styles.rowName, { color: theme.ink }]}>Nothing waiting</Text>
                <Text style={[styles.rowMeta, { color: theme.ink2, textAlign: "center" }]}>Files left on {host} for this phone show up here.</Text>
              </View>
            ) : (
              files.map((file) => (
                <View key={file.name} style={[styles.row, raised(theme, 0.6)]}>
                  <View style={[styles.rowIcon, { backgroundColor: theme.clayLo }]}>
                    <FileIcon size={17} color={theme.dusk} strokeWidth={1.9} />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={[styles.rowName, { color: theme.ink }]} numberOfLines={1}>{file.name}</Text>
                    <Text style={[styles.rowMeta, { color: theme.ink2 }]}>{formatBytes(file.size)} · {relativeTime(file.mtime)}</Text>
                  </View>
                  {busyFile === file.name ? (
                    <ActivityIndicator color={theme.ink2} style={{ marginHorizontal: 12 }} />
                  ) : (
                    <>
                      <IconAction label={`Save ${file.name}`} onPress={() => save(file)} accent>
                        <DownloadIcon size={17} color={theme.onFill} strokeWidth={2} />
                      </IconAction>
                      <IconAction label={`Remove ${file.name}`} onPress={() => remove(file)}>
                        <TrashIcon size={17} color={theme.ink2} strokeWidth={1.9} />
                      </IconAction>
                    </>
                  )}
                </View>
              ))
            )}
            </>)}
          </>
        )}
      </ScrollView>

      <SendSheet
        job={sendJob}
        onClose={(anySent) => {
          setSendJob(null);
          if (anySent) refreshHistory();
        }}
      />
      <ClipboardSheet device={activeDevice} visible={sheet === "clip"} onClose={() => { setSheet(null); refreshHistory(); }} />
      <TextSheet device={activeDevice} visible={sheet === "text"} onClose={() => { setSheet(null); refreshHistory(); }} />
    </SafeAreaView>
  );
}

function Tile({ tile, onPress, disabled }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [down, setDown] = useState(false);
  const { Icon } = tile;
  return (
    <Pressable
      style={[styles.tile, raised(theme), down && pressed(theme), disabled && { opacity: 0.5 }]}
      onPressIn={() => setDown(true)}
      onPressOut={() => setDown(false)}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={tile.label}
    >
      <View style={[styles.tileIcon, { backgroundColor: theme.clayLo }]}>
        <Icon size={19} color={theme.dusk} strokeWidth={1.9} />
      </View>
      <Text style={[styles.tileLabel, { color: theme.ink }]}>{tile.label}</Text>
      <Text style={[styles.tileHint, { color: theme.ink3 }]}>{tile.hint}</Text>
    </Pressable>
  );
}

function SmallButton({ label: text, onPress }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable onPress={onPress} style={[styles.small, raised(theme, 0.5)]} hitSlop={6} accessibilityRole="button">
      <Text style={[styles.smallText, { color: theme.ink }]}>{text}</Text>
    </Pressable>
  );
}

function IconAction({ children, onPress, accent, label: a11y }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.iconAction, accent ? filled(theme, theme.dusk, theme.duskDeep) : raised(theme, 0.5)]}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={a11y}
    >
      {children}
    </Pressable>
  );
}

const makeStyles = (c) => ({
  container: { flex: 1, paddingTop: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 22, marginBottom: 14 },
  mark: { width: 34, height: 34, borderRadius: c(11), alignItems: "center", justifyContent: "center" },
  brandName: { fontWeight: "800", fontSize: 21 },
  body: { paddingHorizontal: 22, paddingBottom: 30 },

  label: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 },
  chips: { gap: 8, alignItems: "center", paddingBottom: 4, paddingRight: 4, marginBottom: 16 },
  chip: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 8, paddingHorizontal: 13, borderRadius: c(999), maxWidth: 170 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontWeight: "800", fontSize: 12.5 },

  tabs: { flexDirection: "row", gap: 4, padding: 4, borderRadius: c(16), marginBottom: 18 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: c(12), alignItems: "center" },
  tabLabel: { fontWeight: "800", fontSize: 13 },

  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { width: "47.5%", flexGrow: 1, borderRadius: c(22), padding: 14, gap: 6 },
  tileIcon: { width: 36, height: 36, borderRadius: c(12), alignItems: "center", justifyContent: "center", marginBottom: 2 },
  tileLabel: { fontWeight: "800", fontSize: 14.5 },
  tileHint: { fontWeight: "600", fontSize: 11.5 },

  note: { fontSize: 12.5, fontWeight: "600", marginTop: 10, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: c(16), paddingVertical: 10, paddingHorizontal: 11, marginBottom: 10 },
  rowIcon: { width: 36, height: 36, borderRadius: c(12), alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontWeight: "800", fontSize: 13.5 },
  rowMeta: { fontWeight: "600", fontSize: 11.5, marginTop: 2 },
  small: { borderRadius: c(12), paddingVertical: 7, paddingHorizontal: 11 },
  smallText: { fontWeight: "800", fontSize: 12 },
  iconAction: { width: 36, height: 36, borderRadius: c(12), alignItems: "center", justifyContent: "center", marginLeft: 6 },

  empty: { borderRadius: c(18), padding: 20, alignItems: "center", gap: 4 },
  emptyIcon: { width: 46, height: 46, borderRadius: c(15), alignItems: "center", justifyContent: "center", marginBottom: 6 },
});
