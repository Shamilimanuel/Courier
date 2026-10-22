import { useEffect, useRef, useState } from "react";
import { View, Text, Modal, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import * as Clipboard from "expo-clipboard";
import Svg, { Circle } from "react-native-svg";
import { useTheme, useThemedStyles } from "../theme/ThemeContext";
import { sunken, filled, display } from "../theme/clay";
import { ClayButton, ClayField } from "./Clay";
import { CheckIcon } from "./icons";
import { sendFile, formatBytes, formatEta, UploadCancelled } from "../lib/upload";
import { addHistoryEntry } from "../lib/history";
import { getClipboard, setClipboard, ApiError } from "../lib/api";

/**
 * Panels that slide up over Home, the way the prototype does it: sending
 * with one ring of progress, the clipboard both ways, and a text to send.
 */

/** The shared frame: a dimmed page and a panel from the bottom. */
export function BottomSheet({ visible, onClose, children, locked }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !locked && onClose()} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.veil} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.dimTap} onPress={() => !locked && onClose()} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: theme.ground }]}>
          <View style={[styles.grab, { backgroundColor: theme.ink3 }]} />
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SheetTitle({ children, sub }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[styles.title, display(theme), { color: theme.ink }]}>{children}</Text>
      {sub ? <Text style={[styles.sub, { color: theme.ink2 }]}>{sub}</Text> : null}
    </View>
  );
}

function Ring({ pct }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const r = 42;
  const length = 2 * Math.PI * r;
  return (
    <View style={styles.ring}>
      <Svg width={150} height={150} viewBox="0 0 100 100" style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle cx="50" cy="50" r={r} fill="none" stroke={theme.clayLo} strokeWidth={9} />
        <Circle cx="50" cy="50" r={r} fill="none" stroke={theme.dusk} strokeWidth={9} strokeLinecap="round"
          strokeDasharray={`${length}`} strokeDashoffset={length * (1 - pct / 100)} />
      </Svg>
      <Text style={[styles.ringNum, display(theme), { color: theme.ink }]}>{pct}%</Text>
    </View>
  );
}

/**
 * Sends a set of files to one stop, one after another, with one ring for the
 * lot. `job` is { device, assets: [{ uri, name, mimeType, size }], category };
 * a new job object starts a new send. A file that already exists on the PC
 * asks here: keep both, replace, or skip.
 */
