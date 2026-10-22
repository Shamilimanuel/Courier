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
function addStop({ ip, port, token, hostname, securePort, fingerprint, peerId, kind }) {
  const list = readAll();
  // The same stop paired again (it has an id since Courier 1.3 / desktop
  // 1.3): update it instead of listing it twice.
  const known = peerId ? list.find((s) => s.peerId === peerId) : null;
  const stop = {
    id: known ? known.id : `${ip}:${port}:${Date.now()}`,
    ip,
    port: String(port),
    token,
    hostname: hostname || ip,
    securePort,
    fingerprint,
    peerId: peerId || undefined,
    kind: kind === "phone" ? "phone" : "pc",
  };
  writeAll(known ? list.map((s) => (s === known ? stop : s)) : [...list, stop]);
  return stop;
}

function findByPeerId(peerId) {
  return readAll().find((s) => s.peerId && s.peerId === peerId) || null;
}

/** A known stop turned up at a new address (phones get new ones often).
 * Returns true when something changed. */
function updateAddress(peerId, ip, port) {
  const list = readAll();
  const stop = list.find((s) => s.peerId && s.peerId === peerId);
  if (!stop || !ip) return false;
  const nextPort = port ? String(port) : stop.port;
  if (stop.ip === ip && stop.port === nextPort) return false;
  stop.ip = ip;
  stop.port = nextPort;
  writeAll(list);
  return true;
}

/** Forgets one stop. Returns the remaining list. */
function removeStop(id) {
  const next = readAll().filter((s) => s.id !== id);
  writeAll(next);
  return next;
}

module.exports = { init, getStops, getStop, addStop, removeStop, findByPeerId, updateAddress };
