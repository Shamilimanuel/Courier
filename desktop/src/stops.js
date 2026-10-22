const fs = require("fs");
const path = require("path");

/** The desktop app's list of "stops it can send to" — a Node/fs port of
 * app/src/lib/pairing.js's AsyncStorage-backed device list, same shape. */

let storePath = null;

function init(userDataDir) {
  storePath = path.join(userDataDir, "stops.json");
}

function readAll() {
  if (!storePath || !fs.existsSync(storePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch {
    return [];
  }
}

function writeAll(list) {
  fs.writeFileSync(storePath, JSON.stringify(list, null, 2), "utf8");
}

function getStops() {
  return readAll();
}

function getStop(id) {
  return readAll().find((s) => s.id === id) || null;
}

/** Adds a newly paired stop. `securePort`/`fingerprint` are set when the
 * stop supports HTTPS+pinning (see desktop/src/client.js); omitted for a
 * stop that only offered plain HTTP, which the client falls back to. */
function addStop({ ip, port, token, hostname, securePort, fingerprint }) {
  const list = readAll();
  const id = `${ip}:${port}:${Date.now()}`;
  const stop = { id, ip, port: String(port), token, hostname: hostname || ip, securePort, fingerprint };
  list.push(stop);
  writeAll(list);
  return stop;
}

/** Forgets one stop. Returns the remaining list. */
function removeStop(id) {
  const next = readAll().filter((s) => s.id !== id);
  writeAll(next);
  return next;
}

module.exports = { init, getStops, getStop, addStop, removeStop };
