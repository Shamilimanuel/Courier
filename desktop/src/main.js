const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, Notification, shell, nativeImage, clipboard } = require("electron");
const http = require("http");
const https = require("https");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");

const { createServer } = require("courier-agent/src/server");
const { loadOrCreateConfig, writeConfig } = require("courier-agent/src/config");
const { pairingUrl, getLanAddress } = require("courier-agent/src/pairPage");
const { DEST_DIR: DEFAULT_DEST_DIR } = require("courier-agent/src/files");
const QRCode = require("qrcode");

const isWindows = process.platform === "win32";
const isLinux = process.platform === "linux";

// Electron's clipboard module is native and works identically on every
// platform — used instead of the headless agent's default PowerShell-based
// implementation (Windows-only, and slower: a process spawn per call).
async function readClipboard() {
  return clipboard.readText();
}
async function writeClipboard(text) {
  clipboard.writeText(text);
}

const stops = require("./stops");
const client = require("./client");
const history = require("./history");

// A machine that already ran the headless agent (installed by setup.ps1 to
// %LOCALAPPDATA%\Courier) has phones paired to a token stored there. Reuse
// that same config.json when it exists so re-pairing isn't needed; a fresh
// machine gets its own config under Electron's normal per-app userData dir.
const LEGACY_CONFIG_DIR = path.join(os.homedir(), "AppData", "Local", "Courier");
const LEGACY_TASK_NAME = "CourierAgent";
const EXPLORER_KEY = "Software\\Classes\\*\\shell\\SendWithCourier";

function resolveConfigDir() {
  if (fs.existsSync(path.join(LEGACY_CONFIG_DIR, "config.json"))) return LEGACY_CONFIG_DIR;
  return app.getPath("userData");
}

let config;
let configDir;
let plainServer;
let secureServer;
let win;
let tray;

function selfStop() {
  // Loopback calls dogfood the same pinned HTTPS path a real remote stop
  // would use, since this PC always has both listeners running itself.
  return {
    ip: "127.0.0.1",
    port: config.port,
    securePort: config.port + 1,
    token: config.token,
    fingerprint: config.fingerprint,
    hostname: os.hostname(),
  };
}

function notifyFileReceived(file) {
  history.addHistoryEntry({ name: file.name, size: file.size, direction: "received", hostname: "" });
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: "Courier", body: `New file: ${file.name}` });
  n.on("click", () => {
    showWindow();
    win.webContents.send("navigate", "receive");
  });
  n.show();
}

function startServer() {
  if (plainServer) plainServer.close();
  if (secureServer) secureServer.close();

  const expressApp = createServer(config, {
    destDir: config.destDir || undefined,
    onFileReceived: notifyFileReceived,
    getClipboardText: readClipboard,
    setClipboardText: writeClipboard,
  });

  // Same dual-listener approach as the headless agent (agent/src/index.js):
  // plain HTTP on the original port so the phone app (no cert-pinning
  // support yet) and the browser /pair flow are untouched, plus a pinned
  // HTTPS listener one port up for clients that support it.
  plainServer = http.createServer(expressApp);
  plainServer.listen(config.port, "0.0.0.0");
  plainServer.requestTimeout = 0;

  secureServer = https.createServer({ key: config.keyPem, cert: config.certPem }, expressApp);
  secureServer.listen(config.port + 1, "0.0.0.0");
  secureServer.requestTimeout = 0;
}

