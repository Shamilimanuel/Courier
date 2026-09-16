# Courier

Send text, clipboard, and (soon) files between your PC and phone over your
own Wi-Fi — no cloud, no account.

```
Courier/
├── agent/   Node/Express server that runs on the PC
└── app/     Expo React Native app (Android)
```

## Running it

**1. Start the PC agent**

```
cd agent
npm install
npm start
```

This prints the port and a pairing token (also written to `agent/config.json`,
which is gitignored — it's unique per install).

**2. Get the pairing details**

```
cd agent
npm run pair
```

Prints the PC's LAN address, port, and token.

**3. Run the phone app**

```
cd app
npm install
npx expo start
```

Open it in Expo Go on your Android phone (same Wi-Fi network as the PC), and
enter the address/port/token from step 2 on the pairing screen.

## Status

- [x] PC agent: health check, paired auth (Bearer token), clipboard get/set
- [x] Phone app: pairing screen, send/receive clipboard text
- [ ] Phone → PC file send (Android share sheet)
- [ ] PC → phone file send
- [ ] Browser version (for iPhone, no app install needed)
- [ ] Agent auto-start / background install story
