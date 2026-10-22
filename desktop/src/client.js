const http = require("http");
const https = require("https");
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/** Outbound calls this PC makes to another stop's agent — a Node port of
 * app/src/lib/api.js + upload.js, same endpoints and the same
 * timeout-with-a-clear-message contract (the phone app's checkHealth()
 * used to hang forever on an unreachable stop; don't repeat that here).
 *
 * Dual-mode per stop: when a stop has both `securePort` and `fingerprint`
 * (every stop paired since encryption support landed, or an older one
 * that's since re-paired), every call here goes over HTTPS on that port,
 * pinned to that fingerprint — no CA, so trust comes from the pin, not
 * chain validation. A stop without them (paired before encryption
 * support existed, or a plain-HTTP-only agent) falls back to the
 * original plain HTTP on its `port`, unchanged from before this existed.
 */

const REQUEST_TIMEOUT_MS = 8000;

// Who this PC is, sent along with every call so the other stop can keep
// this PC's address up to date (X-Courier-From) and say who a file is from.
let selfId = null;
function setSelfId(id) {
  selfId = id;
}
function fromHeader() {
  return selfId ? { "X-Courier-From": selfId } : {};
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Distinct from a real failure, so the UI can show "Cancelled" instead of
 * treating a deliberate stop as an error to retry — mirrors
 * app/src/lib/upload.js's UploadCancelled. */
class UploadCancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "UploadCancelled";
  }
}

/** Picks http-on-port vs https-on-securePort for a given stop. */
function transportFor(stop) {
  if (stop.securePort && stop.fingerprint) {
    return { mod: https, port: stop.securePort, secure: true };
  }
  return { mod: http, port: stop.port, secure: false };
}

/**
 * One-time raw TLS probe used only when pairing without a fingerprint
 * from the QR (manual IP/port/token entry) — captures whatever cert the
 * stop presents on its secure port so it can be pinned from the very
 * next request onward. This one probe is trust-on-first-use, same as
 * SSH's first host-key prompt; every call after it is fingerprint-pinned,
 * not just token-authenticated.
 */
function probeFingerprint(ip, securePort, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: ip, port: Number(securePort), rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const fingerprint = socket.getPeerCertificate().fingerprint256;
      socket.end();
      resolve(fingerprint);
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new ApiError(`Timed out reaching ${ip}:${securePort}.`, 0));
    });
    socket.on("error", (err) => reject(new ApiError(`Could not reach ${ip}:${securePort}. ${err.message}`, 0)));
  });
}

/** Rejects the request the instant the peer cert doesn't match the
 * fingerprint pinned for this stop — before any response body is trusted. */
function pinPeerCertificate(req, stop, reject) {
  req.on("socket", (socket) => {
    socket.once("secureConnect", () => {
      const peerFingerprint = socket.getPeerCertificate().fingerprint256;
      if (peerFingerprint !== stop.fingerprint) {
        const err = new ApiError(
          `The certificate for ${stop.hostname || stop.ip} changed — refusing to connect. Re-pair if this is expected.`,
          0
        );
        req.destroy(err);
        reject(err);
      }
    });
  });
}

function request(stop, urlPath, { method = "GET", headers = {}, body } = {}) {
  const { mod, port, secure } = transportFor(stop);
  return new Promise((resolve, reject) => {
    const options = {
      host: stop.ip,
      port,
      path: urlPath,
      method,
      headers: { Authorization: `Bearer ${stop.token}`, ...fromHeader(), ...headers },
      timeout: REQUEST_TIMEOUT_MS,
      // No connection pooling on the secure path: a pinned request must
      // get its own fresh TLS handshake every time, since the fingerprint
      // check runs off the 'secureConnect' event, which only fires on a
      // genuinely new socket — a reused keep-alive connection would skip it.
      agent: false,
    };
    if (secure) options.rejectUnauthorized = false;

    const req = mod.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode === 401) {
          reject(new ApiError("Pairing token was rejected. Re-pair with this stop.", 401));
          return;
        }
        let json = {};
        try {
          json = data ? JSON.parse(data) : {};
        } catch {
          // fall through with empty body
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(json);
          return;
        }
        const err = new ApiError(json.error || `Request failed (${res.statusCode})`, res.statusCode);
        if (json.existingSize !== undefined) err.existingSize = json.existingSize;
        reject(err);
      });
    });
    if (secure) pinPeerCertificate(req, stop, reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (err) => {
      const timedOut = err.message === "timeout";
      reject(
        new ApiError(
          timedOut
            ? `Timed out reaching ${stop.hostname || stop.ip}:${port}. Is it still on the same Wi-Fi?`
            : `Could not reach ${stop.hostname || stop.ip}:${port}. Is Courier running there?`,
          0
        )
      );
    });
    if (body) req.end(body);
    else req.end();
  });
}

