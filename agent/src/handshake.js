const crypto = require("crypto");

/**
 * Pairing without a QR code: a phone (or another PC) that found this stop
 * on the Wi-Fi asks to pair, both screens show the same 4-digit code, and
 * the person clicks Allow here. Pairing is mutual: the asker sends its own
 * address and token along, so once allowed this stop can send to it too
 * (that is how the PC pushes files to a phone).
 *
 *   POST /pair/request        { id, name, kind, port, token, securePort?, fingerprint? }
 *                             -> { requestId, code }        (no token needed: that's the point)
 *   GET  /pair/request/:id    -> { state: "waiting" | "allowed" | "denied" | "expired", stop? }
 *   POST /pair/introduce      the same body, with this stop's token: "I paired with your QR
 *                             code; here's how to reach me back"
 *
 * The host app decides: onPairRequest(request) shows Allow / Deny, and the
 * answer comes back through answer(requestId, allow). A stop without that
 * callback (the headless agent) only pairs by QR code.
 */

const REQUEST_TTL_MS = 2 * 60 * 1000;
const MAX_PENDING = 3;
const MAX_PER_MINUTE = 6;

function cleanIp(ip) {
  return String(ip || "").replace(/^::ffff:/, "");
}

/** Checks and trims what another stop says about itself. */
function readPeer(body, ip) {
  const b = body || {};
  const str = (v, max) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
  const id = str(b.id, 80);
  const name = str(b.name, 80);
  const token = str(b.token, 200);
  const port = Number(b.port);
  if (!id || !name || !token || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const peer = { id, name, kind: b.kind === "phone" ? "phone" : "pc", ip: cleanIp(ip), port, token };
  const securePort = Number(b.securePort);
  const fingerprint = str(b.fingerprint, 200);
  if (Number.isInteger(securePort) && securePort > 0 && securePort < 65536 && fingerprint) {
    peer.securePort = securePort;
    peer.fingerprint = fingerprint;
  }
  return peer;
}

function registerHandshakeRoutes(app, requireAuth, { self, onPairRequest, onIntroduce, onPairSettled } = {}) {
  const requests = new Map();
  const recent = [];

  function expireOld() {
    const now = Date.now();
    for (const [id, r] of requests) {
      if (r.state === "waiting" && now - r.at > REQUEST_TTL_MS) {
        r.state = "expired";
        if (onPairSettled) onPairSettled(r.requestId, "expired");
      }
      if (now - r.at > REQUEST_TTL_MS * 2) requests.delete(id);
    }
  }

  app.post("/pair/request", (req, res) => {
    expireOld();
    if (!onPairRequest) return res.status(403).json({ error: "This stop pairs by QR code only." });
    const peer = readPeer(req.body, req.socket.remoteAddress);
    if (!peer) return res.status(400).json({ error: "Missing who is asking." });

    const now = Date.now();
    while (recent.length && now - recent[0] > 60 * 1000) recent.shift();
    const waiting = [...requests.values()].filter((r) => r.state === "waiting");
    if (recent.length >= MAX_PER_MINUTE || waiting.length >= MAX_PENDING) {
      return res.status(429).json({ error: "Too many pairing requests. Wait a minute." });
    }
    recent.push(now);

    // The same asker trying again replaces its own earlier request.
    for (const r of waiting) {
      if (r.peer.id === peer.id) {
        r.state = "expired";
        if (onPairSettled) onPairSettled(r.requestId, "expired");
      }
    }

    const requestId = crypto.randomBytes(16).toString("hex");
    const code = String(crypto.randomInt(0, 10000)).padStart(4, "0");
    const request = { requestId, code, peer, state: "waiting", at: now };
    requests.set(requestId, request);
    onPairRequest({ requestId, code, peer });
    res.json({ requestId, code });
  });

  app.get("/pair/request/:id", (req, res) => {
    expireOld();
    const r = requests.get(String(req.params.id));
    if (!r) return res.json({ state: "expired" });
    if (r.state !== "allowed") return res.json({ state: r.state });
    // Handed out once: the token only goes to the asker that holds this id.
    requests.delete(r.requestId);
    res.json({ state: "allowed", stop: self() });
  });

  app.post("/pair/introduce", requireAuth, (req, res) => {
    const peer = readPeer(req.body, req.socket.remoteAddress);
    if (!peer) return res.status(400).json({ error: "Missing who is asking." });
    if (onIntroduce) onIntroduce(peer);
    const me = self();
    res.json({ id: me.id, name: me.name, kind: me.kind });
  });

  return {
    /** The person clicked Allow (true) or Deny (false). Returns the asker
     * when allowed, so the host can add it to its own stops. */
    answer(requestId, allow) {
      expireOld();
      const r = requests.get(requestId);
      if (!r || r.state !== "waiting") return null;
      r.state = allow ? "allowed" : "denied";
      return allow ? r.peer : null;
    },
  };
}

module.exports = { registerHandshakeRoutes, cleanIp };