export function SendSheet({ job, onClose }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [phase, setPhase] = useState("idle"); // sending | duplicate | done | error | idle
  const [progress, setProgress] = useState({ loaded: 0, speed: 0, eta: null, index: 0, reconnecting: false });
  // Where a send stopped: which file, how much was done before it, and the
  // upload the other side kept, so "Carry on" continues instead of redoing.
  const failedRef = useRef(null);
  const [dupName, setDupName] = useState(null);
  const [error, setError] = useState(null);
  const [sentCount, setSentCount] = useState(0);
  const cancelRef = useRef(null);
  const answerRef = useRef(null);
  const stopRef = useRef(false);

  const assets = job?.assets || [];
  const total = assets.reduce((sum, a) => sum + (a.size || 0), 0);
  const host = job ? job.device.hostname || job.device.ip : "";

  useEffect(() => {
    if (!job) return;
    stopRef.current = false;
    failedRef.current = null;
    run();
    return () => {
      stopRef.current = true;
      cancelRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  async function sendOne(asset, onDuplicate, done, resumeUploadId) {
    const { promise, cancel } = sendFile(job.device, asset, {
      onDuplicate,
      resumeUploadId,
      onProgress: (p) => setProgress((cur) => ({ ...cur, loaded: done + p.loaded, speed: p.speed, eta: p.eta, reconnecting: !!p.reconnecting })),
    });
    cancelRef.current = cancel;
    return promise;
  }

  async function run() {
    const from = failedRef.current;
    failedRef.current = null;
    setPhase("sending");
    setError(null);
    let done = from ? from.done : 0;
    let sent = from ? from.sent : 0;
    if (!from) setSentCount(0);
    setProgress({ loaded: done, speed: 0, eta: null, index: from ? from.index : 0, reconnecting: false });
    let i = from ? from.index : 0;
    try {
      for (; i < assets.length; i++) {
        if (stopRef.current) return;
        const asset = assets[i];
        setProgress((cur) => ({ ...cur, index: i }));
        const resume = from && from.index === i ? from.uploadId : undefined;
        let result = await sendOne(asset, undefined, done, resume);
        if (result.duplicate) {
          setDupName(asset.name);
          setPhase("duplicate");
          const choice = await new Promise((resolve) => (answerRef.current = resolve));
          setPhase("sending");
          if (choice === "skip") {
            done += asset.size || 0;
            continue;
          }
          result = await sendOne(asset, choice, done);
        }
        done += asset.size || 0;
        sent += 1;
        setSentCount(sent);
        await addHistoryEntry({
          name: result.name || asset.name,
          size: result.size || asset.size,
          category: job.category,
          direction: "sent",
          hostname: host,
          uri: asset.uri,
          mimeType: asset.mimeType,
        });
      }
      cancelRef.current = null;
      setPhase("done");
    } catch (err) {
      cancelRef.current = null;
      if (err instanceof UploadCancelled) {
        onClose(sent > 0);
        return;
      }
      failedRef.current = { index: i, done, sent, uploadId: err?.uploadId };
      setError(err?.message || "Couldn't send that.");
      setPhase("error");
    }
  }

  function answer(choice) {
    answerRef.current?.(choice);
    answerRef.current = null;
  }

  const pct = total ? Math.min(100, Math.round((progress.loaded / total) * 100)) : 0;
  const what = assets.length === 1 ? assets[0].name : `${assets.length} files`;

  return (
    <BottomSheet visible={!!job && phase !== "idle"} locked={phase === "sending"} onClose={() => onClose(sentCount > 0)}>
      {phase === "sending" && (
        <>
          <Ring pct={pct} />
          <Text style={[styles.centerName, { color: theme.ink }]} numberOfLines={1}>{what}</Text>
          {progress.reconnecting ? (
            <Text style={[styles.centerMeta, { color: theme.danger }]}>
              Connection lost. Carrying on from {pct}% as soon as {host} is back…
            </Text>
          ) : (
            <Text style={[styles.centerMeta, { color: theme.ink2 }]}>
              {formatBytes(total)} to {host}
              {assets.length > 1 ? ` · ${progress.index + 1} of ${assets.length}` : ""}
              {progress.speed ? ` · ${formatBytes(progress.speed)}/s · ${formatEta(progress.eta)}` : ""}
            </Text>
          )}
          <ClayButton label="Cancel" tone="quiet" onPress={() => cancelRef.current?.()} style={{ marginTop: 18 }} />
        </>
      )}
      {phase === "duplicate" && (
        <>
          <SheetTitle sub={`${host} already has a file called “${dupName}”.`}>Already there</SheetTitle>
          <ClayButton label="Keep both" tone="accent" onPress={() => answer("rename")} />
          <ClayButton label="Replace it" onPress={() => answer("replace")} style={{ marginTop: 10 }} />
          <ClayButton label="Skip this one" tone="quiet" onPress={() => answer("skip")} style={{ marginTop: 10 }} />
        </>
      )}
      {phase === "done" && (
        <>
          <View style={styles.center}>
            <View style={[styles.check, filled(theme, theme.moss, "rgba(0,0,0,0.2)")]}>
              <CheckIcon size={34} color="#FFFFFF" strokeWidth={3} />
            </View>
            <Text style={[styles.doneTitle, display(theme), { color: theme.ink }]}>Delivered to {host}</Text>
            <Text style={[styles.centerMeta, { color: theme.ink2 }]}>
              {sentCount === assets.length ? what : `${sentCount} of ${assets.length} sent`} · in Downloads › Courier
            </Text>
          </View>
          <ClayButton label="Done" tone="accent" onPress={() => onClose(true)} style={{ marginTop: 18 }} />
        </>
      )}
      {phase === "error" && (
        <>
          <SheetTitle sub={failedRef.current?.uploadId ? `Stopped at ${pct}%. ${error}` : error}>Couldn't send it</SheetTitle>
          <ClayButton label={failedRef.current?.uploadId ? "Carry on" : "Try again"} tone="accent" onPress={run} />
          <ClayButton label="Close" onPress={() => onClose(sentCount > 0)} style={{ marginTop: 10 }} />
        </>
      )}
    </BottomSheet>
  );
}

/** What is on this phone's clipboard, and the PC's: both ways. */
export function ClipboardSheet({ device, visible, onClose }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [mine, setMine] = useState("");
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const host = device ? device.hostname || device.ip : "";

  useEffect(() => {
    if (!visible) return;
    setMessage(null);
    Clipboard.getStringAsync().then((t) => setMine(t || ""));
  }, [visible]);

  async function send() {
    setBusy("send");
    try {
      await setClipboard(device, mine, "clip");
      await addHistoryEntry({ name: mine.slice(0, 60) || "Clipboard", size: mine.length, category: "text", direction: "sent", hostname: host });
      setMessage({ ok: true, text: `It's on ${host}'s clipboard now.` });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : `Couldn't reach ${host}.` });
    } finally {
      setBusy(null);
    }
  }

  async function get() {
    setBusy("get");
    try {
      const text = await getClipboard(device);
      await Clipboard.setStringAsync(text || "");
      setMine(text || "");
      setMessage({ ok: true, text: `Copied from ${host}. Paste it anywhere.` });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : `Couldn't reach ${host}.` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetTitle sub="On this phone now:">Clipboard</SheetTitle>
      <View style={[styles.clip, sunken(theme, 0.7)]}>
        <Text style={[styles.clipText, { color: mine ? theme.ink : theme.ink3 }]} numberOfLines={5}>
          {mine || "Nothing copied yet."}
        </Text>
      </View>
      {message && <Text style={[styles.message, { color: message.ok ? theme.moss : theme.danger }]}>{message.text}</Text>}
      <ClayButton label={`Send it to ${host}`} tone="accent" busy={busy === "send"} disabled={!mine || !!busy} onPress={send} style={{ marginTop: 14 }} />
      <ClayButton label={`Get ${host}'s clipboard`} busy={busy === "get"} disabled={!!busy} onPress={get} style={{ marginTop: 10 }} />
    </BottomSheet>
  );
}

/** Something typed or pasted, for the PC's clipboard. */
export function TextSheet({ device, visible, onClose }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const host = device ? device.hostname || device.ip : "";

  useEffect(() => {
    if (visible) setMessage(null);
  }, [visible]);

  async function send() {
    setBusy(true);
    try {
      await setClipboard(device, text, "text");
      await addHistoryEntry({ name: text.slice(0, 60), size: text.length, category: "text", direction: "sent", hostname: host });
      setText("");
      setMessage({ ok: true, text: `Sent. It's on ${host}'s clipboard.` });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : `Couldn't reach ${host}.` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetTitle sub={`It lands on ${host}'s clipboard, ready to paste.`}>Text</SheetTitle>
      <ClayField multiline value={text} onChangeText={setText} placeholder={`Type or paste something for ${host}…`} />
      {message && <Text style={[styles.message, { color: message.ok ? theme.moss : theme.danger }]}>{message.text}</Text>}
      <ClayButton label={`Send to ${host}`} tone="accent" busy={busy} disabled={!text.trim() || busy} onPress={send} style={{ marginTop: 14 }} />
    </BottomSheet>
  );
}

const makeStyles = (c) => ({
  veil: { flex: 1, backgroundColor: "rgba(10,10,20,0.45)", justifyContent: "flex-end" },
  dimTap: { flex: 1 },
  sheet: { borderTopLeftRadius: c(30), borderTopRightRadius: c(30), paddingHorizontal: 22, paddingTop: 10, paddingBottom: 34 },
  grab: { width: 38, height: 4, borderRadius: 2, opacity: 0.35, alignSelf: "center", marginBottom: 16 },
  title: { fontSize: 19, fontWeight: "800" },
  sub: { fontSize: 13, fontWeight: "600", marginTop: 4, lineHeight: 18 },
  ring: { width: 150, height: 150, alignSelf: "center", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  ringNum: { position: "absolute", fontSize: 30, fontWeight: "800" },
  center: { alignItems: "center", paddingTop: 6 },
  centerName: { fontSize: 15, fontWeight: "800", textAlign: "center" },
  centerMeta: { fontSize: 12.5, fontWeight: "600", textAlign: "center", marginTop: 4 },
  check: { width: 74, height: 74, borderRadius: 37, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  doneTitle: { fontSize: 21, fontWeight: "800", textAlign: "center" },
  clip: { borderRadius: c(14), padding: 14 },
  clipText: { fontSize: 14, fontWeight: "600", lineHeight: 20 },
  message: { fontSize: 12.5, fontWeight: "700", marginTop: 10 },
});
