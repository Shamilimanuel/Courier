import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "courier.pairing";

export async function loadPairing() {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function savePairing({ ip, port, token, hostname }) {
  const pairing = { ip, port, token, hostname: hostname || null };
  await AsyncStorage.setItem(KEY, JSON.stringify(pairing));
  return pairing;
}

export async function clearPairing() {
  await AsyncStorage.removeItem(KEY);
}

export function baseUrl(pairing) {
  return `http://${pairing.ip}:${pairing.port}`;
}
