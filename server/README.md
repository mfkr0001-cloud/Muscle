# Server

Node.js HTTP + WebSocket server. It serves the `client/` directory and validates game actions.

## Start

```sh
npm install
npm start
```

The server listens on `0.0.0.0:$PORT` (default `8080`). `/health` and `/healthz` return a JSON health response.

## Game rules

- Training stations are defined in `src/server.js`; each has a fixed world position, radius, power, and unlock check.
- The server checks station distance, zone unlock, and a training cooldown before adding strength and XP.
- Strength can be sold for coins. Coins pay for upgrades and eggs.
- Eggs have weighted pet outcomes. Up to three owned pets may be equipped at once.
- Upgrade, rebirth, pet bonus, and XP values are calculated server-side.
- Player saves include strength, coins, rebirths, XP, upgrades, and pet inventory.

Set `DATA_DIR` to a persistent directory to store `players.json` outside the default `server/data/` path. The current player ID is a browser-generated convenience ID, not secure account authentication.
