const os = require("os");
const http = require("http");
const { Bonjour } = require("bonjour-service");

/**
 * Finding other stops on the Wi-Fi, without a QR code or an address.
 *
 * Every stop (this PC, other PCs, phones running Courier) announces itself
 * as "_courier._tcp" over mDNS, the way printers and Chromecasts do, with
 * its id, name and kind in the announcement. Some Wi-Fi blocks those
 * announcements, so while looking it also knocks on every address on this
 * network once (a "sweep"): any stop answering /health with api 2 counts.
 *
 * Found stops are reported through onChange(list); each one is
 * { id, name, kind, ip, port, securePort? }.
 */

const SERVICE_TYPE = "courier";
const SWEEP_TIMEOUT_MS = 700;
const SWEEP_PARALLEL = 48;

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal && net.netmask) out.push(net);
    }
  }
  return out;
}

function getHealth(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ host: ip, port, path: "/health", timeout: timeoutMs, agent: false }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

function createDiscovery({ self, onChange }) {
  let bonjour = null;
  let browser = null;
  let published = null;
  const found = new Map();
  let sweeping = false;

  function emit() {
    onChange([...found.values()]);
  }

  function remember(entry) {
    if (!entry || !entry.id || entry.id === self().id) return;
    found.set(entry.id, { ...found.get(entry.id), ...entry, seenAt: Date.now() });
    emit();
  }

  function fromService(service) {
    const txt = service.txt || {};
    const ip = (service.addresses || []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || service.referer?.address;
    if (!txt.id || !ip) return null;
    const entry = { id: String(txt.id), name: String(txt.name || service.name), kind: txt.kind === "phone" ? "phone" : "pc", ip, port: service.port };
    if (txt.sp) entry.securePort = Number(txt.sp);
    return entry;
  }

  /** Tells the Wi-Fi this PC is here. Safe to call again after a restart. */
  function announce() {
    try {
      if (!bonjour) bonjour = new Bonjour();
      if (published) published.stop?.();
      const me = self();
      published = bonjour.publish({
        name: `${me.name} (${me.id.slice(0, 4)})`,
        type: SERVICE_TYPE,
        port: me.port,
        txt: { id: me.id, name: me.name, kind: "pc", sp: String(me.securePort), v: "2" },
      });
      published.on?.("error", () => {});
    } catch {
      // mDNS is a nice-to-have: without it the sweep and the QR code still work
    }
  }

  async function sweep() {
    if (sweeping) return;
    sweeping = true;
    try {
      const me = self();
      for (const net of lanAddresses()) {
        // Only the common home-network size (255.255.255.0); a bigger
        // network would mean thousands of knocks.
        if (net.netmask !== "255.255.255.0") continue;
        const base = net.address.split(".").slice(0, 3).join(".");
        const targets = [];
        for (let i = 1; i < 255; i++) {
          const ip = `${base}.${i}`;
          if (ip !== net.address) targets.push(ip);
        }
        for (let i = 0; i < targets.length; i += SWEEP_PARALLEL) {
          if (!browser) return; // stopped meanwhile
          await Promise.all(
            targets.slice(i, i + SWEEP_PARALLEL).map(async (ip) => {
              const h = await getHealth(ip, me.port, SWEEP_TIMEOUT_MS);
              if (h && h.api >= 2 && h.id) {
                remember({ id: h.id, name: h.name || h.hostname || ip, kind: h.kind === "phone" ? "phone" : "pc", ip, port: me.port, securePort: h.securePort });
              }
            })
          );
        }
      }
    } finally {
      sweeping = false;
    }
  }

  /** Listens for other stops until stop(). With sweep, also knocks on
   * every address once: the Pair page's "Find on this Wi-Fi". */
  function start({ sweep: doSweep = false } = {}) {
    try {
      if (!bonjour) bonjour = new Bonjour();
      if (!browser) {
        browser = bonjour.find({ type: SERVICE_TYPE });
        browser.on("up", (s) => remember(fromService(s)));
        browser.on("down", (s) => {
          const e = fromService(s);
          if (e && found.delete(e.id)) emit();
        });
      } else {
        browser.update();
      }
    } catch {
      browser = browser || { stop() {}, update() {} };
    }
    if (doSweep) sweep();
    emit();
  }

  function stop() {
    try {
      browser?.stop();
    } catch {
      // already stopped
    }
    browser = null;
  }

  /** A quick look without showing anything, used to find a known stop's
   * new address when it stopped answering at the old one. */
  function list() {
    return [...found.values()];
  }

  function close() {
    stop();
    try {
      bonjour?.unpublishAll();
      bonjour?.destroy();
    } catch {
      // closing anyway
    }
    bonjour = null;
  }

  return { announce, start, stop, list, close, sweep };
}

module.exports = { createDiscovery };
