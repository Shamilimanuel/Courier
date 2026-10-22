const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const multer = require("multer");

// Half-received uploads wait in the system's temp folder, never next to this
// code: inside the desktop app's package (app.asar) a folder can't be made at
// all, which crashed the app at start-up (ENOTDIR, 22 Oct), and an install
// under Program Files couldn't be written to.
const STAGING_DIR = process.env.COURIER_STAGING_DIR || path.join(os.tmpdir(), "courier-staging");
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

/** Moves a finished upload into place. rename can't cross drives (a download
 * folder on D:, staging on C:), so then it copies and removes the staged copy. */
function moveFile(from, to, cb) {
  fs.rename(from, to, (err) => {
    if (!err || err.code !== "EXDEV") return cb(err);
    fs.copyFile(from, to, (copyErr) => {
      if (copyErr) return cb(copyErr);
      fs.unlink(from, () => cb(null));
    });
  });
}

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
 * resolved path can't escape destDir — a name like "../../evil" would
 * otherwise write or read outside the Courier folder entirely. */
function safeFileName(name, destDir) {
  const stripped = path.basename(String(name || ""));
  if (!stripped || stripped === "." || stripped === "..") return null;
  const resolved = path.resolve(destDir, stripped);
  if (path.dirname(resolved) !== destDir) return null;
  return stripped;
}

/**
 * `destDir` and `onFileReceived` let a host application (the desktop app)
 * point received files at a user-chosen folder and react when one lands
 * (e.g. a system notification), without the headless agent needing to
 * know either exists — both default to today's plain behavior.
 */
function registerFileRoutes(app, requireAuth, { destDir = DEST_DIR, onFileReceived } = {}) {
  fs.mkdirSync(destDir, { recursive: true });

  app.get("/files", requireAuth, (req, res) => {
    fs.readdir(destDir, { withFileTypes: true }, (err, entries) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      const files = entries
        .filter((e) => e.isFile())
        .map((e) => {
          const stat = fs.statSync(path.join(destDir, e.name));
          return { name: e.name, size: stat.size, mtime: stat.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      res.json({ files });
    });
  });

  app.get("/files/:name", requireAuth, (req, res) => {
    const safeName = safeFileName(req.params.name, destDir);
    const filePath = safeName && path.join(destDir, safeName);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.download(filePath, safeName);
  });

  app.delete("/files/:name", requireAuth, (req, res) => {
    const safeName = safeFileName(req.params.name, destDir);
    const filePath = safeName && path.join(destDir, safeName);
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
    const destPath = path.join(destDir, originalName);
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
      finalName = nextAvailableName(destDir, originalName);
    }
    const finalPath = path.join(destDir, finalName);

    moveFile(stagedPath, finalPath, (err) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      const savedSize = fs.statSync(finalPath).size;
      if (onFileReceived) {
        try {
          onFileReceived({ name: finalName, size: savedSize, from: req.get("X-Courier-From") || null });
        } catch {
          // A notification failing shouldn't fail the upload it's about.
        }
      }
      res.json({
        saved: true,
        name: finalName,
        size: savedSize,
        sizeVerified: savedSize === req.file.size,
      });
    });
  });
}

module.exports = { registerFileRoutes, DEST_DIR, STAGING_DIR, moveFile, nextAvailableName, safeFileName };
