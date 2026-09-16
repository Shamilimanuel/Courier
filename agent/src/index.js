const { loadOrCreateConfig } = require("./config");
const { createServer } = require("./server");

process.on("uncaughtException", (err) => {
  // The agent will eventually run hidden with no visible console, so a
  // silent crash here is a nightmare to debug. Fail loud, at least for now.
  console.error("[courier-agent] uncaught exception:", err);
});

const config = loadOrCreateConfig();
const app = createServer(config);

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Courier agent listening on 0.0.0.0:${config.port}`);
  console.log(`Pairing token: ${config.token}`);
});

// Node defaults requestTimeout to 5 minutes (since v18), which kills any
// upload slower than that — a large file over real Wi-Fi, not loopback,
// can easily take longer. File transfers have no natural time limit.
server.requestTimeout = 0;
