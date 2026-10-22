import { Stop, onStop, identity, selfForPairing, startFinding, stopFinding, foundSoFar } from "./stop";
import { peekHealth } from "./api";

/**
 * Finding PCs and phones with Courier on this Wi-Fi, and pairing with one
 * by a 4-digit code instead of a QR code.
 *
 * Two ways at once: listening for their mDNS announcements (Finder.kt), and
 * knocking on every address of this network once (a "sweep"), for Wi-Fi
 * that blocks announcements but not the stops themselves.
 */

const PORT = 5544;
const SWEEP_PARALLEL = 32;

/** Keeps calling onChange(list) with what was found; returns stop(). Each
 * found stop is { id, name, kind, ip, port, securePort? }. */
export function findStops(onChange) {
  const found = new Map();
  const me = identity()?.id;
  let stopped = false;
  const emit = () => !stopped && onChange([...found.values()]);
  const remember = (f) => {
    if (!f || !f.id || f.id === me) return;
    found.set(f.id, { ...found.get(f.id), ...f });
    emit();
  };

  const offs = [
    onStop("onFound", remember),
    onStop("onLost", ({ id }) => {
      if (found.delete(id)) emit();
    }),
  ];
  startFinding();
  foundSoFar().forEach(remember);

  (async () => {
    let addr = null;
    try {
      addr = Stop?.wifiAddress();
    } catch {
      addr = null;
    }
    // Only the usual home-network size; a bigger one would mean thousands of knocks.
    if (!addr || !addr.ip || addr.prefix < 24) return;
    const base = addr.ip.split(".").slice(0, 3).join(".");
    const targets = [];
    for (let i = 1; i < 255; i++) if (`${base}.${i}` !== addr.ip) targets.push(`${base}.${i}`);
    for (let i = 0; i < targets.length && !stopped; i += SWEEP_PARALLEL) {
      await Promise.all(
        targets.slice(i, i + SWEEP_PARALLEL).map(async (ip) => {
          const h = await peekHealth(ip, PORT, 900);
          if (h && h.api >= 2 && h.id) {
            remember({ id: h.id, name: h.name || h.hostname || ip, kind: h.kind === "phone" ? "phone" : "pc", ip, port: PORT, securePort: h.securePort });
          }
        })
      );
    }
  })();

  return () => {
    stopped = true;
    offs.forEach((off) => off());
    stopFinding();
  };
}

async function plainJson(target, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`http://${target.ip}:${target.port}${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `${target.name || target.ip} said no (${res.status})`);
    return json;
  } catch (err) {
    if (err.name === "AbortError" || err.message === "Network request failed") {
      throw new Error(`Couldn't reach ${target.name || target.ip}. Is it still on this Wi-Fi?`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Asks a found stop to pair. It shows a code (returned here, to show on
 * this phone too) and Allow. */
export async function askToPair(target) {
  const me = selfForPairing();
  if (!me) throw new Error("Pairing by code needs the installed Courier app. Scan the QR code instead.");
  return plainJson(target, "/pair/request", me);
}

/** Waits for Allow or Deny, up to two minutes. Resolves { state, stop }:
 * "allowed" with the stop's details, "denied", "expired" or "cancelled". */
export async function waitForAnswer(target, requestId, isCancelled) {
  const until = Date.now() + 2 * 60 * 1000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1500));
    if (isCancelled()) return { state: "cancelled" };
    let status;
    try {
      status = await plainJson(target, `/pair/request/${requestId}`);
    } catch {
      continue; // a blip; keep asking
    }
    if (status.state !== "waiting") return status;
  }
  return { state: "expired" };
}
