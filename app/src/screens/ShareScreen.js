import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme, useThemedStyles } from "../theme/ThemeContext";
import { raised, sunken, filled, display } from "../theme/clay";
import { ClayButton, IconButton } from "../components/Clay";
import { BackIcon, CheckIcon, CATEGORY_ICONS } from "../components/icons";
import { pingHealth, setClipboard, ApiError } from "../lib/api";
import { sendFile, formatBytes, formatEta, UploadCancelled } from "../lib/upload";
import { addHistoryEntry } from "../lib/history";

/**
 * What opens when someone picks Courier in another app's share menu
 * (expo-share-intent). Files go to the chosen stop's Downloads\Courier,
 * one after the other, with one progress bar for the lot; shared text or a
 * link goes to that PC's clipboard, the same as Text → Send.
 */
export default function ShareScreen({ devices, activeDeviceId, shareIntent, onClose }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [online, setOnline] = useState({});
  const [stage, setStage] = useState("pick"); // pick | sending | done | error
  const [target, setTarget] = useState(null);
  const [progress, setProgress] = useState({ loaded: 0, total: 0, speed: 0, eta: null, index: 0 });
  const [error, setError] = useState(null);
  const cancelRef = useRef(null);

  const files = (shareIntent?.files || []).filter((f) => f && f.path);
  const text = !files.length ? (shareIntent?.webUrl || shareIntent?.text || "").trim() : "";
  const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
  const what = files.length
    ? files.length === 1
      ? files[0].fileName || "1 file"
      : `${files.length} files`
    : text
    ? shareIntent?.webUrl
      ? "A link"
      : "Some text"
    : "Nothing";

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

  async function send(device) {
    setTarget(device);
    setError(null);
    setStage("sending");
    const host = device.hostname || device.ip;
    try {
      if (!files.length) {
        await setClipboard(device, text, "text");
        await addHistoryEntry({ name: text.slice(0, 60), size: text.length, category: "text", direction: "sent", hostname: host });
        setStage("done");
        return;
      }
      let doneBytes = 0;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const asset = { uri: f.path, name: f.fileName || `shared-${i + 1}`, mimeType: f.mimeType, size: f.size };
        const onProgress = (p) =>
          setProgress({ loaded: doneBytes + p.loaded, total: totalBytes || p.total, speed: p.speed, eta: p.eta, index: i });
        let job = sendFile(device, asset, { onProgress });
        cancelRef.current = job.cancel;
        let result = await job.promise;
        if (result.duplicate) {
          // Shared from another app: never ask, keep both copies.
          job = sendFile(device, asset, { onProgress, onDuplicate: "rename" });
          cancelRef.current = job.cancel;
          result = await job.promise;
        }
        doneBytes += f.size || 0;
        const isMedia = /^(image|video)\//.test(f.mimeType || "");
        await addHistoryEntry({
          name: result.name || asset.name,
          size: result.size || asset.size,
          category: isMedia ? "media" : "file",
          direction: "sent",
          hostname: host,
          uri: asset.uri,
          mimeType: asset.mimeType,
        });
      }
      cancelRef.current = null;
      setStage("done");
    } catch (err) {
      cancelRef.current = null;
      if (err instanceof UploadCancelled) {
        setStage("pick");
        return;
      }
      setError(err instanceof ApiError ? err.message : err?.message || "Couldn't send that.");
      setStage("error");
    }
  }

  const labelStyle = [styles.label, theme.fontDisplay && { fontFamily: theme.fontDisplay, fontWeight: "normal", fontSize: 12, letterSpacing: theme.labelSpacing }, { color: theme.ink3 }];
  const pct = progress.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;
  const { Icon, color } = files.length ? CATEGORY_ICONS[/^(image|video)\//.test(files[0].mimeType || "") ? "media" : "file"] : CATEGORY_ICONS.text;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.ground }]} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <IconButton accessibilityLabel="Cancel" onPress={() => (stage === "sending" ? cancelRef.current?.() : onClose())}>
          <BackIcon size={17} color={theme.ink2} strokeWidth={2} />
        </IconButton>
        <Text style={[styles.title, display(theme), { color: theme.ink }]}>Send with Courier</Text>
      </View>

      <View style={[styles.summary, raised(theme, 0.8)]}>
        <View style={[styles.summaryIcon, { backgroundColor: color }]}>
          <Icon size={20} color="#FFFFFF" strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.summaryTitle, { color: theme.ink }]} numberOfLines={1}>{what}</Text>
          <Text style={[styles.summaryMeta, { color: theme.ink3 }]} numberOfLines={2}>
            {files.length ? formatBytes(totalBytes) : text || "Courier can send files, links and text."}
          </Text>
        </View>
      </View>

      {stage === "pick" && (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          <Text style={labelStyle}>Send it to</Text>
          {devices.map((d) => {
            const isOnline = online[d.id];
            const off = isOnline === false;
            return (
              <Pressable
                key={d.id}
                onPress={() => send(d)}
                disabled={off || (!files.length && !text)}
                style={[styles.stop, raised(theme, 0.8), d.id === activeDeviceId && { borderWidth: 2, borderColor: theme.dusk }, off && { opacity: 0.5 }]}
                accessibilityRole="button"
                accessibilityLabel={`Send to ${d.hostname}`}
              >
                <View style={[styles.dot, { backgroundColor: isOnline == null ? theme.ink3 : isOnline ? theme.moss : theme.danger }]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.stopName, { color: theme.ink }]} numberOfLines={1}>{d.hostname || d.ip}</Text>
                  <Text style={[styles.stopMeta, { color: theme.ink3 }]}>
                    {isOnline == null ? "Checking…" : isOnline ? "Ready · same Wi-Fi" : "Not reachable right now"}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {stage === "sending" && (
        <View style={styles.middle}>
          <Text style={[styles.big, display(theme), { color: theme.ink }]}>{files.length ? `${pct}%` : "…"}</Text>
          <Text style={[styles.sub, { color: theme.ink2 }]}>
            To {target?.hostname}
            {files.length > 1 ? ` · file ${progress.index + 1} of ${files.length}` : ""}
          </Text>
          {files.length > 0 && (
            <>
              <View style={[styles.bar, sunken(theme, 0.6)]}>
                <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: theme.dusk }]} />
              </View>
              <Text style={[styles.sub, { color: theme.ink3 }]}>
                {progress.speed ? `${formatBytes(progress.speed)}/s · ${formatEta(progress.eta)}` : "Starting…"}
              </Text>
            </>
          )}
          <ClayButton label="Cancel" tone="quiet" onPress={() => cancelRef.current?.()} style={{ marginTop: 20, alignSelf: "stretch" }} />
        </View>
      )}

      {stage === "done" && (
        <View style={styles.middle}>
          <View style={[styles.check, filled(theme, theme.moss, "rgba(0,0,0,0.2)")]}>
            <CheckIcon size={34} color="#FFFFFF" strokeWidth={3} />
          </View>
          <Text style={[styles.doneTitle, display(theme), { color: theme.ink }]}>Delivered to {target?.hostname}</Text>
          <Text style={[styles.sub, { color: theme.ink2 }]}>
            {files.length ? "In Downloads\\Courier on that PC." : "It's on that PC's clipboard now."}
          </Text>
          <ClayButton label="Done" tone="accent" onPress={onClose} style={{ marginTop: 22, alignSelf: "stretch" }} />
        </View>
      )}

      {stage === "error" && (
        <View style={styles.middle}>
          <Text style={[styles.doneTitle, display(theme), { color: theme.ink }]}>Couldn't send it</Text>
          <Text style={[styles.sub, { color: theme.ink2 }]}>{error}</Text>
          <ClayButton label="Try again" tone="accent" onPress={() => send(target)} style={{ marginTop: 20, alignSelf: "stretch" }} />
          <ClayButton label="Pick another stop" onPress={() => setStage("pick")} style={{ marginTop: 10, alignSelf: "stretch" }} />
        </View>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c) => ({
  container: { flex: 1, paddingHorizontal: 22, paddingTop: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 18 },
  title: { fontSize: 20, fontWeight: "800" },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10, marginTop: 18 },

  summary: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: c(18), padding: 14 },
  summaryIcon: { width: 42, height: 42, borderRadius: c(13), alignItems: "center", justifyContent: "center" },
  summaryTitle: { fontSize: 15, fontWeight: "800" },
  summaryMeta: { fontSize: 12, fontWeight: "600", marginTop: 2 },

  stop: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: c(18), paddingVertical: 14, paddingHorizontal: 16, marginBottom: 10 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  stopName: { fontSize: 15, fontWeight: "800" },
  stopMeta: { fontSize: 12, fontWeight: "600", marginTop: 2 },

  middle: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 60 },
  big: { fontSize: 46, fontWeight: "800" },
  sub: { fontSize: 13, fontWeight: "600", marginTop: 6, textAlign: "center" },
  bar: { alignSelf: "stretch", height: 12, borderRadius: c(8), overflow: "hidden", marginTop: 18 },
  barFill: { height: "100%", borderRadius: c(8) },
  check: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  doneTitle: { fontSize: 21, fontWeight: "800", textAlign: "center" },
});