function checkHealth(stop) {
  return request(stop, "/health");
}

/** A short-timeout health check for "is this stop online" — doesn't throw,
 * and treats a fingerprint mismatch the same as unreachable rather than
 * surfacing a scary error just for a status dot. */
function pingHealth(stop, timeoutMs = 2500) {
  const { mod, port, secure } = transportFor(stop);
  return new Promise((resolve) => {
    const options = { host: stop.ip, port, path: "/health", method: "GET", timeout: timeoutMs, agent: false };
    if (secure) options.rejectUnauthorized = false;
    const req = mod.request(options, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    if (secure) {
      req.on("socket", (socket) => {
        socket.once("secureConnect", () => {
          if (socket.getPeerCertificate().fingerprint256 !== stop.fingerprint) req.destroy();
        });
      });
    }
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
    req.end();
  });
}

function getClipboard(stop) {
  return request(stop, "/clipboard").then((r) => r.text);
}

function setClipboard(stop, text) {
  const body = JSON.stringify({ text });
  return request(stop, "/clipboard", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    body,
  });
}

function listFiles(stop) {
  return request(stop, "/files").then((r) => r.files);
}

function deleteFile(stop, name) {
  return request(stop, `/files/${encodeURIComponent(name)}`, { method: "DELETE" });
}

/**
 * Streams a local file to a stop's /files route as multipart/form-data.
 * Streamed rather than buffered so a large file (the agent allows up to
 * 8GB) doesn't have to sit in memory first. Returns { promise, cancel },
 * matching app/src/lib/upload.js's shape, so the caller can abort an
 * in-flight upload without a separate reference to the request.
 */
function uploadFile(stop, filePath, onDuplicate, onProgress) {
  const { mod, port, secure } = transportFor(stop);
  const boundary = "----courier-" + crypto.randomBytes(16).toString("hex");
  const name = path.basename(filePath);
  const stat = fs.statSync(filePath);

  let preamble = "";
  if (onDuplicate) {
    preamble += `--${boundary}\r\nContent-Disposition: form-data; name="onDuplicate"\r\n\r\n${onDuplicate}\r\n`;
  }
  preamble += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const epilogue = `\r\n--${boundary}--\r\n`;
  const preambleBuf = Buffer.from(preamble, "utf8");
  const epilogueBuf = Buffer.from(epilogue, "utf8");
  const totalLength = preambleBuf.length + stat.size + epilogueBuf.length;

  let req;
  let readStream;
  let cancelled = false;

  const promise = new Promise((resolve, reject) => {
    const options = {
      host: stop.ip,
      port,
      path: "/files",
      method: "POST",
      headers: {
        Authorization: `Bearer ${stop.token}`,
        ...fromHeader(),
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": totalLength,
      },
      agent: false,
    };
    if (secure) options.rejectUnauthorized = false;

    req = mod.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let json = {};
        try {
          json = data ? JSON.parse(data) : {};
        } catch {
          // fall through with empty body
        }
        if (res.statusCode === 409 && json.code === "duplicate") {
          resolve({ duplicate: true, existingSize: json.existingSize });
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(json);
          return;
        }
        reject(new ApiError(json.error || `Upload failed (${res.statusCode})`, res.statusCode));
      });
    });
    if (secure) pinPeerCertificate(req, stop, reject);
    req.on("error", (err) => {
      if (cancelled) {
        reject(new UploadCancelled());
        return;
      }
      reject(new ApiError(`Could not reach ${stop.hostname || stop.ip}:${port}. ${err.message}`, 0));
    });

    req.write(preambleBuf);
    let sent = preambleBuf.length;
    readStream = fs.createReadStream(filePath);
    readStream.on("data", (chunk) => {
      sent += chunk.length;
      if (onProgress) onProgress({ loaded: sent, total: totalLength });
    });
    readStream.on("error", (err) => req.destroy(err));
    readStream.on("end", () => req.end(epilogueBuf));
    readStream.pipe(req, { end: false });
  });

  const cancel = () => {
    cancelled = true;
    readStream?.destroy();
    req?.destroy();
  };

  return { promise, cancel };
}

