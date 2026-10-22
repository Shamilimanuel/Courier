const http = require("http");
const https = require("https");
const { loadOrCreateConfig } = require("./config");
const { createServer } = require("./server");

process.on("uncaughtException", (err) => {
  // The agent will eventually run hidden with no visible console, so a
  // silent crash here is a nightmare to debug. Fail loud, at least for now.
  console.error("[courier-agent] uncaught exception:", err);
});

const config = loadOrCreateConfig();
const app = createServer(config);

// Two listeners on the same app, on purpose: plain HTTP stays on the
// original port so nothing already paired (the phone app, in particular —
// it can't yet validate a self-signed cert without a native module) sees
// any change at all. A second, HTTPS listener one port up is for clients
// that pin the cert's fingerprint from pairing (currently: the desktop
// app) — no CA, so trust comes from that pinned fingerprint, not from
// chain validation.
const plainServer = http.createServer(app);
plainServer.listen(config.port, "0.0.0.0", () => {
  console.log(`Courier agent listening on http://0.0.0.0:${config.port} (legacy/unencrypted)`);
});
plainServer.requestTimeout = 0;

const securePort = config.port + 1;
const secureServer = https.createServer({ key: config.keyPem, cert: config.certPem }, app);
secureServer.listen(securePort, "0.0.0.0", () => {
  console.log(`Courier agent listening on https://0.0.0.0:${securePort} (pinned, no CA)`);
  console.log(`Pairing token: ${config.token}`);
  console.log(`Fingerprint: ${config.fingerprint}`);
});

// Node defaults requestTimeout to 5 minutes (since v18), which kills any
// upload slower than that — a large file over real Wi-Fi, not loopback,
// can easily take longer. File transfers have no natural time limit.
secureServer.requestTimeout = 0;
