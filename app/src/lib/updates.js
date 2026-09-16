import * as Application from "expo-application";

const RELEASES_API = "https://api.github.com/repos/Shamilimanuel/Courier/releases/latest";

/**
 * The version in app.json is the single source of truth: the build derives
 * Android's versionCode from it and tags the release with it, so comparing
 * the two names is comparing the same thing.
 */
export function installedVersionLabel() {
  return Application.nativeApplicationVersion ?? "0.0.0";
}

function parse(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version || "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Positive when `a` is newer than `b`. */
function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Distinguishes "up to date" from "could not tell" -- silently doing nothing
 * on failure is indistinguishable from working, and that's how you end up
 * not knowing whether update checks function at all.
 */
export async function checkForUpdateDetailed() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(RELEASES_API, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json" },
    });

    if (!response.ok) {
      return {
        state: "error",
        reason:
          response.status === 403
            ? "GitHub is rate-limiting this network. Try again in a few minutes."
            : `GitHub replied ${response.status}.`,
      };
    }

    const release = await response.json();
    const here = parse(installedVersionLabel());
    const there = parse(release.tag_name);

    if (!here) return { state: "error", reason: "Could not read this app's version." };
    if (!there) return { state: "error", reason: "The latest release has an odd name." };
    if (compare(there, here) <= 0) return { state: "current", installed: installedVersionLabel() };

    const apk = (release.assets || []).find((a) => String(a.name).endsWith(".apk"));
    if (!apk) return { state: "error", reason: "That release has no app file attached." };

    return {
      state: "available",
      info: { version: release.tag_name, downloadUrl: apk.browser_download_url, releaseUrl: release.html_url },
    };
  } catch (err) {
    const aborted = err.name === "AbortError";
    return { state: "error", reason: aborted ? "GitHub did not answer in time." : "No internet connection." };
  } finally {
    clearTimeout(timeout);
  }
}

/** Returns the newer release if there is one, otherwise null. Never throws. */
export async function checkForUpdate() {
  const result = await checkForUpdateDetailed();
  return result.state === "available" ? result.info : null;
}
