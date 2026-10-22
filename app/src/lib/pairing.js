import AsyncStorage from "@react-native-async-storage/async-storage";

const DEVICES_KEY = "courier.devices";
const ACTIVE_KEY = "courier.activeDeviceId";

export async function getDevices() {
  const raw = await AsyncStorage.getItem(DEVICES_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveDevices(devices) {
  await AsyncStorage.setItem(DEVICES_KEY, JSON.stringify(devices));
}

export async function getActiveDeviceId() {
  return AsyncStorage.getItem(ACTIVE_KEY);
}

export async function setActiveDeviceId(id) {
  await AsyncStorage.setItem(ACTIVE_KEY, id);
}

/**
 * Adds a newly paired stop (a PC or another phone) and makes it the active
 * one. peerId is the stop's own id (Courier 1.4+ / desktop 1.3+): pairing
 * the same stop again updates it instead of listing it twice, and a new
 * address it turns up at can be followed. securePort + fingerprint let the
 * phone talk HTTPS pinned to that PC's certificate.
 */
export async function addDevice({ ip, port, token, hostname, peerId, kind, securePort, fingerprint }, { makeActive = true } = {}) {
  const devices = await getDevices();
  const known = peerId ? devices.find((d) => d.peerId === peerId) : null;
  const device = {
    id: known ? known.id : `${ip}:${port}:${Date.now()}`,
    ip,
    port: String(port),
    token,
    hostname: hostname || ip,
    peerId: peerId || undefined,
    kind: kind === "phone" ? "phone" : "pc",
    securePort: securePort ? Number(securePort) : known?.securePort,
    fingerprint: fingerprint || known?.fingerprint,
  };
  await saveDevices(known ? devices.map((d) => (d === known ? device : d)) : [...devices, device]);
  if (makeActive || !devices.length) await setActiveDeviceId(device.id);
  return device;
}

/** Saves changes to stops that are already listed (a new address, a pinned
 * fingerprint). Returns the new list, or null when nothing changed. */
export async function updateDevices(change) {
  const devices = await getDevices();
  let changed = false;
  const next = devices.map((d) => {
    const patch = change(d);
    if (!patch) return d;
    const merged = { ...d, ...patch };
    if (Object.keys(patch).some((k) => String(merged[k]) !== String(d[k]))) {
      changed = true;
      return merged;
    }
    return d;
  });
  if (!changed) return null;
  await saveDevices(next);
  return next;
}

/** Forgets one paired PC. Returns the remaining list. */
export async function removeDevice(id) {
  const devices = await getDevices();
  const next = devices.filter((d) => d.id !== id);
  await saveDevices(next);
  const activeId = await getActiveDeviceId();
  if (activeId === id) {
    const fallback = next[0]?.id || null;
    if (fallback) await setActiveDeviceId(fallback);
    else await AsyncStorage.removeItem(ACTIVE_KEY);
  }
  return next;
}

export function baseUrl(pairing) {
  return `http://${pairing.ip}:${pairing.port}`;
}