/** Downloads a file from a stop's /files/:name route to a local path,
 * streamed — the counterpart of uploadFile, for pulling a file that
 * landed on a different stop down onto this PC. */
function downloadFile(stop, name, destPath) {
  const { mod, port, secure } = transportFor(stop);
  return new Promise((resolve, reject) => {
    const options = {
      host: stop.ip,
      port,
      path: `/files/${encodeURIComponent(name)}`,
      method: "GET",
      headers: { Authorization: `Bearer ${stop.token}` },
      agent: false,
    };
    if (secure) options.rejectUnauthorized = false;

    const req = mod.request(options, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new ApiError(`Download failed (${res.statusCode})`, res.statusCode));
        return;
      }
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      out.on("finish", () => out.close(() => resolve(destPath)));
      out.on("error", reject);
    });
    if (secure) pinPeerCertificate(req, stop, reject);
    req.on("error", (err) =>
      reject(new ApiError(`Could not reach ${stop.hostname || stop.ip}:${port}. ${err.message}`, 0))
    );
    req.end();
  });
}

function sendJson(stop, urlPath, method, payload) {
  const body = JSON.stringify(payload);
  return request(stop, urlPath, {
    method,
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    body,
  });
}

/** Sends a message (kind "text") or this PC's clipboard (kind "clip"):
 * both land on the other stop's clipboard, and a phone shows a note. */
function sendText(stop, text, kind) {
  return sendJson(stop, "/clipboard", "POST", { text, kind });
}

/**
 * Sends a file in a way that survives the Wi-Fi dropping out: the other
 * stop keeps what arrived (see agent/src/uploads.js), and this asks it
 * "how far did you get?" and carries on from there, a few times with a
 * growing pause, before giving up. `resume` is the { uploadId } from an
 * earlier try that gave up; passing it carries on from where that one
 * stopped instead of starting over.
 *
 * Returns { promise, cancel }. Progress reports { loaded, total,
 * reconnecting, uploadId }. A stop that doesn't know /uploads yet (an
 * older Courier) gets the old all-at-once upload instead.
 */
