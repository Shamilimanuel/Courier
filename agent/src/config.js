const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const selfsigned = require("selfsigned");

const DEFAULT_CONFIG_DIR = path.join(__dirname, "..");
const CONFIG_PATH = path.join(DEFAULT_CONFIG_DIR, "config.json");

/**
 * A self-signed cert generated once per install, same moment as the
 * pairing token. There's no CA involved — trust comes from the cert's
 * fingerprint riding along in the same pairing QR/fields the token
 * already travels in, so a client pins it the instant it pairs instead
 * of validating a certificate chain.
 */
function generateCert() {
  const attrs = [{ name: "commonName", value: "courier-agent" }];
  const pems = selfsigned.generate(attrs, { keySize: 2048, days: 3650, algorithm: "sha256" });
  // Matches the exact format tls.TLSSocket#getPeerCertificate().fingerprint256
  // returns during a real handshake, so pinning is a plain string compare.
  const fingerprint = new crypto.X509Certificate(pems.cert).fingerprint256;
  return { certPem: pems.cert, keyPem: pems.private, fingerprint };
}

// configDir lets a caller outside this package (the desktop app, which
// isn't installed at a fixed location the way the headless agent is)
// point at a specific folder instead — e.g. the headless agent's own
// install dir, so a machine that already ran it keeps the same token
// instead of every paired phone needing to re-pair. Every function here
// defaults to the plain agent's own folder when omitted, so nothing
// about the headless agent's behavior changes.
function configPathFor(configDir) {
  return path.join(configDir || DEFAULT_CONFIG_DIR, "config.json");
}

function readConfig(configDir) {
  const configPath = configPathFor(configDir);
  if (!fs.existsSync(configPath)) {
    return null;
  }
  let raw = fs.readFileSync(configPath, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1); // strip BOM
  }
  return JSON.parse(raw);
}

function writeConfig(config, configDir) {
  // No BOM: Node's default utf8 write already omits it, unlike
  // PowerShell's `Set-Content -Encoding UTF8`.
  fs.writeFileSync(configPathFor(configDir), JSON.stringify(config, null, 2), "utf8");
}

function loadOrCreateConfig(configDir) {
  let config = readConfig(configDir);
  let changed = false;
  if (!config) {
    config = {
      token: crypto.randomBytes(24).toString("hex"),
      port: 5544,
    };
    changed = true;
  }
  // Backfills a cert onto a config.json written before HTTPS support existed,
  // so upgrading doesn't wipe the token/paired-device history.
  if (!config.certPem || !config.keyPem || !config.fingerprint) {
    Object.assign(config, generateCert());
    changed = true;
  }
  if (changed) writeConfig(config, configDir);
  return config;
}

module.exports = { loadOrCreateConfig, readConfig, writeConfig, CONFIG_PATH, configPathFor };
