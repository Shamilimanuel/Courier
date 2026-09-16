const qrcode = require("qrcode-terminal");
const { loadOrCreateConfig } = require("./config");
const { pairingUrl, getLanAddress } = require("./pairPage");

const config = loadOrCreateConfig();
const ip = getLanAddress();
const url = pairingUrl(config);

console.log(`Address: ${ip}:${config.port}`);
console.log(`Token:   ${config.token}`);
console.log("");
console.log("Scan with Courier's in-app scanner, or with any camera app --");
console.log("the same code opens a download link if it isn't installed yet.");
console.log("");
qrcode.generate(url, { small: true });
