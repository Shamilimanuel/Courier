const { spawn } = require("child_process");

function runPowerShell(args) {
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      args,
    ]);

    let stdout = "";
    let stderr = "";
    ps.stdout.on("data", (chunk) => (stdout += chunk));
    ps.stderr.on("data", (chunk) => (stderr += chunk));

    ps.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `powershell exited with code ${code}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function getClipboardText() {
  // PowerShell's stdout encoding when piped to a child process is not
  // UTF-8 (often the OEM codepage), so anything non-ASCII — em dashes,
  // accents — gets mangled if read back as plain text. Round-trip through
  // base64 instead, same as the write path.
  const script = `
    $text = Get-Clipboard -Raw
    if ($null -eq $text) { $text = "" }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    [Convert]::ToBase64String($bytes)
  `;
  const out = await runPowerShell(script);
  const base64 = out.trim();
  let text = Buffer.from(base64, "base64").toString("utf8");
  // Get-Clipboard -Raw includes a trailing newline even for single-line text.
  return text.replace(/\r?\n$/, "");
}

async function setClipboardText(text) {
  // Pass the text in via stdin-safe base64 to avoid quoting/escaping issues
  // with newlines, quotes, and PowerShell's own special characters.
  const encoded = Buffer.from(text, "utf8").toString("base64");
  const script = `
    $bytes = [Convert]::FromBase64String('${encoded}')
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
    Set-Clipboard -Value $text
  `;
  await runPowerShell(script);
}

module.exports = { getClipboardText, setClipboardText };
