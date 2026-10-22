(function () {
  const state = { stops: [], activeStopId: null, items: [] };
  let nextItemId = 1;

  const $ = (id) => document.getElementById(id);

  function showToast(msg) {
    const toast = $("toast");
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function formatBytes(n) {
    if (n < 1024) return n + " B";
    const units = ["KB", "MB", "GB"];
    let u = 0, v = n / 1024;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
    return v.toFixed(v < 10 ? 1 : 0) + " " + units[u];
  }

  function relativeTime(at) {
    const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + "m";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "h";
    return Math.floor(hours / 24) + "d";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function fileName(filePath) {
    return filePath.split(/[\\/]/).pop();
  }

  // ---------------------------------------------------------------- tabs --
  function switchTab(name) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("hidden", p.id !== "panel-" + name));
    if (name === "receive") { loadLocalFiles(); loadRemoteFiles(); }
    if (name === "pair") { loadPairingInfo(); renderStopsList(); }
  }
  $("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (btn) switchTab(btn.dataset.tab);
  });

  // --------------------------------------------------------------- stops --
  async function loadStops() {
    state.stops = await window.courier.listStops();
    if (!state.activeStopId && state.stops[0]) state.activeStopId = state.stops[0].id;
    renderStops();
    state.stops.forEach(pingAndMark);
  }

  async function pingAndMark(stop) {
    const online = await window.courier.pingStop(stop);
    const dot = document.querySelector(`.chip[data-id="${stop.id}"] .dot`);
    if (dot) dot.className = "dot " + (online ? "online" : "offline");
  }

  function renderStops() {
    const row = $("stopsRow");
    row.innerHTML = "";
    state.stops.forEach((stop) => {
      const chip = document.createElement("div");
      chip.className = "chip" + (stop.id === state.activeStopId ? " active" : "");
      chip.dataset.id = stop.id;
      chip.innerHTML = `<span class="dot"></span><span>${escapeHtml(stop.hostname || stop.ip)}</span>`;
      chip.addEventListener("click", () => {
        state.activeStopId = stop.id;
        renderStops();
        sendPendingItems(stop);
        if (!document.getElementById("panel-receive").classList.contains("hidden")) loadRemoteFiles();
      });
      row.appendChild(chip);
    });
    const addChip = document.createElement("div");
    addChip.className = "chip addChip";
    addChip.textContent = "+ Add a stop";
    addChip.addEventListener("click", () => switchTab("pair"));
    row.appendChild(addChip);
  }

  function renderStopsList() {
    const list = $("stopsList");
    if (!state.stops.length) { list.innerHTML = '<div class="empty">No stops paired yet</div>'; return; }
    list.innerHTML = state.stops.map((s) => `
      <div class="fileRow" data-id="${s.id}">
        <div class="fileName">${escapeHtml(s.hostname || s.ip)}</div>
        <div class="fileMeta">${escapeHtml(s.ip)}:${escapeHtml(s.port)}</div>
        <button class="removeStopBtn">Forget</button>
      </div>`).join("");
  }
  $("stopsList").addEventListener("click", async (e) => {
    if (!e.target.classList.contains("removeStopBtn")) return;
    const id = e.target.closest(".fileRow").dataset.id;
    await window.courier.removeStop(id);
    if (state.activeStopId === id) state.activeStopId = null;
    await loadStops();
    renderStopsList();
    showToast("Stop removed");
  });

  function activeStop() {
    return state.stops.find((s) => s.id === state.activeStopId) || null;
  }

  // ---------------------------------------------------------------- send --
  function sendPendingItems(stop) {
    state.items.filter((i) => i.status === "pending").forEach((item) => startUpload(item, stop.id));
  }

  function queueFiles(filePaths) {
    const stop = activeStop();
    filePaths.forEach((filePath) => {
      const item = {
        id: "u" + nextItemId++,
        filePath,
        name: fileName(filePath),
        status: stop ? "uploading" : "pending",
        progress: null,
        error: null,
        existingSize: null,
      };
      state.items.unshift(item);
      if (stop) startUpload(item, stop.id);
    });
    renderItems();
    if (!stop && filePaths.length) showToast("Pick a stop, then send");
  }

  function startUpload(item, stopId, onDuplicate) {
    item.status = "uploading";
    item.error = null;
    renderItems();
    window.courier.startUpload(item.id, stopId, item.filePath, onDuplicate);
  }

  function renderItems() {
    const list = $("itemsList");
    if (!state.items.length) { list.innerHTML = ""; return; }
    list.innerHTML = state.items.map(itemHtml).join("");
  }

  function itemHtml(item) {
    let meta = "";
    let actions = "";
    if (item.status === "pending") meta = "Waiting for a stop";
    else if (item.status === "uploading") {
      if (item.progress) {
        const pct = Math.round((item.progress.loaded / item.progress.total) * 100);
        meta = pct + "%";
      } else meta = "Starting…";
      actions = `<button class="cancelBtn">Cancel</button>`;
    } else if (item.status === "done") meta = "Sent";
    else if (item.status === "cancelled") { meta = "Cancelled"; actions = `<button class="retryBtn">Retry</button>`; }
    else if (item.status === "error") { meta = item.error || "Failed"; actions = `<button class="retryBtn">Retry</button>`; }
    else if (item.status === "duplicate") {
      meta = "Already exists (" + formatBytes(item.existingSize || 0) + ")";
      actions = `<button class="dupReplaceBtn">Replace</button><button class="dupRenameBtn">Keep Both</button><button class="dupSkipBtn dangerBtn">Skip</button>`;
    }
    return `
      <div class="itemCard" data-id="${item.id}">
        <div class="itemTop"><div class="itemName">${escapeHtml(item.name)}</div></div>
        <div class="itemMeta">${escapeHtml(meta)}</div>
        ${actions ? `<div class="itemActions">${actions}</div>` : ""}
      </div>`;
  }

  $("itemsList").addEventListener("click", (e) => {
    const card = e.target.closest(".itemCard");
    if (!card) return;
    const item = state.items.find((i) => i.id === card.dataset.id);
    if (!item) return;
    const stop = activeStop();
    if (e.target.classList.contains("cancelBtn")) {
      window.courier.cancelUpload(item.id);
    } else if (e.target.classList.contains("retryBtn")) {
      if (!stop) { showToast("Pick a stop first"); return; }
      startUpload(item, stop.id);
    } else if (e.target.classList.contains("dupReplaceBtn")) {
      startUpload(item, stop.id, "replace");
    } else if (e.target.classList.contains("dupRenameBtn")) {
      startUpload(item, stop.id, "rename");
    } else if (e.target.classList.contains("dupSkipBtn")) {
      state.items = state.items.filter((i) => i.id !== item.id);
      renderItems();
    }
  });

  window.courier.onUploadProgress(({ uploadId, loaded, total }) => {
    const item = state.items.find((i) => i.id === uploadId);
    if (item) { item.progress = { loaded, total }; renderItems(); }
  });
  window.courier.onUploadDone(({ uploadId, result }) => {
    const item = state.items.find((i) => i.id === uploadId);
    if (!item) return;
    if (result.duplicate) {
      item.status = "duplicate";
      item.existingSize = result.existingSize;
    } else {
      item.status = "done";
      showToast("Sent " + item.name);
      loadHistory();
    }
    renderItems();
  });
  window.courier.onUploadCancelled(({ uploadId }) => {
    const item = state.items.find((i) => i.id === uploadId);
    if (item) { item.status = "cancelled"; renderItems(); }
  });
  window.courier.onUploadError(({ uploadId, message }) => {
    const item = state.items.find((i) => i.id === uploadId);
    if (item) { item.status = "error"; item.error = message; renderItems(); }
    else showToast(message);
  });

  const dropZone = $("dropZone");
  dropZone.addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", (e) => {
    queueFiles(Array.from(e.target.files).map((f) => window.courier.pathForFile(f)));
    e.target.value = "";
  });
  ["dragover", "dragleave", "drop"].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.toggle("over", evt === "dragover");
      if (evt === "drop" && e.dataTransfer.files.length) {
        queueFiles(Array.from(e.dataTransfer.files).map((f) => window.courier.pathForFile(f)));
      }
    });
  });

  $("sendClipboardBtn").addEventListener("click", () => {
    const stop = activeStop();
    if (!stop) { showToast("Pick a stop first"); return; }
    window.courier.sendClipboard(stop.id)
      .then(() => showToast("Clipboard sent"))
      .catch((err) => showToast(err.message || "Failed"));
  });

  $("pullClipboardBtn").addEventListener("click", () => {
    const stop = activeStop();
    if (!stop) { showToast("Pick a stop first"); return; }
    window.courier.pullClipboard(stop.id)
      .then((text) => { $("textBox").value = text || ""; showToast("Pulled their clipboard"); })
      .catch((err) => showToast(err.message || "Failed"));
  });

  $("sendTextBtn").addEventListener("click", () => {
    const stop = activeStop();
    if (!stop) { showToast("Pick a stop first"); return; }
    const text = $("textBox").value;
    if (!text.trim()) { showToast("Nothing to send"); return; }
    window.courier.sendText(stop.id, text)
      .then(() => showToast("Text sent"))
      .catch((err) => showToast(err.message || "Failed"));
  });

  // ------------------------------------------------------------- history --
  async function loadHistory() {
    const history = await window.courier.getHistory();
    const list = $("recentList");
    if (!history.length) { list.innerHTML = '<div class="empty">Nothing sent yet</div>'; return; }
    list.innerHTML = history.slice(0, 12).map((entry) => `
      <div class="fileRow" data-path="${escapeHtml(entry.filePath || "")}">
        <div class="fileName">${entry.direction === "received" ? "←" : "→"} ${escapeHtml(entry.name)}</div>
        <div class="fileMeta">${formatBytes(entry.size || 0)} · ${relativeTime(entry.at)}${entry.hostname ? " · " + escapeHtml(entry.hostname) : ""}</div>
        ${entry.direction === "sent" && entry.filePath ? '<button class="resendBtn">Resend</button>' : ""}
      </div>`).join("");
  }
  $("recentList").addEventListener("click", (e) => {
    if (!e.target.classList.contains("resendBtn")) return;
    const filePath = e.target.closest(".fileRow").dataset.path;
    if (!filePath) return;
    if (!activeStop()) { showToast("Pick a stop first"); return; }
    queueFiles([filePath]);
    switchTab("send");
  });

  // ------------------------------------------------------------- receive --
  async function loadLocalFiles() {
    const settings = await window.courier.getSettings();
    $("folderPath").textContent = settings.destDir;
    try {
      const files = await window.courier.listLocalFiles();
      const list = $("fileList");
      if (!files.length) { list.innerHTML = '<div class="empty">Nothing here yet</div>'; return; }
      list.innerHTML = files.map((f) => `
        <div class="fileRow" data-name="${escapeHtml(f.name)}">
          <div class="fileName">${escapeHtml(f.name)}</div>
          <div class="fileMeta">${formatBytes(f.size)}</div>
          <button class="openBtn">Open</button>
          <button class="deleteBtn">Delete</button>
        </div>`).join("");
    } catch {
      $("fileList").innerHTML = '<div class="empty">Could not load files</div>';
    }
  }
  $("fileList").addEventListener("click", (e) => {
    const row = e.target.closest(".fileRow");
    if (!row) return;
    const name = row.dataset.name;
    if (e.target.classList.contains("openBtn")) window.courier.openLocalFile(name);
    else if (e.target.classList.contains("deleteBtn")) window.courier.deleteLocalFile(name).then(loadLocalFiles).catch((err) => showToast(err.message));
  });

  async function loadRemoteFiles() {
    const stop = activeStop();
    const section = $("remoteSection");
    if (!stop) { section.classList.add("hidden"); return; }
    section.classList.remove("hidden");
    $("remoteDivider").textContent = "Files on " + (stop.hostname || stop.ip);
    try {
      const files = await window.courier.listRemoteFiles(stop.id);
      const list = $("remoteFileList");
      if (!files.length) { list.innerHTML = '<div class="empty">Nothing waiting there</div>'; return; }
      list.innerHTML = files.map((f) => `
        <div class="fileRow" data-name="${escapeHtml(f.name)}">
          <div class="fileName">${escapeHtml(f.name)}</div>
          <div class="fileMeta">${formatBytes(f.size)}</div>
          <button class="saveBtn">Save</button>
          <button class="deleteBtn">Remove</button>
        </div>`).join("");
    } catch (err) {
      $("remoteFileList").innerHTML = `<div class="empty">${escapeHtml(err.message || "Could not reach that stop")}</div>`;
    }
  }
  $("remoteFileList").addEventListener("click", async (e) => {
    const row = e.target.closest(".fileRow");
    if (!row) return;
    const stop = activeStop();
    if (!stop) return;
    const name = row.dataset.name;
    if (e.target.classList.contains("saveBtn")) {
      try { await window.courier.saveRemoteFile(stop.id, name); showToast("Saved " + name); loadLocalFiles(); }
      catch (err) { showToast(err.message || "Could not save"); }
    } else if (e.target.classList.contains("deleteBtn")) {
      try { await window.courier.deleteRemoteFile(stop.id, name); loadRemoteFiles(); }
      catch (err) { showToast(err.message || "Could not remove"); }
    }
  });

  $("changeFolderBtn").addEventListener("click", () => {
    window.courier.chooseDownloadFolder().then((dir) => {
      if (dir) { showToast("Download folder updated"); loadLocalFiles(); }
    });
  });

  // ---------------------------------------------------------------- pair --
  async function loadPairingInfo() {
    const info = await window.courier.getOwnPairingInfo();
    $("qrImg").src = info.qrDataUrl;
    $("infoHost").textContent = info.hostname;
    $("infoIp").textContent = info.ip;
    $("infoPort").textContent = info.port;
    $("infoToken").textContent = info.token;
    $("infoFingerprint").textContent = info.fingerprint;
  }

  $("addStopBtn").addEventListener("click", async () => {
    const ip = $("addIp").value.trim();
    const port = $("addPort").value.trim();
    const token = $("addToken").value.trim();
    $("addStopError").textContent = "";
    if (!ip || !port || !token) { $("addStopError").textContent = "Fill in address, port, and token."; return; }
    try {
      const stop = await window.courier.addStop({ ip, port, token });
      state.activeStopId = stop.id;
      $("addIp").value = ""; $("addToken").value = "";
      await loadStops();
      renderStopsList();
      sendPendingItems(stop);
      showToast("Paired with " + (stop.hostname || stop.ip));
      switchTab("send");
    } catch (err) {
      $("addStopError").textContent = err.message || "Could not pair.";
    }
  });

  // ------------------------------------------------------------ updates --
  function parseVersion(v) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || "").trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }
  function compareVersion(a, b) {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  }
  async function checkForUpdate() {
    try {
      const version = await window.courier.getAppVersion();
      const res = await fetch("https://api.github.com/repos/Shamilimanuel/Courier/releases", {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) return;
      const releases = await res.json();
      const desktopReleases = (releases || []).filter((r) => r.tag_name && r.tag_name.startsWith("desktop-v"));
      if (!desktopReleases.length) return;
      const latest = desktopReleases[0];
      const there = parseVersion(latest.tag_name.replace(/^desktop-v/, ""));
      const here = parseVersion(version);
      if (!there || !here || compareVersion(there, here) <= 0) return;
      const exe = (latest.assets || []).find((a) => /\.exe$/i.test(a.name) && !/portable/i.test(a.name));
      if (!exe) return;
      $("updateTitle").textContent = "Courier " + latest.tag_name.replace(/^desktop-v/, "") + " is out";
      $("updateBanner").classList.remove("hidden");
      $("updateGetBtn").onclick = () => window.courier.openExternal(exe.browser_download_url);
    } catch {
      // stays quiet on failure, same as the phone app's UpdateBanner
    }
  }
  $("updateDismissBtn").addEventListener("click", () => $("updateBanner").classList.add("hidden"));

  // ------------------------------------------------------------ tray nav --
  window.courier.onNavigate((tab) => switchTab(tab));
  window.courier.onPreselectFile((filePath) => {
    switchTab("send");
    queueFiles([filePath]);
  });

  loadStops();
  loadHistory();
  checkForUpdate();
  switchTab("send");
})();
