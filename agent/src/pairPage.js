const os = require("os");
const QRCode = require("qrcode");

const RELEASES_URL = "https://github.com/Shamilimanuel/Courier/releases/latest";

function getLanAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

function pairingUrl(config) {
  const ip = getLanAddress();
  return `http://${ip}:${config.port}/pair?ip=${ip}&port=${config.port}&token=${config.token}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function renderPairPage(config) {
  const ip = getLanAddress();
  const url = pairingUrl(config);
  const qrDataUrl = await QRCode.toDataURL(url, {
    margin: 1,
    width: 280,
    color: { dark: "#0B0E14", light: "#EAF0FA" },
  });

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pair Courier</title>
<style>
  :root {
    --ground: #0B0E14;
    --surface: #141924;
    --surface2: #1C2230;
    --ink: #EAF0FA;
    --ink2: #8B96AA;
    --ink3: #4E5972;
    --accent: #2BD9C2;
    --accent-deep: #16A895;
    --border: rgba(255,255,255,0.08);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    justify-content: center;
    padding: 32px 20px 60px;
  }
  .card {
    width: 100%;
    max-width: 400px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 28px;
  }
  .mark {
    width: 34px; height: 34px; border-radius: 9px;
    background: var(--accent);
    color: var(--ground);
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 16px;
  }
  .brand-name { font-weight: 700; font-size: 18px; letter-spacing: -0.01em; }
  h1 { font-size: 20px; margin: 0 0 6px; font-weight: 700; }
  .sub { color: var(--ink2); font-size: 13.5px; line-height: 1.5; margin: 0 0 26px; }

  .qr-wrap {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    display: flex;
    justify-content: center;
    margin-bottom: 20px;
  }
  .qr-wrap img { width: 100%; max-width: 240px; border-radius: 4px; }

  .field {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 10px;
  }
  .field-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink3); font-weight: 700; margin-bottom: 4px; }
  .field-value { font-family: 'SFMono-Regular', Consolas, 'Roboto Mono', monospace; font-size: 13.5px; word-break: break-all; }

  .btn {
    display: block;
    width: 100%;
    text-align: center;
    text-decoration: none;
    border: none;
    border-radius: 10px;
    padding: 13px;
    font-size: 14.5px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    margin-top: 8px;
  }
  .btn-accent { background: var(--accent); color: var(--ground); }
  .btn-outline { background: var(--surface2); color: var(--ink); border: 1px solid var(--border); }

  .divider { display: flex; align-items: center; gap: 10px; margin: 26px 0 18px; color: var(--ink3); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; }
  .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: var(--border); }

  .toast {
    position: fixed; left: 20px; right: 20px; bottom: 24px;
    background: var(--surface2); border: 1px solid var(--border);
    color: var(--ink); font-size: 13px; font-weight: 600;
    padding: 12px 16px; border-radius: 10px; text-align: center;
    opacity: 0; transform: translateY(8px);
    transition: opacity 0.2s ease, transform 0.2s ease;
    max-width: 400px; margin: 0 auto;
  }
  .toast.show { opacity: 1; transform: translateY(0); }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <div class="mark">C</div>
      <div class="brand-name">Courier</div>
    </div>

    <h1>Pair with this PC</h1>
    <p class="sub">Already have the app? Open it and tap <b>Scan QR code</b>. Don't have it yet? Install it first, then come back to this page or scan again.</p>

    <div class="qr-wrap">
      <img src="${qrDataUrl}" alt="Pairing QR code">
    </div>

    <a class="btn btn-accent" href="${RELEASES_URL}">Download Courier for Android</a>
    <button class="btn btn-outline" id="copyBtn">Copy pairing details</button>

    <div class="divider">Or enter manually</div>

    <div class="field">
      <div class="field-label">PC address</div>
      <div class="field-value">${escapeHtml(ip)}:${escapeHtml(config.port)}</div>
    </div>
    <div class="field">
      <div class="field-label">Token</div>
      <div class="field-value">${escapeHtml(config.token)}</div>
    </div>
  </div>

  <div class="toast" id="toast">Copied</div>

<script>
  var ip = ${JSON.stringify(ip)};
  var port = ${JSON.stringify(config.port)};
  var token = ${JSON.stringify(config.token)};

  document.getElementById('copyBtn').addEventListener('click', function () {
    var text = 'Address: ' + ip + ':' + port + '\\nToken: ' + token;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(function () {});
    }
    var toast = document.getElementById('toast');
    toast.classList.add('show');
    setTimeout(function () { toast.classList.remove('show'); }, 1800);
  });
</script>
</body>
</html>`;
}

module.exports = { renderPairPage, pairingUrl, getLanAddress };
