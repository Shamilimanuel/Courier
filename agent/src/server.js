const express = require("express");
const crypto = require("crypto");
const os = require("os");
const { getClipboardText, setClipboardText } = require("./clipboard");
const { registerFileRoutes } = require("./files");
const { renderPairPage } = require("./pairPage");

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function createServer(config) {
  const app = express();

  // Only for the local web-preview dev server (a different port than the
  // agent, so the browser treats it as cross-origin). The real Android app
  // isn't subject to CORS at all, so this only ever widens access for
  // requests already coming from this same machine.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && LOCAL_ORIGIN.test(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token || !timingSafeEqual(token, config.token)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
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
    const { text } = req.body || {};
    if (typeof text !== "string") {
      res.status(400).json({ error: "text is required" });
      return;
    }
    try {
      await setClipboardText(text);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  registerFileRoutes(app, requireAuth);

  return app;
}

module.exports = { createServer };
