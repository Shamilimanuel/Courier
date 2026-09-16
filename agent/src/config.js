const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CONFIG_PATH = path.join(__dirname, "..", "config.json");

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return null;
  }
  let raw = fs.readFileSync(CONFIG_PATH, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1); // strip BOM
  }
  return JSON.parse(raw);
}

function writeConfig(config) {
  // No BOM: Node's default utf8 write already omits it, unlike
  // PowerShell's `Set-Content -Encoding UTF8`.
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

function loadOrCreateConfig() {
  let config = readConfig();
  if (!config) {
    config = {
      token: crypto.randomBytes(24).toString("hex"),
      port: 5544,
    };
    writeConfig(config);
  }
  return config;
}

module.exports = { loadOrCreateConfig, readConfig, writeConfig, CONFIG_PATH };
