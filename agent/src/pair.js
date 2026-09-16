/**
 * Shows the pairing code so a phone (or another PC's browser) can use it.
 *
 *   npm run pair
 *
 * The agent normally runs hidden -- started by a Scheduled Task with no
 * console of its own -- so anything it prints goes nowhere. This is how you
 * actually see the code.
 */

const os = require("os");
const { execSync } = require("child_process");
const QRCode = require("qrcode");
const { loadOrCreateConfig } = require("./config");
const { pairingUrl, getLanAddress } = require("./pairPage");

const RELEASES_URL = "https://github.com/Shamilimanuel/Courier/releases/latest";

// The QR is drawn with block characters, so a legacy code page turns it into
// unscannable rubbish. Harmless where it is already UTF-8, or not Windows.
if (process.platform === "win32") {
  try {
    execSync("chcp 65001", { stdio: "ignore" });
  } catch {
    // Not fatal: the labelled fields below are still readable either way.
  }
}

// Windows consoles have understood these since Windows 10; a terminal that
// doesn't just prints the codes harmlessly rather than breaking the layout.
const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColour ? `\x1b[${code}m${s}\x1b[0m` : s);

const teal = paint("38;5;80");
const dim = paint("38;5;244");
const white = paint("97");
const bold = paint("1");
const amber = paint("38;5;215");

const W = 46;
const pad = "  ";

function rule(left, right, fill) {
  return dim(pad + left + fill.repeat(W) + right);
}

function boxLine(text, colour) {
  const visible = text.replace(/\x1b\[[0-9;]*m/g, "");
  const gap = Math.max(0, W - visible.length - 1);
  return dim(pad + "│") + " " + (colour ? colour(text) : text) + " ".repeat(gap) + dim("│");
}

function header() {
  console.log("");
  console.log(rule("╭", "╮", "─"));
  console.log(boxLine("COURIER  ·  pair a device", bold));
  console.log(rule("╰", "╯", "─"));
  console.log("");
}

// Padded label + coloured value, matching how the app labels its own boxes
// ("PC address", "Port", "Token") -- so nothing here needs translating
// before it goes in.
function field(label, value, colour) {
  console.log(pad + "  " + dim(label.padEnd(14)) + (colour || white)(String(value)));
}

async function main() {
  const config = loadOrCreateConfig();
  const ip = getLanAddress();
  const url = pairingUrl(config);

  header();

  const terminalQr = await QRCode.toString(url, { type: "terminal", small: true });
  console.log(terminalQr.replace(/^/gm, pad));

  console.log(pad + white("Scan with Courier's in-app scanner, or any camera app."));
  console.log("");
  console.log(rule("├", "┤", "─"));
  console.log("");
  console.log(pad + dim("Or type these in by hand -- they match the app's boxes:"));
  console.log("");

  field("This PC", os.hostname(), teal);
  field("PC address", ip);
  field("Port", config.port);
  field("Token", config.token);

  console.log("");
  console.log(pad + amber("⚠  That token is the password to this PC. Don't share it."));
  console.log("");
  console.log(rule("├", "┤", "─"));
  console.log("");
  field("Get the app", RELEASES_URL, teal);
  field("Or a browser", `http://${ip}:${config.port}/pair`, teal);
  console.log("");
}

main().catch((err) => {
  console.error("");
  console.error(pad + "Could not build the pairing code:");
  console.error(pad + "  " + err.message);
  console.error("");
  process.exit(1);
});
