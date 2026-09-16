const os = require("os");
const qrcode = require("qrcode-terminal");
const { loadOrCreateConfig } = require("./config");

function getLanAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

const config = loadOrCreateConfig();
const ip = getLanAddress();
const payload = JSON.stringify({ ip, port: config.port, token: config.token });

console.log(`Address: ${ip}:${config.port}`);
console.log(`Token:   ${config.token}`);
console.log("");
qrcode.generate(payload, { small: true });
