import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "courier.history";
const MAX_ENTRIES = 50;

export async function getHistory() {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function addHistoryEntry(entry) {
  const current = await getHistory();
  const next = [{ ...entry, at: Date.now() }, ...current].slice(0, MAX_ENTRIES);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
