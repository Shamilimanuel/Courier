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

/** Adds a newly paired PC and makes it the active one. */
export async function addDevice({ ip, port, token, hostname }) {
  const devices = await getDevices();
  const id = `${ip}:${port}:${Date.now()}`;
  const device = { id, ip, port, token, hostname: hostname || ip };
  await saveDevices([...devices, device]);
  await setActiveDeviceId(id);
  return device;
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
