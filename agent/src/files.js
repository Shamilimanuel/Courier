const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const multer = require("multer");

const STAGING_DIR = path.join(__dirname, "..", "tmp");
const DEST_DIR = path.join(os.homedir(), "Downloads", "Courier");

fs.mkdirSync(STAGING_DIR, { recursive: true });
fs.mkdirSync(DEST_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: STAGING_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString("hex") + ".part"),
  }),
  limits: { fileSize: 8 * 1024 * 1024 * 1024 }, // 8 GB ceiling, not a real target size
});

/** "photo.jpg" -> "photo (1).jpg", "photo (2).jpg", ... — first name not already on disk. */
function nextAvailableName(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  let n = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base} (${n})${ext}`;
    n += 1;
  }
  return candidate;
}

/** Strips any directory parts from a client-supplied name and confirms the
 * resolved path can't escape DEST_DIR — a name like "../../evil" would
 * otherwise write or read outside the Courier folder entirely. */
function safeFileName(name) {
  const stripped = path.basename(String(name || ""));
  if (!stripped || stripped === "." || stripped === "..") return null;
  const resolved = path.resolve(DEST_DIR, stripped);
  if (path.dirname(resolved) !== DEST_DIR) return null;
  return stripped;
}

function registerFileRoutes(app, requireAuth) {
  app.get("/files", requireAuth, (req, res) => {
    fs.readdir(DEST_DIR, { withFileTypes: true }, (err, entries) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      const files = entries
        .filter((e) => e.isFile())
        .map((e) => {
          const stat = fs.statSync(path.join(DEST_DIR, e.name));
          return { name: e.name, size: stat.size, mtime: stat.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      res.json({ files });
    });
  });

  app.get("/files/:name", requireAuth, (req, res) => {
    const safeName = safeFileName(req.params.name);
    const filePath = safeName && path.join(DEST_DIR, safeName);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.download(filePath, safeName);
  });

  app.delete("/files/:name", requireAuth, (req, res) => {
    const safeName = safeFileName(req.params.name);
    const filePath = safeName && path.join(DEST_DIR, safeName);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    fs.unlink(filePath, (err) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ deleted: true });
    });
  });

  app.post("/files", requireAuth, upload.single("file"), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "no file in request" });
      return;
    }

    const stagedPath = req.file.path;
    const originalName = path.basename(req.file.originalname) || "file";
    const onDuplicate = req.body.onDuplicate; // undefined | 'replace' | 'rename' | 'skip'
    const destPath = path.join(DEST_DIR, originalName);
    const exists = fs.existsSync(destPath);

    if (exists && !onDuplicate) {
      // Don't save yet — let the phone decide what to do about the clash.
      fs.unlink(stagedPath, () => {});
      res.status(409).json({
        code: "duplicate",
        existingSize: fs.statSync(destPath).size,
      });
      return;
    }

    if (exists && onDuplicate === "skip") {
      fs.unlink(stagedPath, () => {});
      res.json({ skipped: true });
      return;
    }

    let finalName = originalName;
    if (exists && onDuplicate === "rename") {
      finalName = nextAvailableName(DEST_DIR, originalName);
    }
    const finalPath = path.join(DEST_DIR, finalName);

    fs.rename(stagedPath, finalPath, (err) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      const savedSize = fs.statSync(finalPath).size;
      res.json({
        saved: true,
        name: finalName,
        size: savedSize,
        sizeVerified: savedSize === req.file.size,
      });
    });
  });
}

module.exports = { registerFileRoutes, DEST_DIR };
