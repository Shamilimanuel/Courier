import { baseUrl } from "./pairing";

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(pairing, path, options = {}) {
  const url = `${baseUrl(pairing)}${path}`;
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${pairing.token}`,
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    throw new ApiError(
      `Could not reach the PC at ${pairing.ip}:${pairing.port}. Is it on the same Wi-Fi and is Courier running?`,
      0
    );
  }

  if (res.status === 401) {
    throw new ApiError("Pairing token was rejected. Re-pair with the PC.", 401);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || `Request failed (${res.status})`, res.status);
  }
  return res.json();
}

export function checkHealth(pairing) {
  return request(pairing, "/health");
}

export function getClipboard(pairing) {
  return request(pairing, "/clipboard").then((r) => r.text);
}

export function setClipboard(pairing, text) {
  return request(pairing, "/clipboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export { ApiError };
