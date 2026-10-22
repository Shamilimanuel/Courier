const express = require("express");
const crypto = require("crypto");
const os = require("os");
const defaultClipboard = require("./clipboard");
const { registerFileRoutes } = require("./files");
const { registerUploadRoutes } = require("./uploads");
const { registerHandshakeRoutes, cleanIp } = require("./handshake");
const { renderPairPage } = require("./pairPage");

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function createServer(config, options = {}) {
  const app = express();
  // Windows-only by default (shells out to PowerShell) — a host app like the
  // desktop Electron shell can pass its own native clipboard implementation
  // here instead, which is also how macOS/Linux get clipboard support at all.
  const getClipboardText = options.getClipboardText || defaultClipboard.getClipboardText;
  const setClipboardText = options.setClipboardText || defaultClipboard.setClipboardText;

  // Only for the local web-preview dev server (a different port than the
  // agent, so the browser treats it as cross-origin). The real Android app
  // isn't subject to CORS at all, so this only ever widens access for
  // requests already coming from this same machine.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && LOCAL_ORIGIN.test(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "10mb" }));

  function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    // A plain <a href> download link can't set a header, so a query param is
    // also accepted — only for reads, and it's the same secret either way.
    const token = header.startsWith("Bearer ") ? header.slice(7) : req.query.token || "";
    if (!token || !timingSafeEqual(String(token), config.token)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    // A paired stop says who it is, so its address can be kept up to date
    // when its Wi-Fi hands it a new one (phones change address often).
    const from = req.get("X-Courier-From");
    if (from && options.onPeerSeen) {
      try {
        options.onPeerSeen({ id: String(from).slice(0, 80), ip: cleanIp(req.socket.remoteAddress) });
      } catch {
        // only bookkeeping
      }
    }
    next();
  }

  /** Who this stop is, as told to other stops. */
  function self() {
    return {
      id: config.id,
      name: options.name || os.hostname(),
      kind: "pc",
      port: config.port,
      securePort: config.port + 1,
      fingerprint: config.fingerprint,
      token: config.token,
    };
  }

  app.get("/health", (req, res) => {
    const interfaces = [];
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === "IPv4" && !net.internal) {
          interfaces.push({ interface: name, ip: net.address });
        }
      }
    }

    res.json({
      // api 2: /uploads (resume), /pair/request and /pair/introduce
      api: 2,
      id: config.id,
      name: options.name || os.hostname(),
      kind: "pc",
      securePort: config.port + 1,
      hostname: os.hostname(),
      uptime: os.uptime(),
      platform: os.platform(),
      port: config.port,
      interfaces,
    });
  });

  // No auth: this is what a QR scan or a browser lands on before the phone
  // has a token to send. Same trust model as /health — anyone on this Wi-Fi
  // can reach it — except this one hands out the actual pairing token, not
  // just status info, so it's a deliberately bigger exposure than /health.
  app.get("/pair", async (req, res) => {
    try {
      const html = await renderPairPage(config);
      res.type("html").send(html);
    } catch (err) {
      res.status(500).send("Could not render the pairing page: " + err.message);
    }
  });

  app.get("/clipboard", requireAuth, async (req, res) => {
    try {
      const text = await getClipboardText();
      res.json({ text });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/clipboard", requireAuth, async (req, res) => {
    const { text, kind } = req.body || {};
    if (typeof text !== "string") {
      res.status(400).json({ error: "text is required" });
      return;
    }
    try {
      await setClipboardText(text);
      if (options.onTextReceived) {
        try {
          options.onTextReceived({ text, kind: kind === "text" ? "text" : "clip", from: req.get("X-Courier-From") || null });
        } catch {
          // a note failing shouldn't fail the clipboard
        }
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  registerFileRoutes(app, requireAuth, options);
  registerUploadRoutes(app, requireAuth, {
    destDir: options.destDir || require("./files").DEST_DIR,
    onFileReceived: options.onFileReceived,
  });
  app.locals.handshake = registerHandshakeRoutes(app, requireAuth, {
    self,
    onPairRequest: options.onPairRequest,
    onIntroduce: options.onIntroduce,
    onPairSettled: options.onPairSettled,
  });

  return app;
}

module.exports = { createServer };