function createWindow() {
  win = new BrowserWindow({
    width: 420,
    height: 680,
    minWidth: 360,
    minHeight: 520,
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
}

function showWindow() {
  if (!win) createWindow();
  win.show();
  win.focus();
}

function createTray() {
  const trayIcon = nativeImage
    .createFromPath(path.join(__dirname, "..", "assets", "icon.png"))
    .resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip("Courier");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Courier", click: showWindow },
      {
        label: "Pair a device",
        click: () => {
          showWindow();
          win.webContents.send("navigate", "pair");
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", showWindow);
}

/** The headless agent (setup.ps1) and this app both bind the same port —
 * running both at once means one loses. Offer to remove the old one.
 * Windows-only concept: the headless agent's Scheduled Task install only
 * exists there. */
function checkLegacyScheduledTask() {
  if (!isWindows) return;
  execFile("schtasks", ["/query", "/tn", LEGACY_TASK_NAME], (err) => {
    if (err) return; // not registered, nothing to do
    // No owner window: this can fire while the window is still hidden at
    // startup, and a dialog parented to a hidden window may not show.
    dialog
      .showMessageBox(null, {
        type: "question",
        buttons: ["Remove it", "Keep both"],
        defaultId: 0,
        title: "Existing Courier agent found",
        message: "A background Courier agent is already set to start at login.",
        detail:
          "Running both at once will fight over the same port. Your pairing token is kept either way.",
      })
      .then((result) => {
        if (result.response !== 0) return;
        execFile("schtasks", ["/end", "/tn", LEGACY_TASK_NAME], () => {
          execFile("schtasks", ["/delete", "/tn", LEGACY_TASK_NAME, "/f"], () => {});
        });
      });
  });
}

/** Adds a per-user (no admin needed) Explorer right-click entry that
 * relaunches this app with --send <path>. Windows only — there's no
 * single equivalent mechanism across Finder/Nautilus/Dolphin/etc., so
 * mac/linux users send via the in-app Send tab or drag-and-drop onto the
 * window instead, which already works identically on every platform. */
function registerExplorerContextMenu() {
  if (!isWindows) return;
  const exe = process.execPath;
  execFile("reg", ["add", `HKCU\\${EXPLORER_KEY}`, "/ve", "/d", "Send with Courier", "/f"], (err) => {
    if (err) return;
    execFile("reg", ["add", `HKCU\\${EXPLORER_KEY}\\command`, "/ve", "/d", `"${exe}" --send "%1"`, "/f"], () => {});
  });
}

/** Electron's setLoginItemSettings covers Windows and macOS but is a no-op
 * on Linux, which has no single OS-level autostart API — write the
 * XDG autostart .desktop file by hand instead. */
function registerLinuxAutostart() {
  if (!isLinux) return;
  const autostartDir = path.join(os.homedir(), ".config", "autostart");
  fs.mkdirSync(autostartDir, { recursive: true });
  const entry = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Courier",
    `Exec="${process.execPath}"`,
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(autostartDir, "courier.desktop"), entry, "utf8");
}

function sendArgFrom(argv) {
  const idx = argv.indexOf("--send");
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : null;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    showWindow();
    const filePath = sendArgFrom(argv);
    if (filePath) win.webContents.send("preselect-file", filePath);
  });

  app.on("window-all-closed", (event) => event.preventDefault());

  app.whenReady().then(() => {
    configDir = resolveConfigDir();
    config = loadOrCreateConfig(configDir);
    stops.init(app.getPath("userData"));
    history.init(app.getPath("userData"));

    startServer();
    createTray();
    createWindow();

    const filePath = sendArgFrom(process.argv);
    if (filePath) {
      // Launched via "Send with Courier" — show the window instead of the
      // usual hidden-in-the-tray start.
      win.webContents.once("did-finish-load", () => win.webContents.send("preselect-file", filePath));
    } else {
      win.once("ready-to-show", () => win.hide()); // starts hidden in the tray, like the headless agent
    }

    app.setLoginItemSettings({ openAtLogin: true });
    registerLinuxAutostart();
    checkLegacyScheduledTask();
    registerExplorerContextMenu();
  });
}

// ---------------------------------------------------------------- IPC ----

ipcMain.handle("stops:list", () => stops.getStops());

ipcMain.handle("stops:add", async (_e, draft) => {
  const securePort = draft.securePort || Number(draft.port) + 1;
  try {
    // A QR pairing already carries the stop's cert fingerprint. Manual
    // entry (typed IP/port/token) doesn't — probe it once so every call
    // from the very next request onward is pinned too, not just
    // token-authenticated.
    const fingerprint = draft.fingerprint || (await client.probeFingerprint(draft.ip, securePort));
    const secureDraft = { ...draft, securePort, fingerprint };
    const health = await client.checkHealth(secureDraft);
    return stops.addStop({ ...secureDraft, hostname: health.hostname });
  } catch {
    // The other side has no HTTPS listener yet (an agent from before
    // encryption support existed) — fall back to the original
    // plain-HTTP-only pairing rather than refusing to pair at all.
    const health = await client.checkHealth(draft);
    return stops.addStop({ ...draft, hostname: health.hostname });
  }
});

ipcMain.handle("stops:remove", (_e, id) => stops.removeStop(id));

ipcMain.handle("stops:ping", (_e, stop) => client.pingHealth(stop));

// Uploads are long-running with progress/cancel, which doesn't fit
// invoke()'s single request/response — start over `send`, progress and
// completion pushed back as events, cancel keyed by the same uploadId.
const activeUploads = new Map();

ipcMain.on("upload:start", (event, { uploadId, stopId, filePath, onDuplicate }) => {
  const sender = event.sender;
  const stop = stops.getStop(stopId);
  if (!stop) {
    sender.send("upload:error", { uploadId, message: "That stop isn't paired anymore." });
    return;
  }
  const { promise, cancel } = client.uploadFile(stop, filePath, onDuplicate, (progress) => {
    sender.send("upload:progress", { uploadId, ...progress });
  });
  activeUploads.set(uploadId, cancel);
  promise
    .then((result) => {
      activeUploads.delete(uploadId);
      if (!result.duplicate) {
        history.addHistoryEntry({
          name: result.name || path.basename(filePath),
          size: result.size,
          direction: "sent",
          hostname: stop.hostname || stop.ip,
          filePath,
        });
      }
      sender.send("upload:done", { uploadId, result });
    })
    .catch((err) => {
      activeUploads.delete(uploadId);
      if (err instanceof client.UploadCancelled) {
        sender.send("upload:cancelled", { uploadId });
      } else {
        sender.send("upload:error", { uploadId, message: err.message });
      }
    });
});

ipcMain.on("upload:cancel", (_e, uploadId) => {
  activeUploads.get(uploadId)?.();
});

ipcMain.handle("send:clipboard", async (_e, stopId) => {
  const stop = stops.getStop(stopId);
  if (!stop) throw new Error("That stop isn't paired anymore.");
  const text = await readClipboard();
  return client.setClipboard(stop, text);
});

ipcMain.handle("send:text", (_e, stopId, text) => {
  const stop = stops.getStop(stopId);
  if (!stop) throw new Error("That stop isn't paired anymore.");
  return client.setClipboard(stop, text);
});

ipcMain.handle("pull:clipboard", (_e, stopId) => {
  const stop = stops.getStop(stopId);
  if (!stop) throw new Error("That stop isn't paired anymore.");
  return client.getClipboard(stop);
});

ipcMain.handle("local:list", () => client.listFiles(selfStop()));

ipcMain.handle("local:open", (_e, name) => {
  const dir = config.destDir || DEFAULT_DEST_DIR;
  return shell.openPath(path.join(dir, name));
});

ipcMain.handle("local:openFolder", () => shell.openPath(config.destDir || DEFAULT_DEST_DIR));

ipcMain.handle("local:delete", (_e, name) => client.deleteFile(selfStop(), name));

// Files waiting on a *different* stop — the same thing the phone app's
// Receive tab shows for whichever stop is active, since this PC can be a
// client to another stop just as readily as its own server.
ipcMain.handle("remote:list", (_e, stopId) => {
  const stop = stops.getStop(stopId);
  if (!stop) throw new Error("That stop isn't paired anymore.");
  return client.listFiles(stop);
});

ipcMain.handle("remote:save", async (_e, stopId, name) => {
  const stop = stops.getStop(stopId);
  if (!stop) throw new Error("That stop isn't paired anymore.");
  const dir = config.destDir || DEFAULT_DEST_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const destPath = path.join(dir, name);
  await client.downloadFile(stop, name, destPath);
  history.addHistoryEntry({ name, direction: "received", hostname: stop.hostname || stop.ip, filePath: destPath });
  return destPath;
});

ipcMain.handle("remote:delete", (_e, stopId, name) => {
  const stop = stops.getStop(stopId);
  if (!stop) throw new Error("That stop isn't paired anymore.");
  return client.deleteFile(stop, name);
});

ipcMain.handle("history:list", () => history.getHistory());

ipcMain.handle("app:version", () => app.getVersion());

ipcMain.handle("app:openExternal", (_e, url) => shell.openExternal(url));

ipcMain.handle("pairing:info", async () => {
  const url = pairingUrl(config);
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });
  return {
    hostname: os.hostname(),
    ip: getLanAddress(),
    port: config.port,
    token: config.token,
    fingerprint: config.fingerprint,
    qrDataUrl,
  };
});

ipcMain.handle("settings:get", () => ({
  destDir: config.destDir || DEFAULT_DEST_DIR,
  hostname: os.hostname(),
}));

ipcMain.handle("settings:chooseFolder", async () => {
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  config.destDir = result.filePaths[0];
  writeConfig(config, configDir);
  startServer();
  return config.destDir;
});

ipcMain.handle("app:quit", () => {
  app.isQuitting = true;
  app.quit();
});
