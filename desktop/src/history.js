const fs = require("fs");
const path = require("path");

/** Transfer history, mirroring app/src/lib/history.js's AsyncStorage-backed
 * log — same shape and cap, persisted as JSON instead. */

const MAX_ENTRIES = 50;
let storePath = null;

function init(userDataDir) {
  storePath = path.join(userDataDir, "history.json");
}

function getHistory() {
  if (!storePath || !fs.existsSync(storePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch {
    return [];
  }
}

function addHistoryEntry(entry) {
  const next = [{ ...entry, at: Date.now() }, ...getHistory()].slice(0, MAX_ENTRIES);
  fs.writeFileSync(storePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

module.exports = { init, getHistory, addHistoryEntry };
