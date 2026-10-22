(function () {
  const state = { stops: [], activeStopId: null, items: [], tab: "send", unread: 0 };
  let nextItemId = 1;

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- icons --
  // Same line icons as the prototype; the mark is the paper plane from the
  // app icon, like the phone app's PlaneIcon.
  const P = {
    plane: '<path d="M3.5 11.5L20.5 4l-4.6 16.5-4.3-5.4z"/><path d="M11.6 15.1L20.5 4"/>',
    pc: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    photo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    play: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/>',
    clip: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V2.8h6V4M9 10h6M9 14h4"/>',
    text: '<path d="M5 6h14M5 11h14M5 16h9"/>',
    send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
    inbox: '<path d="M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    down: '<path d="M12 4v12m-5-5 5 5 5-5M5 20h14"/>',
    folder: '<path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2h8A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    resend: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/>',
    out: '<path d="M7 17 17 7M9 7h8v8"/>',
    in: '<path d="M17 7 7 17M15 17H7V9"/>',
  };
  const ic = (name) => `<svg class="i" viewBox="0 0 24 24">${P[name] || ""}</svg>`;
  function paintIcons(root) {
    root.querySelectorAll("[data-ic]").forEach((el) => { el.innerHTML = ic(el.dataset.ic); el.removeAttribute("data-ic"); });
    root.querySelectorAll("[data-mark]").forEach((el) => { el.innerHTML = ic("plane"); el.removeAttribute("data-mark"); });
  }
  paintIcons(document);
  document.documentElement.dataset.os = window.courier.platform || "";

  function kindIcon(name) {
    const ext = String(name).split(".").pop().toLowerCase();
    if (/^(jpe?g|png|gif|webp|heic|bmp|svg)$/.test(ext)) return "photo";
    if (/^(mp4|mov|mkv|webm|avi|m4v)$/.test(ext)) return "play";
    if (/^(txt|md|log)$/.test(ext)) return "text";
    return "file";
  }

  // ---------------------------------------------------------------- toast --
  function toast(title, sub, actions) {
    const el = $("toast");
    el.innerHTML = `<div class="rowx"><span class="mark">${ic("plane")}</span><div class="grow"><div class="name">${escapeHtml(title)}</div>${sub ? `<div class="meta">${escapeHtml(sub)}</div>` : ""}</div></div>` +
      (actions ? `<div class="acts">${actions.map((a, i) => `<button class="btn sm${i === 0 ? " pri" : ""}" data-i="${i}">${escapeHtml(a.label)}</button>`).join("")}</div>` : "");
    el.classList.remove("hidden");
    // restart the slide-in
    el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
    el.onclick = (e) => {
      const btn = e.target.closest("button[data-i]");
      if (btn) { actions[Number(btn.dataset.i)].run(); el.classList.add("hidden"); }
    };
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add("hidden"), actions ? 7000 : 2400);
  }
  const showToast = (msg) => toast(msg);

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
    if (minutes < 60) return minutes + "m ago";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "h ago";
    return Math.floor(hours / 24) + "d ago";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function fileName(filePath) {
    return filePath.split(/[\\/]/).pop();
  }

  function stopName(stop) {
    return stop ? stop.hostname || stop.ip : "";
  }

  // Delete and Forget ask inside the row first: the row's buttons turn into
  // "Delete it? Keep / Delete", and Keep puts them back.
  function askInRow(acts, question, yesLabel, onYes) {
    const before = acts.innerHTML;
    acts.innerHTML = `<span class="confirm">${escapeHtml(question)}</span><button class="btn sm" data-keep>Keep</button><button class="btn sm bad" data-yes>${escapeHtml(yesLabel)}</button>`;
    acts.onclick = (e) => {
      if (e.target.closest("[data-keep]")) { e.stopPropagation(); acts.innerHTML = before; acts.onclick = null; }
      else if (e.target.closest("[data-yes]")) { e.stopPropagation(); acts.onclick = null; onYes(); }
    };
  }

  // ----------------------------------------------------------------- tabs --
  function switchTab(name) {
    state.tab = name;
    document.querySelectorAll(".nav").forEach((t) => t.classList.toggle("on", t.dataset.tab === name));
    document.querySelectorAll(".page").forEach((p) => p.classList.toggle("hidden", p.id !== "panel-" + name));
    $("main").scrollTop = 0;
    if (name === "receive") { state.unread = 0; renderBadge(); loadLocalFiles(); loadRemoteFiles(); }
    if (name === "pair") { loadPairingInfo(); renderStopsList(); }
    if (name === "settings") loadSettingsPanel();
  }
  document.querySelectorAll(".nav").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

  function renderBadge() {
    const badge = $("recvBadge");
    badge.textContent = state.unread;
    badge.classList.toggle("hidden", !state.unread);
  }

  // ---------------------------------------------------------------- stops --
  async function loadStops() {
    state.stops = await window.courier.listStops();
    if (!state.stops.find((s) => s.id === state.activeStopId)) state.activeStopId = state.stops[0] ? state.stops[0].id : null;
    renderStops();
    state.stops.forEach(pingAndMark);
  }

  async function pingAndMark(stop) {
    const online = await window.courier.pingStop(stop);
    stop.online = online;
    document.querySelectorAll(`[data-stop="${stop.id}"] .dot`).forEach((dot) => { dot.className = "dot " + (online ? "online" : "offline"); });
  }

  function dotClass(stop) {
    return "dot" + (stop.online === true ? " online" : stop.online === false ? " offline" : "");
  }

  function renderStops() {
    const row = $("stopsRow");
    row.innerHTML = state.stops.map((stop) =>
      `<button class="chip${stop.id === state.activeStopId ? " on" : ""}" data-stop="${stop.id}"><span class="${dotClass(stop)}"></span>${escapeHtml(stopName(stop))}</button>`
    ).join("") + `<button class="chip add" data-add>+ ${state.stops.length ? "Add a stop" : "Pair another PC to send to it"}</button>`;
  }
  $("stopsRow").addEventListener("click", (e) => {
    if (e.target.closest("[data-add]")) { switchTab("pair"); return; }
    const chip = e.target.closest("[data-stop]");
    if (!chip) return;
    state.activeStopId = chip.dataset.stop;
    renderStops();
    const stop = activeStop();
    if (stop) sendPendingItems(stop);
  });

  function renderStopsList() {
    const list = $("stopsList");
    if (!state.stops.length) {
      list.innerHTML = `<div class="card empty"><span class="ico">${ic("pc")}</span><div class="name">No other PCs yet</div><div class="meta">Phones don't need to be listed here: once a phone scans the code above, it can send to this PC. Pair another PC to send to it from here.</div></div>`;
      return;
    }
    list.innerHTML = state.stops.map((s) => `
      <div class="hrow" data-stop="${s.id}">
        <span class="ico">${ic("pc")}</span>
        <div class="grow"><div class="name">${escapeHtml(stopName(s))}</div><div class="meta">${escapeHtml(s.ip)}:${escapeHtml(s.port)}</div></div>
        <span class="${dotClass(s)}"></span>
        <div class="acts"><button class="btn sm" data-forget>Forget</button></div>
      </div>`).join("");
  }
  $("stopsList").addEventListener("click", (e) => {
    if (!e.target.closest("[data-forget]")) return;
    const row = e.target.closest(".hrow");
    const id = row.dataset.stop;
    askInRow(row.querySelector(".acts"), "Forget it?", "Forget", async () => {
      await window.courier.removeStop(id);
      await loadStops();
      renderStopsList();
      showToast("Stop forgotten");
    });
  });

  function activeStop() {
    return state.stops.find((s) => s.id === state.activeStopId) || null;
  }

  // ----------------------------------------------------------------- send --
  function sendPendingItems(stop) {
    state.items.filter((i) => i.status === "pending").forEach((item) => startUpload(item, stop));
  }

  function queueFiles(filePaths) {
    const stop = activeStop();
    filePaths.forEach((filePath) => {
      const item = {
        id: "u" + nextItemId++,
        filePath,
        name: fileName(filePath),
        status: "pending",
        progress: null,
        error: null,
        existingSize: null,
        stopId: null,
        stopName: "",
      };
      state.items.unshift(item);
      if (stop) startUpload(item, stop);
    });
    renderItems();
    if (!stop && filePaths.length) showToast(state.stops.length ? "Pick a stop, then it sends" : "Pair another PC first, under Pair");
  }

  function startUpload(item, stop, onDuplicate) {
    item.status = "uploading";
    item.error = null;
    item.progress = null;
    item.stopId = stop.id;
    item.stopName = stopName(stop);
    renderItems();
    window.courier.startUpload(item.id, stop.id, item.filePath, onDuplicate);
  }

  function renderItems() {
    $("itemsList").innerHTML = state.items.map(itemHtml).join("");
  }

  function itemHtml(item) {
    let meta = "";
    let actions = "";
    let pct = null;
    const to = item.stopName ? "To " + item.stopName + " · " : "";
    if (item.status === "pending") { meta = "Waiting for a stop"; actions = `<button class="btn sm icon" data-do="skip" title="Drop it">${ic("x")}</button>`; }
    else if (item.status === "uploading") {
      if (item.progress && item.progress.total) {
        pct = Math.round((item.progress.loaded / item.progress.total) * 100);
        meta = to + formatBytes(item.progress.loaded) + " of " + formatBytes(item.progress.total);
      } else meta = to + "starting…";
      actions = `<button class="btn sm" data-do="cancel">Cancel</button>`;
    } else if (item.status === "done") { meta = to + "delivered"; pct = 100; }
    else if (item.status === "cancelled") { meta = "Cancelled. Nothing was kept there."; actions = `<button class="btn sm" data-do="retry">${ic("resend")}Retry</button>`; }
    else if (item.status === "error") { meta = item.error || "Failed"; actions = `<button class="btn sm" data-do="retry">${ic("resend")}Retry</button>`; }
    else if (item.status === "duplicate") {
      meta = (item.stopName || "That stop") + " already has a file with this name (" + formatBytes(item.existingSize || 0) + ")";
      actions = `<button class="btn sm pri" data-do="rename">Keep both</button><button class="btn sm" data-do="replace">Replace</button><button class="btn sm" data-do="skip">Skip</button>`;
    }
    const bar = item.status === "uploading" || item.status === "done" ? `<div class="bar"><i style="width:${pct || 0}%"></i></div>` : "";
    return `
      <div class="card itemCard" data-id="${item.id}">
        <div class="rowx">
          <span class="ico">${ic(item.status === "done" ? "send" : kindIcon(item.name))}</span>
          <div class="grow"><div class="name">${escapeHtml(item.name)}</div><div class="meta${item.status === "error" ? " hint bad" : ""}">${escapeHtml(meta)}</div></div>
          ${pct !== null ? `<span class="pct">${pct}%</span>` : ""}
          ${actions ? `<div class="acts">${actions}</div>` : ""}
        </div>${bar}
      </div>`;
  }

  $("itemsList").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-do]");
    const card = e.target.closest(".itemCard");
    if (!btn || !card) return;
    const item = state.items.find((i) => i.id === card.dataset.id);
    if (!item) return;
    const what = btn.dataset.do;
    const stop = state.stops.find((s) => s.id === item.stopId) || activeStop();
    if (what === "cancel") window.courier.cancelUpload(item.id);
    else if (what === "skip") { state.items = state.items.filter((i) => i.id !== item.id); renderItems(); }
    else if (!stop) showToast("Pick a stop first");
    else if (what === "retry") startUpload(item, stop);
    else if (what === "replace") startUpload(item, stop, "replace");
    else if (what === "rename") startUpload(item, stop, "rename");
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
      toast("Delivered", item.name + " is on " + item.stopName);
      loadHistory();
      // the card bows out once it has shown 100%; Recent keeps the record
      setTimeout(() => { state.items = state.items.filter((i) => i !== item); renderItems(); }, 2500);
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
  // Dropping anywhere on the Send page works, not only on the box.
  const sendPage = $("panel-send");
  ["dragover", "dragleave", "drop"].forEach((evt) => {
    sendPage.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.toggle("over", evt === "dragover");
      if (evt === "drop" && e.dataTransfer.files.length) {
        queueFiles(Array.from(e.dataTransfer.files).map((f) => window.courier.pathForFile(f)));
      }
    });
  });
  // Anywhere else, a dropped file would make the window navigate to it.
  ["dragover", "drop"].forEach((evt) => document.addEventListener(evt, (e) => e.preventDefault()));

  function needStop() {
    const stop = activeStop();
    if (!stop) showToast(state.stops.length ? "Pick a stop first" : "Pair another PC first, under Pair");
    return stop;
  }

  $("sendClipboardBtn").addEventListener("click", () => {
    const stop = needStop();
    if (!stop) return;
    window.courier.sendClipboard(stop.id)
      .then(() => toast("Clipboard sent", "It's on " + stopName(stop) + "'s clipboard now"))
      .catch((err) => showToast(err.message || "Failed"));
  });

  $("pullClipboardBtn").addEventListener("click", () => {
    const stop = needStop();
    if (!stop) return;
    window.courier.pullClipboard(stop.id)
      .then((text) => { $("textBox").value = text || ""; fitTextBox(); toast("Got their clipboard", "It's in the box below, ready to copy"); })
      .catch((err) => showToast(err.message || "Failed"));
  });

  function fitTextBox() {
    const box = $("textBox");
    box.style.height = "38px";
    box.style.height = Math.min(box.scrollHeight, 140) + "px";
  }
  $("textBox").addEventListener("input", fitTextBox);
  $("textBox").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(); }
  });
  $("sendTextBtn").addEventListener("click", sendText);
  function sendText() {
    const text = $("textBox").value;
    if (!text.trim()) { showToast("Type something first"); return; }
    const stop = needStop();
    if (!stop) return;
    window.courier.sendText(stop.id, text)
      .then(() => { $("textBox").value = ""; fitTextBox(); toast("Sent", "On " + stopName(stop) + "'s clipboard now"); })
      .catch((err) => showToast(err.message || "Failed"));
  }

  // -------------------------------------------------------------- history --
  async function loadHistory() {
    const history = await window.courier.getHistory();
    const list = $("recentList");
    if (!history.length) {
      list.innerHTML = `<div class="card empty"><span class="ico">${ic("send")}</span><div class="name">Nothing sent yet</div><div class="meta">What you send and receive shows up here.</div></div>`;
      return;
    }
    list.innerHTML = history.slice(0, 12).map((entry) => {
      const sent = entry.direction !== "received";
      const who = entry.hostname ? (sent ? "To " : "From ") + escapeHtml(entry.hostname) + " · " : sent ? "" : "Arrived · ";
      return `
      <div class="hrow" data-path="${escapeHtml(entry.filePath || "")}">
        <span class="ico">${ic(sent ? "out" : "in")}</span>
        <div class="grow"><div class="name">${escapeHtml(entry.name)}</div><div class="meta">${who}${entry.size ? formatBytes(entry.size) + " · " : ""}${relativeTime(entry.at)}</div></div>
        ${sent && entry.filePath ? `<button class="btn sm" data-resend>${ic("resend")}Resend</button>` : ""}
      </div>`;
    }).join("");
  }
  $("recentList").addEventListener("click", (e) => {
    if (!e.target.closest("[data-resend]")) return;
    const filePath = e.target.closest(".hrow").dataset.path;
    if (filePath && needStop()) queueFiles([filePath]);
  });

  // -------------------------------------------------------------- receive --
  async function loadLocalFiles() {
    const settings = await window.courier.getSettings();
    $("folderPath").textContent = settings.destDir;
    const list = $("fileList");
    try {
      const files = await window.courier.listLocalFiles();
      if (!files.length) {
        list.innerHTML = `<div class="card empty"><span class="ico">${ic("inbox")}</span><div class="name">Nothing yet</div><div class="meta">Files a phone sends to this PC land here, with a note in the corner.</div></div>`;
        return;
      }
      list.innerHTML = files.map((f) => `
        <div class="hrow${state.fresh && state.fresh.has(f.name) ? " new" : ""}" data-name="${escapeHtml(f.name)}">
          <span class="ico">${ic(kindIcon(f.name))}</span>
          <div class="grow"><div class="name">${escapeHtml(f.name)}</div><div class="meta">${formatBytes(f.size)}</div></div>
          <div class="acts">
            <button class="btn sm" data-do="open">Open</button>
            <button class="btn sm icon" data-do="show" title="Show in folder">${ic("folder")}</button>
            <button class="btn sm icon" data-do="delete" title="Delete">${ic("trash")}</button>
          </div>
        </div>`).join("");
      if (state.fresh) state.fresh.clear();
    } catch {
      list.innerHTML = '<div class="card empty"><div class="meta">Could not load the files</div></div>';
    }
  }
  $("fileList").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-do]");
    const row = e.target.closest(".hrow");
    if (!btn || !row) return;
    const name = row.dataset.name;
    if (btn.dataset.do === "open") window.courier.openLocalFile(name);
    else if (btn.dataset.do === "show") window.courier.showLocalFile(name);
    else if (btn.dataset.do === "delete") {
      askInRow(row.querySelector(".acts"), "Delete it?", "Delete", () =>
        window.courier.deleteLocalFile(name).then(loadLocalFiles).catch((err) => showToast(err.message)));
    }
  });
  $("openFolderBtn").addEventListener("click", () => window.courier.openLocalFolder());

  async function loadRemoteFiles() {
    const stop = activeStop();
    const section = $("remoteSection");
    if (!stop) { section.classList.add("hidden"); return; }
    section.classList.remove("hidden");
    $("remoteDivider").textContent = "Waiting on " + stopName(stop);
    const list = $("remoteFileList");
    try {
      const files = await window.courier.listRemoteFiles(stop.id);
      if (!files.length) { list.innerHTML = `<div class="card empty"><div class="meta">Nothing waiting on ${escapeHtml(stopName(stop))}</div></div>`; return; }
      list.innerHTML = files.map((f) => `
        <div class="hrow" data-name="${escapeHtml(f.name)}">
          <span class="ico">${ic(kindIcon(f.name))}</span>
          <div class="grow"><div class="name">${escapeHtml(f.name)}</div><div class="meta">${formatBytes(f.size)}</div></div>
          <div class="acts">
            <button class="btn sm" data-do="save">${ic("down")}Save here</button>
            <button class="btn sm icon" data-do="remove" title="Remove from ${escapeHtml(stopName(stop))}">${ic("trash")}</button>
          </div>
        </div>`).join("");
    } catch (err) {
      list.innerHTML = `<div class="card empty"><div class="meta">${escapeHtml(err.message || "Could not reach that stop")}</div></div>`;
    }
  }
  $("remoteFileList").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-do]");
    const row = e.target.closest(".hrow");
    const stop = activeStop();
    if (!btn || !row || !stop) return;
    const name = row.dataset.name;
    if (btn.dataset.do === "save") {
      try { await window.courier.saveRemoteFile(stop.id, name); toast("Saved " + name, "It's in your Courier folder"); loadLocalFiles(); loadHistory(); }
      catch (err) { showToast(err.message || "Could not save"); }
    } else if (btn.dataset.do === "remove") {
      askInRow(row.querySelector(".acts"), "Remove it there?", "Remove", async () => {
        try { await window.courier.deleteRemoteFile(stop.id, name); loadRemoteFiles(); }
        catch (err) { showToast(err.message || "Could not remove"); }
      });
    }
  });

  function chooseFolder() {
    window.courier.chooseDownloadFolder().then((dir) => {
      if (!dir) return;
      showToast("Download folder changed");
      loadLocalFiles();
      if (state.tab === "settings") loadSettingsPanel();
    });
  }
  $("changeFolderBtn").addEventListener("click", chooseFolder);

  // A phone sent something: a note in the corner, and a count on Receive.
  window.courier.onFileArrived((file) => {
    state.fresh = state.fresh || new Set();
    state.fresh.add(file.name);
    if (state.tab === "receive") loadLocalFiles();
    else { state.unread++; renderBadge(); }
    loadHistory();
    toast(file.name + " arrived", (file.size ? formatBytes(file.size) + " · " : "") + "in your Courier folder", [
      { label: "Open", run: () => window.courier.openLocalFile(file.name) },
      { label: "Show in folder", run: () => window.courier.showLocalFile(file.name) },
    ]);
  });

  // ----------------------------------------------------------------- pair --
  let token = "";
  async function loadPairingInfo() {
    const info = await window.courier.getOwnPairingInfo();
    $("qrImg").src = info.qrDataUrl;
    $("infoHost").textContent = info.hostname;
    $("infoIp").textContent = info.ip;
    $("infoPort").textContent = info.port;
    $("infoFingerprint").textContent = info.fingerprint;
    token = info.token;
    showMe(info);
  }
  $("showTokenBtn").addEventListener("click", () => {
    const shown = $("showTokenBtn").textContent === "Hide";
    $("infoToken").textContent = shown ? "••••••••" : token;
    $("showTokenBtn").textContent = shown ? "Show" : "Hide";
  });

  function showMe(info) {
    $("meName").textContent = info.hostname;
    $("meNet").textContent = "Ready · " + info.ip;
    $("winTitle").textContent = "Courier — " + info.hostname;
  }

  $("addStopBtn").addEventListener("click", async () => {
    const ip = $("addIp").value.trim();
    const port = $("addPort").value.trim();
    const tok = $("addToken").value.trim();
    $("addStopError").textContent = "";
    if (!ip || !port || !tok) { $("addStopError").textContent = "Fill in the address, port and token."; return; }
    try {
      const stop = await window.courier.addStop({ ip, port, token: tok });
      state.activeStopId = stop.id;
      $("addIp").value = ""; $("addToken").value = "";
      await loadStops();
      renderStopsList();
      sendPendingItems(stop);
      toast("Paired with " + stopName(stop), "You can send to it from Send now");
    } catch (err) {
      $("addStopError").textContent = err.message || "Could not pair.";
    }
  });

  // -------------------------------------------------------------- updates --
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
      return await findUpdate(version);
    } catch {
      // stays quiet on failure, same as the phone app's UpdateBanner
      return { state: "error" };
    }
  }

  async function findUpdate(version) {
    const res = await fetch("https://api.github.com/repos/Shamilimanuel/Courier/releases", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return { state: "error" };
    const releases = await res.json();
    const desktopReleases = (releases || []).filter((r) => r.tag_name && r.tag_name.startsWith("desktop-v"));
    if (!desktopReleases.length) return { state: "current" };
    const latest = desktopReleases[0];
    const there = parseVersion(latest.tag_name.replace(/^desktop-v/, ""));
    const here = parseVersion(version);
    if (!there || !here || compareVersion(there, here) <= 0) return { state: "current" };
    // The installer, not the portable exe: electron-builder names them
    // "Courier Setup 1.0.0.exe" and "Courier 1.0.0.exe" (dots on GitHub).
    const exes = (latest.assets || []).filter((a) => /\.exe$/i.test(a.name));
    const exe = exes.find((a) => /setup/i.test(a.name)) || exes[0];
    if (!exe) return { state: "current" };
    $("updateTitle").textContent = "Courier " + latest.tag_name.replace(/^desktop-v/, "") + " is out";
    $("updateBanner").classList.remove("hidden");
    $("updateGetBtn").onclick = () => window.courier.openExternal(exe.browser_download_url);
    return { state: "available", version: latest.tag_name.replace(/^desktop-v/, ""), url: exe.browser_download_url };
  }
  $("updateDismissBtn").addEventListener("click", () => $("updateBanner").classList.add("hidden"));

  // ---------------------------------------------------------------- looks --
  // The same six as the phone app. Kept in this window's own storage, so it
  // survives restarts; the title bar's own buttons take the look's colours.
  const LOOKS = [
    { id: "dawn", label: "Dawn", sw: ["#DED6F0", "#7B6BE8"] },
    { id: "dusk", label: "Dusk", sw: ["#2A2036", "#A48BFF"] },
    { id: "midnight", label: "Midnight", sw: ["#12151F", "#5D8BFF"] },
    { id: "gold", label: "Night & Gold", sw: ["#0C1220", "#D8B266"] },
    { id: "airmail", label: "Airmail", sw: ["#E8EDF3", "#C4392D"] },
    { id: "airnight", label: "Airmail Night", sw: ["#131B2C", "#E2584C"] },
  ];
  function applyLook(id) {
    const look = LOOKS.find((l) => l.id === id) || LOOKS[0];
    document.documentElement.dataset.theme = look.id;
    try { localStorage.setItem("courier.theme", look.id); } catch {}
    const css = getComputedStyle(document.documentElement);
    window.courier.setTitleBar({ color: css.getPropertyValue("--surface").trim(), symbolColor: css.getPropertyValue("--ink2").trim() });
    renderThemeGrid();
  }
  function renderThemeGrid() {
    const current = document.documentElement.dataset.theme;
    $("themeGrid").innerHTML = LOOKS.map((l) =>
      `<button class="tchip${l.id === current ? " on" : ""}" data-look="${l.id}">` +
      `<span class="sw" style="background:linear-gradient(135deg,${l.sw[0]} 50%,${l.sw[1]} 50%)"></span><span>${escapeHtml(l.label)}</span></button>`
    ).join("");
  }
  $("themeGrid").addEventListener("click", (e) => {
    const chip = e.target.closest(".tchip");
    if (chip) applyLook(chip.dataset.look);
  });
  let saved = null;
  try { saved = localStorage.getItem("courier.theme"); } catch {}
  applyLook(saved);

  // ------------------------------------------------------------- settings --
  async function loadSettingsPanel() {
    const settings = await window.courier.getSettings();
    $("setFolder").textContent = settings.destDir;
    $("setVersion").textContent = "Courier Desktop " + (await window.courier.getAppVersion());
  }
  $("setFolderBtn").addEventListener("click", chooseFolder);
  $("setUpdateBtn").addEventListener("click", async () => {
    const hint = $("setUpdateHint");
    hint.className = "meta hint";
    hint.textContent = "Checking…";
    const found = await checkForUpdate();
    if (found.state === "available") { hint.className = "meta hint news"; hint.textContent = found.version + " is out: Get it on the Send page"; }
    else if (found.state === "current") { hint.className = "meta hint ok"; hint.textContent = "You're up to date"; }
    else { hint.className = "meta hint bad"; hint.textContent = "Couldn't reach GitHub. Try again later."; }
  });

  // ------------------------------------------------------------- tray nav --
  window.courier.onNavigate((tab) => switchTab(tab));
  window.courier.onPreselectFile((filePath) => {
    switchTab("send");
    queueFiles([filePath]);
  });

  window.courier.getAppVersion().then((v) => { $("sideVersion").textContent = "Courier " + v; });
  window.courier.getOwnPairingInfo().then(showMe).catch(() => {});
  loadStops();
  loadHistory();
  checkForUpdate();
  switchTab("send");
})();
