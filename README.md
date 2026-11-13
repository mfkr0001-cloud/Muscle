# Muscle Legends Online

Browser-based 3D multiplayer strength-training game built with Three.js and a Node.js WebSocket server.

## Included in this build

- 3D player model from `client/assets/player-base.glb`, with a procedural fallback if the model cannot load.
- Four visible training areas: Starter, Forest, Volcano, and Crystal.
- Four server-validated training stations with different strength rewards. Higher zones require strength or rebirths.
- Player levels and XP progression.
- Selling strength for coins and buying permanent strength-training upgrades.
- Three egg types, weighted pet hatching, pet inventory, and up to three equipped pets.
- Pet and upgrade bonuses are calculated on the server; the browser cannot award itself strength or coins.
- Rebirth progression and JSON player saves.
- Multiplayer player movement and shared world updates.
- Keyboard controls and a touch joystick/jump button for phones.

## Run locally

1. Install Node.js 20 or newer.
2. Open a terminal in `server/`.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:8080` in a browser. Open a second browser window to test multiplayer.

The Node server serves both the browser game and WebSocket endpoint from the same address. No separate static-server command is needed.

## Controls

- `W A S D` or arrow keys — move.
- `Space` — jump.
- On touch screens — use the left joystick and the jump button.
- Walk up to a station and press the training button.
- Sell strength for coins, then use the shop for an upgrade or an egg.
- Equip up to three pets to increase training strength.

## Training zones

| Zone | Station reward | Unlock requirement |
| --- | ---: | --- |
| Starter | +1 | Open immediately |
| Forest | +5 | 100 strength or 1 rebirth |
| Volcano | +15 | 1,000 strength or 1 rebirth |
| Crystal | +50 | 10,000 strength or 2 rebirths |

The server checks the player's location, zone access, training cooldown, shop balance, egg cost, and pet equipment limits. The browser only requests actions; the server decides whether they are valid.

## Player data and deployment

The server writes player data to `server/data/players.json` by default. Set `DATA_DIR` to a persistent storage location when the hosting provider supports one. Render's default filesystem may be temporary; see `DEPLOY_RENDER.md` before relying on long-term saves.

The existing `render.yaml` is part of the repository's deployment setup and is intentionally unchanged in this update.

## Prototype notes

This is an original browser prototype inspired by the training / pets / rebirth loop. It is not connected to Roblox accounts or Roblox servers. It uses simple client-side 3D movement with basic server-side movement limits; it is not a production anti-cheat or account-authentication system.
