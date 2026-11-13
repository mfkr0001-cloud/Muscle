# Muscle Legends Online — starter

This repository contains:
- `client/`: browser prototype with a main menu, settings screen, in-game HUD, and a GLB player mesh
- `server/`: Node.js WebSocket multiplayer prototype with server-side stats and JSON saves

## Run locally
1. Install Node.js 20+.
2. In `server/`, run `npm install` then `npm start`.
3. Serve `client/` over HTTP (for example `python -m http.server 5500` from that folder).
4. Open `http://localhost:5500` in two browser windows and connect both to `ws://localhost:8080`.

The included character is a first procedural 3D blockout inspired by the approved concept, not a finished rigged/animated production character. The source Roblox capture's server code was not available, so game rules here are a new prototype reconstruction.
