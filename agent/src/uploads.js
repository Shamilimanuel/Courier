const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { STAGING_DIR, moveFile, nextAvailableName, safeFileName } = require("./files");

/**
 * Uploads that survive a dropped connection. Instead of one big POST that
 * has to start over when the Wi-Fi blinks, a sender:
 *
 *   POST   /uploads            { name, size, onDuplicate? } -> { uploadId, offset: 0 }
 *   PUT    /uploads/:id?offset=N   raw bytes from N on        -> { offset } or the saved file
 *   GET    /uploads/:id                                        -> { offset, size }   "how far did you get?"
 *   DELETE /uploads/:id                                        -> gives up, removes the half file
 *
 * The half-received file waits in the staging folder as <id>.part with a
 * <id>.json beside it, so it even survives this PC restarting. Half files
 * nobody came back for are removed after a day. The old POST /files stays
 * for senders that don't know this yet.
 */

const PARTIALS_DIR = path.join(STAGING_DIR, "partials");
const MAX_SIZE = 8 * 1024 * 1024 * 1024;
const KEEP_MS = 24 * 60 * 60 * 1000;

fs.mkdirSync(PARTIALS_DIR, { recursive: true });

const partPath = (id) => path.join(PARTIALS_DIR, id + ".part");
const metaPath = (id) => path.join(PARTIALS_DIR, id + ".json");

function readMeta(id) {
  if (!/^[a-f0-9]{32}$/.test(String(id))) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath(id), "utf8"));
  } catch {
    return null;
  }
}

function partSize(id) {
  try {
    return fs.statSync(partPath(id)).size;
  } catch {
    return -1;
  }
}

function removePartial(id) {
  fs.rm(partPath(id), { force: true }, () => {});
  fs.rm(metaPath(id), { force: true }, () => {});
}

function sweepOldPartials() {
  let names = [];
  try {
    names = fs.readdirSync(PARTIALS_DIR);
  } catch {
    return;
  }
  const cutoff = Date.now() - KEEP_MS;
  for (const name of names) {
    const full = path.join(PARTIALS_DIR, name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true });
    } catch {
      // gone already
    }
  }
}

function registerUploadRoutes(app, requireAuth, { destDir, onFileReceived } = {}) {
  sweepOldPartials();
  const sweeper = setInterval(sweepOldPartials, 60 * 60 * 1000);
  sweeper.unref();
  // One PUT at a time per upload: a sender that reconnects while its old,
  // dying connection is still writing would otherwise interleave bytes.
  const busy = new Set();

  app.post("/uploads", requireAuth, (req, res) => {
    const { name, size, onDuplicate } = req.body || {};
    const safeName = safeFileName(name, destDir);
    const total = Number(size);
    if (!safeName) return res.status(400).json({ error: "a file name is required" });
    if (!Number.isSafeInteger(total) || total < 0 || total > MAX_SIZE) return res.status(400).json({ error: "size must be 0 to 8 GB" });
    if (onDuplicate && !["replace", "rename", "skip"].includes(onDuplicate)) return res.status(400).json({ error: "bad onDuplicate" });

    const destPath = path.join(destDir, safeName);
    if (fs.existsSync(destPath)) {
      if (!onDuplicate) return res.status(409).json({ code: "duplicate", existingSize: fs.statSync(destPath).size });
      if (onDuplicate === "skip") return res.json({ skipped: true });
    }

    const uploadId = crypto.randomBytes(16).toString("hex");
    const meta = { name: safeName, size: total, onDuplicate: onDuplicate || null, from: req.get("X-Courier-From") || null, created: Date.now() };
    fs.writeFileSync(partPath(uploadId), "");
    fs.writeFileSync(metaPath(uploadId), JSON.stringify(meta));
    res.json({ uploadId, offset: 0, size: total });
  });

  app.get("/uploads/:id", requireAuth, (req, res) => {
    const meta = readMeta(req.params.id);
    const offset = meta ? partSize(req.params.id) : -1;
    if (!meta || offset < 0) return res.status(404).json({ error: "That upload is gone. Send the file again." });
    res.json({ offset, size: meta.size });
  });

  app.delete("/uploads/:id", requireAuth, (req, res) => {
    if (readMeta(req.params.id)) removePartial(req.params.id);
    res.json({ deleted: true });
  });

  app.put("/uploads/:id", requireAuth, (req, res) => {
    const id = req.params.id;
    const meta = readMeta(id);
    const have = meta ? partSize(id) : -1;
    if (!meta || have < 0) return res.status(404).json({ error: "That upload is gone. Send the file again." });
    if (busy.has(id)) return res.status(409).json({ code: "busy", offset: have });
    const offset = Number(req.query.offset);
    if (offset !== have) {
      // The sender thinks it is somewhere else: tell it where to carry on.
      req.resume();
      return res.status(409).json({ code: "offset", offset: have });
    }

    busy.add(id);
    let received = have;
    let failed = false;
    const out = fs.createWriteStream(partPath(id), { flags: "a" });

    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > meta.size && !failed) {
        failed = true;
        req.unpipe(out);
        out.end();
        busy.delete(id);
        // Answer first, then hang up, so the sender reads why.
        res.setHeader("Connection", "close");
        res.on("finish", () => req.destroy());
        res.status(400).json({ error: "more bytes than the size given" });
      }
    });
    // A dropped connection just leaves the bytes that arrived so far: the
    // sender asks GET /uploads/:id and carries on from there.
    req.on("close", () => {
      if (req.complete || failed) return;
      failed = true;
      req.unpipe(out);
      out.end();
    });
    out.on("close", () => {
      busy.delete(id);
      if (failed) return;
      const now = partSize(id);
      if (now < meta.size) return res.json({ offset: now, size: meta.size });
      finish(id, meta, res);
    });
    out.on("error", (err) => {
      failed = true;
      busy.delete(id);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    req.pipe(out);
  });

  function finish(id, meta, res) {
    let finalName = meta.name;
    const destPath = path.join(destDir, finalName);
    if (fs.existsSync(destPath)) {
      // A file with that name appeared while this one was on its way: keep
      // both unless the sender asked to replace.
      if (meta.onDuplicate !== "replace") finalName = nextAvailableName(destDir, finalName);
    }
    const finalPath = path.join(destDir, finalName);
    moveFile(partPath(id), finalPath, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      fs.rm(metaPath(id), { force: true }, () => {});
      const savedSize = fs.statSync(finalPath).size;
      if (onFileReceived) {
        try {
          onFileReceived({ name: finalName, size: savedSize, from: meta.from });
        } catch {
          // A notification failing shouldn't fail the upload it's about.
        }
      }
      res.json({ saved: true, name: finalName, size: savedSize, sizeVerified: savedSize === meta.size });
    });
  }
}

module.exports = { registerUploadRoutes, PARTIALS_DIR };
