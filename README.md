# Courier

Send text, clipboard, and files between your PC and phone over your own
Wi-Fi — no cloud, no account. Pair as many PCs as you want (home desktop,
school laptop, gaming laptop) and switch between them from the phone app.

```
Courier/
├── agent/     Node/Express server that runs on each PC
├── app/       Expo React Native app (Android)
└── setup.ps1  one-line installer for the agent, fetched live from main
```

## Running it

**Fastest: install the agent with one command**

In PowerShell on the PC you want to pair:

```
irm github.com/Shamilimanuel/Courier/raw/main/setup.ps1 | iex
```

Installs Node if it's missing, sets the agent to start hidden at login, and
prints the pairing details at the end. Re-run the same command any time to
update, repair, show the pairing details again, or remove it.

**Or by hand**

```
cd agent
npm install
npm start
```

This prints the port and a pairing token (also written to `agent/config.json`,
which is gitignored — it's unique per install). To see the pairing details
again later: `npm run pair`.

**Run the phone app**

```
cd app
npm install
npx expo start
```

Open it in Expo Go on your Android phone (same Wi-Fi network as the PC), and
enter the address/port/token on the pairing screen. Use **+ Add PC** on Home
to pair additional machines — each one shows up as a chip you can switch
between, with a live online/offline dot.

## Building a release APK

Pushing to `main` with changes under `app/**` triggers
`.github/workflows/android.yml`, which builds a signed APK and publishes it
as a GitHub Release. The signing keystore lives in `secrets/` (gitignored,
backed up by OneDrive) and in GitHub's encrypted secrets — see
`secrets/READ-ME-FIRST.txt`. **Losing every copy means never being able to
update the installed app again.**

## Status

- [x] PC agent: health check, paired auth (Bearer token), clipboard get/set,
      file upload with duplicate handling
- [x] Phone app: multi-device pairing, clipboard/text sync, file/media/app
      send with progress, speed, ETA and transfer history
- [x] One-line agent installer, auto-start at login
- [x] Android build pipeline (GitHub Actions → signed APK → Release)
- [ ] True resume for an interrupted file transfer (currently a clean retry,
      not a byte-offset resume)
- [ ] PC → phone file send
- [ ] Phone → PC via the Android share sheet ("Send to my PC" from any app)
- [ ] Browser version (for iPhone, no app install needed)
