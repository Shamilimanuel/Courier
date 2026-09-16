# Courier

Send text, clipboard, and files between your devices over your own Wi-Fi —
no cloud, no account. Pair as many PCs as you want (home desktop, school
laptop, gaming laptop) — each one is a **stop**. Phone → PC and PC → phone
both work directly; phone → phone and PC → PC route through a stop both
devices already trust, since a phone can't run the receiving side itself
(yet).

```
Courier/
├── agent/     Node/Express server that runs on each PC — a "stop"
├── app/       Expo React Native app (Android)
└── setup.ps1  one-line installer for the agent, fetched live from main
```

## Running it

**Fastest: install the agent with one command**

In PowerShell on the PC you want to turn into a stop:

```
irm github.com/Shamilimanuel/Courier/raw/main/setup.ps1 | iex
```

Installs Node if it's missing, sets the agent to start hidden at login, and
finishes with a QR code — scan it with the app to pair, or with any camera
app to get a download link if the app isn't installed yet. Re-run the same
command any time to update, repair, show the code again, or remove it.

**Or by hand**

```
cd agent
npm install
npm start
```

This prints the port and a pairing token (also written to `agent/config.json`,
which is gitignored — it's unique per install). To see the pairing code
again later: `npm run pair`.

**From any browser, no install at all**

Open `http://<pc-ip>:<port>/pair` on any device on the same Wi-Fi — it shows
the same QR/pairing details, and also lets you push a file to that PC
straight from the browser (drag-and-drop, no app needed on the sending
side). This is how PC → PC works today.

**Run the phone app**

```
cd app
npm install
npx expo start
```

Open it in Expo Go on your Android phone (same Wi-Fi network as the PC), and
scan the QR code or enter the address/port/token by hand. Use **+ Add a
stop** on Home to pair additional PCs — each shows up as a chip you can
switch between, with a live online/offline dot. The **Receive** tab lists
whatever's waiting on the current stop, for any other device to pick up.

## Building a release APK

Pushing to `main` with changes under `app/**` triggers
`.github/workflows/android.yml`, which builds a signed APK and publishes it
as a GitHub Release. The signing keystore lives in `secrets/` (gitignored,
backed up by OneDrive) and in GitHub's encrypted secrets — see
`secrets/READ-ME-FIRST.txt`. **Losing every copy means never being able to
update the installed app again.**

## Status

- [x] PC agent: health check, paired auth (Bearer token), clipboard get/set,
      file upload/list/download with duplicate handling
- [x] Phone app: multi-stop pairing, clipboard/text sync, file/media/app
      send with progress/speed/ETA, and a Receive tab to pull files back down
- [x] Cross-device relay: any two devices paired to the same stop can hand
      files off through it (phone↔phone, PC↔PC), without a phone needing to
      run a server itself
- [x] QR pairing that works from any camera app, not just Courier's own —
      falls back to a download link if the app isn't installed
- [x] Browser-based sending (`/pair` page) — no install needed on the PC
      that's sending
- [x] One-line agent installer, auto-start at login
- [x] Android build pipeline (GitHub Actions → signed APK → Release)
- [ ] True resume for an interrupted file transfer (currently a clean retry,
      not a byte-offset resume)
- [ ] Phone → PC via the Android share sheet ("Send to my PC" from any app)
- [ ] True phone-to-phone without a PC in the middle (needs a background
      server on the phone — bigger lift, not started)
