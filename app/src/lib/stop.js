import { Platform, PermissionsAndroid } from "react-native";
import { requireOptionalNativeModule } from "expo";

/**
 * This phone as a stop (app/modules/courier-stop): a small server that PCs
 * and other phones send to, kept running by the quiet "Courier is ready"
 * notification. Missing in Expo Go and on the web, where everything here
 * quietly does nothing and the app works as a plain sender.
 */
export const Stop = Platform.OS === "android" ? requireOptionalNativeModule("CourierStop") : null;

export function onStop(event, callback) {
  if (!Stop) return () => {};
  const sub = Stop.addListener(event, callback);
  return () => sub.remove();
}

/** { id, name, kind, port, token, running, enabled } or null. */
export function identity() {
  try {
    return Stop ? Stop.identity() : null;
  } catch {
    return null;
  }
}

/** Who this phone is, for pairing (without the running flags). */
export function selfForPairing() {
  const me = identity();
  if (!me) return null;
  return { id: me.id, name: me.name, kind: "phone", port: me.port, token: me.token };
}

/** Starts listening. Asks for notifications first on Android 13+, since
 * that's how arrivals (and the "ready" note) show up. */
export async function startStop() {
  if (!Stop) return false;
  if (Platform.Version >= 33) {
    try {
      await PermissionsAndroid.request("android.permission.POST_NOTIFICATIONS");
    } catch {
      // still runs; arrivals just show inside the app
    }
  }
  try {
    Stop.start();
    return true;
  } catch {
    return false;
  }
}

export function stopStop() {
  try {
    Stop?.stop();
  } catch {
    // already stopped
  }
}

/** Lets the stop say who sent something ("From Desktop"). */
export function shareNames(devices) {
  try {
    Stop?.setPeers(devices.filter((d) => d.peerId).map((d) => ({ peerId: d.peerId, name: d.hostname || d.ip })));
  } catch {
    // only for nicer notifications
  }
}

/** How the native side reaches a paired stop. */
export function targetOf(device) {
  const t = { ip: device.ip, port: Number(device.port), token: device.token || null };
  if (device.securePort && device.fingerprint) {
    t.securePort = Number(device.securePort);
    t.fingerprint = device.fingerprint;
  }
  return t;
}

// The app listens for stops all the time it's open (to follow new
// addresses) and the pair screen does too; count so one doesn't stop the other.
let finders = 0;
export function startFinding() {
  if (finders++ === 0) {
    try {
      Stop?.startFinding();
    } catch {
      // the address sweep still works
    }
  }
}
export function stopFinding() {
  if (finders > 0 && --finders === 0) {
    try {
      Stop?.stopFinding();
    } catch {
      // already stopped
    }
  }
}

// Everything found while the app is open, so a screen that starts looking
// later still sees what was already found.
const seen = new Map();
onStop("onFound", (f) => f && f.id && seen.set(f.id, f));
onStop("onLost", ({ id }) => seen.delete(id));
export function foundSoFar() {
  return [...seen.values()];
}