function sendFile(stop, filePath, { onDuplicate, onProgress, resume } = {}) {
  const name = path.basename(filePath);
  const size = fs.statSync(filePath).size;
  const RETRIES = 8;
  let cancelled = false;
  let inFlight = null; // { req, stream } of the PUT going on now
  let fallback = null;
  let uploadId = resume?.uploadId || null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function put(offset) {
    const { mod, port, secure } = transportFor(stop);
    return new Promise((resolve, reject) => {
      const options = {
        host: stop.ip,
        port,
        path: `/uploads/${uploadId}?offset=${offset}`,
        method: "PUT",
        headers: {
          Authorization: `Bearer ${stop.token}`,
          ...fromHeader(),
          "Content-Type": "application/octet-stream",
          "Content-Length": size - offset,
        },
        agent: false,
      };
      if (secure) options.rejectUnauthorized = false;
      const req = mod.request(options, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = {};
          try {
            json = data ? JSON.parse(data) : {};
          } catch {
            // fall through with an empty body
          }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else if (res.statusCode === 409 && typeof json.offset === "number") resolve({ moveTo: json.offset });
          else {
            const err = new ApiError(json.error || `Upload failed (${res.statusCode})`, res.statusCode);
            err.fatal = [400, 401, 404].includes(res.statusCode);
            reject(err);
          }
        });
      });
      if (secure) pinPeerCertificate(req, stop, reject);
      req.on("error", (err) => reject(err));
      const stream = fs.createReadStream(filePath, { start: offset });
      inFlight = { req, stream };
      let sent = offset;
      stream.on("data", (chunk) => {
        sent += chunk.length;
        if (onProgress) onProgress({ loaded: sent, total: size, uploadId });
      });
      stream.on("error", (err) => req.destroy(err));
      stream.pipe(req);
    });
  }

  const promise = (async () => {
    if (!uploadId) {
      let created;
      try {
        created = await sendJson(stop, "/uploads", "POST", { name, size, onDuplicate });
      } catch (err) {
        if (err.status === 404) {
          // An older Courier on the other side: the old way, all at once.
          fallback = uploadFile(stop, filePath, onDuplicate, onProgress);
          return fallback.promise;
        }
        if (err.status === 409) return { duplicate: true, existingSize: err.existingSize || 0 };
        throw err;
      }
      if (created.skipped) return { skipped: true };
      uploadId = created.uploadId;
    }

    let offset = 0;
    let failures = 0;
    if (resume?.uploadId) offset = (await request(stop, `/uploads/${uploadId}`)).offset;

    for (;;) {
      if (cancelled) throw new UploadCancelled();
      try {
        const result = await put(offset);
        if (result.moveTo !== undefined) {
          offset = result.moveTo;
          continue;
        }
        if (result.saved || result.skipped) return result;
        offset = result.offset;
        failures = 0;
      } catch (err) {
        if (cancelled) throw new UploadCancelled();
        if (err.fatal || failures >= RETRIES) {
          err.uploadId = uploadId;
          throw err;
        }
        failures++;
        if (onProgress) onProgress({ loaded: offset, total: size, uploadId, reconnecting: true });
        await sleep(Math.min(1000 * 2 ** (failures - 1), 15000));
        try {
          offset = (await request(stop, `/uploads/${uploadId}`)).offset;
        } catch (e) {
          if (e.status === 404) throw e;
          // still unreachable: the next PUT fails fast or carries on
        }
      }
    }
  })();

  const cancel = () => {
    cancelled = true;
    fallback?.cancel();
    inFlight?.stream.destroy();
    inFlight?.req.destroy();
    if (uploadId) request(stop, `/uploads/${uploadId}`, { method: "DELETE" }).catch(() => {});
  };

  return { promise, cancel };
}

/** Asks a stop found on the Wi-Fi to pair; it shows a code and Allow. No
 * token yet, so plain HTTP on its normal port. */
function pairRequest(target, me) {
  return plainJson(target, "/pair/request", "POST", me);
}

function pairStatus(target, requestId) {
  return plainJson(target, `/pair/request/${requestId}`, "GET");
}

/** After pairing by QR code or by hand: tells the other stop how to reach
 * this PC back, so it can send here too. */
function introduce(stop, me) {
  return sendJson(stop, "/pair/introduce", "POST", me);
}

function plainJson(target, urlPath, method, payload) {
  const body = payload ? JSON.stringify(payload) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: target.ip,
        port: target.port,
        path: urlPath,
        method,
        headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {},
        timeout: REQUEST_TIMEOUT_MS,
        agent: false,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = {};
          try {
            json = data ? JSON.parse(data) : {};
          } catch {
            // fall through with an empty body
          }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new ApiError(json.error || `Request failed (${res.statusCode})`, res.statusCode));
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => reject(new ApiError(`Could not reach ${target.name || target.ip}. Is it still on this Wi-Fi?`, 0)));
    req.end(body || undefined);
  });
}

module.exports = {
  setSelfId,
  sendText,
  sendFile,
  pairRequest,
  pairStatus,
  introduce,
  ApiError,
  UploadCancelled,
  probeFingerprint,
  checkHealth,
  pingHealth,
  getClipboard,
  setClipboard,
  listFiles,
  deleteFile,
  uploadFile,
  downloadFile,
};
