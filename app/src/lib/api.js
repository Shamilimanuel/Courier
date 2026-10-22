import { baseUrl } from "./pairing";
import { Stop, targetOf, identity } from "./stop";

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Local requests should resolve in well under a second; anything longer
 * usually means the packet is going nowhere (wrong network, VPN routing
 * traffic off the LAN, a firewall silently dropping it) rather than a slow
 * PC. Without this, `fetch` just hangs on the OS's own TCP timeout, which
 * can run to several minutes — this fails fast with a message that points
 * at the actual cause instead. */
const REQUEST_TIMEOUT_MS = 8000;

function fromHeader() {
  const me = identity();
  return me ? { "X-Courier-From": me.id } : {};
}

/**
 * One call to a paired stop. In the installed app it goes through the
 * phone's own network code (app/modules/courier-stop), which talks HTTPS
 * pinned to the PC's certificate when pairing gave us its fingerprint, so
 * the token and the text can't be read off the Wi-Fi. Elsewhere (Expo Go,
 * the web preview) it's a plain fetch, like before.
 */
async function request(pairing, path, options = {}) {
  if (Stop) {
    let res;
    try {
      res = await Stop.request(targetOf(pairing), options.method || "GET", path, options.body ?? null);
    } catch (err) {
      throw new ApiError(err?.message || `Could not reach ${pairing.hostname || pairing.ip}.`, 0);
    }
    let body = {};
    try {
      body = res.body ? JSON.parse(res.body) : {};
    } catch {
      // not JSON
    }
    if (res.status === 401) throw new ApiError("Pairing token was rejected. Re-pair with the PC.", 401);
    if (res.status < 200 || res.status >= 300) {
      const err = new ApiError(body.error || `Request failed (${res.status})`, res.status);
      err.body = body;
      throw err;
    }
    return body;
  }

  const url = `${baseUrl(pairing)}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${pairing.token}`,
        ...fromHeader(),
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    const timedOut = err.name === "AbortError";
    throw new ApiError(
      timedOut
        ? `Timed out reaching the PC at ${pairing.ip}:${pairing.port}. Make sure your phone isn't on a VPN or mobile data, and is on the same Wi-Fi as that PC.`
        : `Could not reach the PC at ${pairing.ip}:${pairing.port}. Is it on the same Wi-Fi and is Courier running?`,
      0
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) {
    throw new ApiError("Pairing token was rejected. Re-pair with the PC.", 401);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new ApiError(body.error || `Request failed (${res.status})`, res.status);
    err.body = body;
    throw err;
  }
  return res.json();
}

function postJson(pairing, path, payload) {
  return request(pairing, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function checkHealth(pairing) {
  return request(pairing, "/health");
}

/** A short-timeout health check for "is this device online" — doesn't throw. */
export async function pingHealth(pairing, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl(pairing)}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** What a stop says about itself on /health, without a token: used while
 * finding stops and pairing. Null when nothing answers in time. */
export async function peekHealth(ip, port, timeoutMs = 900) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${ip}:${port}/health`, { signal: controller.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function getClipboard(pairing) {
  return request(pairing, "/clipboard").then((r) => r.text);
}

/** kind "clip" (the clipboard) or "text" (a typed message): both land on
 * the other stop's clipboard; a phone also shows a note. */
export function setClipboard(pairing, text, kind = "clip") {
  return postJson(pairing, "/clipboard", { text, kind });
}

export function listFiles(pairing) {
  return request(pairing, "/files").then((r) => r.files);
}

export function deleteFile(pairing, name) {
  return request(pairing, `/files/${encodeURIComponent(name)}`, { method: "DELETE" });
}

/** After pairing by QR code or by hand: tells the PC how to reach this
 * phone back, so it can send here too. */
export function introduce(pairing, me) {
  return postJson(pairing, "/pair/introduce", me);
}

/** A direct, authenticated download URL for a file held by this Stop. */
export function fileDownloadUrl(pairing, name) {
  return `${baseUrl(pairing)}/files/${encodeURIComponent(name)}?token=${encodeURIComponent(pairing.token)}`;
}

export { ApiError };
