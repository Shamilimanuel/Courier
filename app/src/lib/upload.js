import { baseUrl } from "./pairing";

/** Distinct from a real failure, so the UI can show "Cancelled" instead of
 * treating a deliberate stop as an error to retry. */
export class UploadCancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "UploadCancelled";
  }
}

/**
 * Uploads one picked file to the agent's /files route, reporting progress as
 * it goes. Uses XMLHttpRequest instead of fetch because RN's fetch doesn't
 * expose upload progress events — XHR does, on both native and web — and
 * because only XHR gives us something to call .abort() on for cancellation.
 *
 * Returns { promise, cancel } rather than just a promise, so the caller can
 * stop an in-flight upload without needing its own reference to the XHR.
 *
 * V1 has no true resume-from-offset: a dropped connection (or a cancel)
 * means a clean retry (the whole file again), not continuing from where it
 * stopped. Native byte-range reads from a picked file need more groundwork
 * than this pass covers, so the agent's staging design leaves room for it,
 * but the client doesn't do it yet.
 */
export function uploadFile(pairing, asset, { onDuplicate, onProgress } = {}) {
  const xhr = new XMLHttpRequest();

  const promise = new Promise((resolve, reject) => {
    xhr.open("POST", `${baseUrl(pairing)}/files`);
    xhr.setRequestHeader("Authorization", `Bearer ${pairing.token}`);

    const startedAt = Date.now();

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      const elapsed = (Date.now() - startedAt) / 1000;
      const speed = elapsed > 0 ? event.loaded / elapsed : 0;
      const remaining = event.total - event.loaded;
      const eta = speed > 0 ? remaining / speed : null;
      onProgress({ loaded: event.loaded, total: event.total, speed, eta });
    };

    xhr.onerror = () => reject(new Error("Upload failed — check the PC is still on the same Wi-Fi."));
    xhr.ontimeout = () => reject(new Error("Upload timed out."));
    xhr.onabort = () => reject(new UploadCancelled());

    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // fall through with empty body
      }
      if (xhr.status === 409 && body.code === "duplicate") {
        resolve({ duplicate: true, existingSize: body.existingSize });
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
        return;
      }
      reject(new Error(body.error || `Upload failed (${xhr.status})`));
    };

    const formData = new FormData();
    if (onDuplicate) formData.append("onDuplicate", onDuplicate);

    if (asset.file) {
      // Web: expo-document-picker gives a real browser File.
      formData.append("file", asset.file, asset.name);
    } else {
      // Native: RN's FormData knows how to stream a local file by uri.
      formData.append("file", {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType || "application/octet-stream",
      });
    }

    xhr.send(formData);
  });

  return { promise, cancel: () => xhr.abort() };
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatEta(seconds) {
  if (seconds == null || !isFinite(seconds)) return "";
  if (seconds < 1) return "<1s left";
  if (seconds < 60) return `${Math.ceil(seconds)}s left`;
  return `${Math.ceil(seconds / 60)}m left`;
}
