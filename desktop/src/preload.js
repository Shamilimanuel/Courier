const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("courier", {
  listStops: () => ipcRenderer.invoke("stops:list"),
  addStop: (draft) => ipcRenderer.invoke("stops:add", draft),
  removeStop: (id) => ipcRenderer.invoke("stops:remove", id),
  pingStop: (stop) => ipcRenderer.invoke("stops:ping", stop),

  startUpload: (uploadId, stopId, filePath, onDuplicate) =>
    ipcRenderer.send("upload:start", { uploadId, stopId, filePath, onDuplicate }),
  cancelUpload: (uploadId) => ipcRenderer.send("upload:cancel", uploadId),
  onUploadProgress: (cb) => ipcRenderer.on("upload:progress", (_e, data) => cb(data)),
  onUploadDone: (cb) => ipcRenderer.on("upload:done", (_e, data) => cb(data)),
  onUploadCancelled: (cb) => ipcRenderer.on("upload:cancelled", (_e, data) => cb(data)),
  onUploadError: (cb) => ipcRenderer.on("upload:error", (_e, data) => cb(data)),

  sendClipboard: (stopId) => ipcRenderer.invoke("send:clipboard", stopId),
  sendText: (stopId, text) => ipcRenderer.invoke("send:text", stopId, text),
  pullClipboard: (stopId) => ipcRenderer.invoke("pull:clipboard", stopId),

  listLocalFiles: () => ipcRenderer.invoke("local:list"),
  openLocalFile: (name) => ipcRenderer.invoke("local:open", name),
  showLocalFile: (name) => ipcRenderer.invoke("local:show", name),
  openLocalFolder: () => ipcRenderer.invoke("local:openFolder"),
  deleteLocalFile: (name) => ipcRenderer.invoke("local:delete", name),

  listRemoteFiles: (stopId) => ipcRenderer.invoke("remote:list", stopId),
  saveRemoteFile: (stopId, name) => ipcRenderer.invoke("remote:save", stopId, name),
  deleteRemoteFile: (stopId, name) => ipcRenderer.invoke("remote:delete", stopId, name),

  getHistory: () => ipcRenderer.invoke("history:list"),

  getOwnPairingInfo: () => ipcRenderer.invoke("pairing:info"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  chooseDownloadFolder: () => ipcRenderer.invoke("settings:chooseFolder"),
  getAppVersion: () => ipcRenderer.invoke("app:version"),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  quitApp: () => ipcRenderer.invoke("app:quit"),

  platform: process.platform,
  setTitleBar: (colors) => ipcRenderer.send("app:titleBar", colors),

  pathForFile: (file) => webUtils.getPathForFile(file),

  onNavigate: (cb) => ipcRenderer.on("navigate", (_e, tab) => cb(tab)),
  onTextArrived: (cb) => ipcRenderer.on("text:arrived", (_e, t) => cb(t)),
  onToast: (cb) => ipcRenderer.on("toast", (_e, t) => cb(t)),
  onStopsChanged: (cb) => ipcRenderer.on("stops:changed", () => cb()),

  discoverStart: () => ipcRenderer.invoke("discover:start"),
  onDiscovered: (cb) => ipcRenderer.on("discover:list", (_e, list) => cb(list)),
  pairAsk: (target) => ipcRenderer.invoke("pair:ask", target),
  pairAskCancel: () => ipcRenderer.invoke("pair:askCancel"),
  onPairAsked: (cb) => ipcRenderer.on("pair:asked", (_e, r) => cb(r)),
  pairIncomingList: () => ipcRenderer.invoke("pair:incomingList"),
  pairAnswer: (requestId, allow) => ipcRenderer.invoke("pair:answer", requestId, allow),
  onPairIncoming: (cb) => ipcRenderer.on("pair:incoming", (_e, r) => cb(r)),
  onPairSettled: (cb) => ipcRenderer.on("pair:settled", (_e, r) => cb(r)),

  onFileArrived: (cb) => ipcRenderer.on("file:arrived", (_e, file) => cb(file)),
  onPreselectFile: (cb) => ipcRenderer.on("preselect-file", (_e, filePath) => cb(filePath)),
});
