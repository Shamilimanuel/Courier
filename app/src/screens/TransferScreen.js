import { useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { useTheme } from "../theme/ThemeContext";
import { raised, sunken } from "../theme/clay";
import { ClayButton, IconButton } from "../components/Clay";
import { CATEGORY_ICONS, BackIcon, CheckIcon } from "../components/icons";
import { uploadFile, formatBytes, formatEta, UploadCancelled } from "../lib/upload";
import { addHistoryEntry } from "../lib/history";

const PICKER_TYPE = {
  file: "*/*",
  media: ["image/*", "video/*"],
  app: "application/vnd.android.package-archive",
};

const COPY = {
  file: { title: "Send files", hint: "Any file type" },
  media: { title: "Send media", hint: "Photos & videos" },
  app: { title: "Send an app", hint: "APK files" },
};

let nextId = 1;

export default function TransferScreen({ category, pairing, onBack }) {
  const { theme } = useTheme();
  const copy = COPY[category] || COPY.file;
  const { Icon, color } = CATEGORY_ICONS[category] || CATEGORY_ICONS.file;
  const [items, setItems] = useState([]);
  const cancelFns = useRef({});

  function patchItem(id, patch) {
    setItems((current) => current.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function pick() {
    const result = await DocumentPicker.getDocumentAsync({
      type: PICKER_TYPE[category] || "*/*",
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const picked = result.assets.map((asset) => ({
      id: `f${nextId++}`,
      asset,
      status: "pending",
      progress: null,
      error: null,
      existingSize: null,
    }));
    setItems((current) => [...current, ...picked]);
  }

  async function upload(item, onDuplicate) {
    patchItem(item.id, { status: "uploading", error: null, progress: null });
    const { promise, cancel } = uploadFile(pairing, item.asset, {
      onDuplicate,
      onProgress: (progress) => patchItem(item.id, { progress }),
    });
    cancelFns.current[item.id] = cancel;
    try {
      const result = await promise;
      if (result.duplicate) {
        patchItem(item.id, { status: "duplicate", existingSize: result.existingSize });
        return;
      }
      patchItem(item.id, { status: "done" });
      await addHistoryEntry({
        name: result.name || item.asset.name,
        size: result.size || item.asset.size,
        category,
        direction: "sent",
        hostname: pairing.hostname || pairing.ip,
        uri: item.asset.uri,
        mimeType: item.asset.mimeType,
      });
    } catch (err) {
      if (err instanceof UploadCancelled) {
        patchItem(item.id, { status: "cancelled" });
      } else {
        patchItem(item.id, { status: "error", error: err.message });
      }
    } finally {
      delete cancelFns.current[item.id];
    }
  }

  function cancelUpload(item) {
    cancelFns.current[item.id]?.();
  }

  async function sendAll() {
    for (const item of items) {
      if (item.status === "pending" || item.status === "error" || item.status === "cancelled") {
        // eslint-disable-next-line no-await-in-loop
        await upload(item);
      }
    }
  }

  const hasSendable = items.some((it) => it.status === "pending" || it.status === "error" || it.status === "cancelled");
  const anyUploading = items.some((it) => it.status === "uploading");

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.ground }]} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <IconButton accessibilityLabel="Back" onPress={onBack}>
          <BackIcon size={17} color={theme.ink} strokeWidth={2.2} />
        </IconButton>
        <Text style={[styles.title, { color: theme.ink }]}>{copy.title}</Text>
      </View>

      <ClayButton label={`Choose ${copy.hint.toLowerCase()}`} onPress={pick} style={{ marginTop: 16 }} />

      {items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={[styles.emptyText, { color: theme.ink3 }]}>
            Nothing chosen yet — tap above to pick something to send.
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={{ gap: 10, paddingVertical: 14 }}>
          {items.map((item) => (
            <TransferItem
              key={item.id}
              item={item}
              color={color}
              Icon={Icon}
              onUpload={upload}
              onCancel={cancelUpload}
              theme={theme}
            />
          ))}
        </ScrollView>
      )}

      <ClayButton
        label={anyUploading ? "Sending…" : `Send to ${pairing.hostname || pairing.ip}`}
        tone="accent"
        onPress={sendAll}
        disabled={!hasSendable || anyUploading}
        style={{ marginTop: 12 }}
      />
    </SafeAreaView>
  );
}

function TransferItem({ item, color, Icon, onUpload, onCancel, theme }) {
  return (
    <View style={[styles.item, raised(theme, 0.8)]}>
      <View style={styles.itemRow}>
        <View style={[styles.itemIcon, { backgroundColor: color }]}>
          <Icon size={14} color="#FFFFFF" strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.itemName, { color: theme.ink }]} numberOfLines={1}>
            {item.asset.name}
          </Text>
          <Text style={[styles.itemMeta, { color: theme.ink3 }]}>{statusLine(item)}</Text>
        </View>
        {item.status === "done" && (
          <View style={[styles.checkDot, { backgroundColor: theme.moss }]}>
            <CheckIcon size={11} color="#FFFFFF" strokeWidth={3} />
          </View>
        )}
      </View>

      {item.status === "uploading" && item.progress && (
        <View style={[styles.progressTrack, sunken(theme, 0.6)]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: theme.dusk, width: `${Math.round((item.progress.loaded / item.progress.total) * 100)}%` },
            ]}
          />
        </View>
      )}

      {item.status === "uploading" && (
        <ClayButton label="Cancel" tone="danger" onPress={() => onCancel(item)} style={{ marginTop: 8 }} />
      )}

      {(item.status === "error" || item.status === "cancelled") && (
        <ClayButton label="Retry" onPress={() => onUpload(item)} style={{ marginTop: 8 }} />
      )}

      {item.status === "duplicate" && (
        <View style={styles.duplicateRow}>
          <View style={{ flex: 1 }}>
            <ClayButton label="Replace" onPress={() => onUpload(item, "replace")} />
          </View>
          <View style={{ flex: 1 }}>
            <ClayButton label="Keep Both" onPress={() => onUpload(item, "rename")} />
          </View>
          <View style={{ flex: 1 }}>
            <ClayButton label="Skip" onPress={() => onUpload(item, "skip")} />
          </View>
        </View>
      )}
    </View>
  );
}

function statusLine(item) {
  if (item.status === "pending") return formatBytes(item.asset.size || 0);
  if (item.status === "uploading" && item.progress) {
    const pct = Math.round((item.progress.loaded / item.progress.total) * 100);
    const speed = formatBytes(item.progress.speed) + "/s";
    const eta = formatEta(item.progress.eta);
    return `${pct}% · ${speed}${eta ? " · " + eta : ""}`;
  }
  if (item.status === "uploading") return "Starting…";
  if (item.status === "done") return "Sent";
  if (item.status === "duplicate") return `Already exists on the PC (${formatBytes(item.existingSize)})`;
  if (item.status === "cancelled") return "Cancelled";
  if (item.status === "error") return item.error || "Failed";
  return "";
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontWeight: "800", fontSize: 17 },
  list: { flex: 1 },

  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  emptyText: { fontSize: 13, fontWeight: "600", textAlign: "center", lineHeight: 19 },

  item: { borderRadius: 16, padding: 12 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  itemIcon: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  itemName: { fontWeight: "800", fontSize: 12.5 },
  itemMeta: { fontSize: 10.5, fontWeight: "600", marginTop: 1 },
  checkDot: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },

  progressTrack: { height: 8, borderRadius: 999, overflow: "hidden", marginTop: 9 },
  progressFill: { height: "100%", borderRadius: 999 },

  duplicateRow: { flexDirection: "row", gap: 8, marginTop: 10 },
});
