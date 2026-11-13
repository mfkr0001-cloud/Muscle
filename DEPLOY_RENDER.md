# Muscle Legends Online — Render deployment

This package is a replacement for the server entry point plus a Render Blueprint file.
The current `client/index.html` is served by the Node server; its WebSocket address is selected automatically from the page URL (`wss://` on HTTPS, `ws://` on HTTP). You do not need to edit the client file.

## Files to replace/add

- Replace `server/src/server.js` with the file in this package.
- Add `render.yaml` to the repository root (next to `README.md`, `client/`, and `server/`).

Do not replace `server/package.json`; it already contains the required `ws` dependency and `npm start` script.

## Deploy

1. Push these changes to the GitHub repository's `main` branch.
2. In Render, choose **New → Blueprint** and connect `mfkr0001-cloud/Muscle`.
3. Render reads `render.yaml`. Confirm creation of the `muscle-legends-online` Web Service.
4. Wait until the deploy is **Live**.
5. Open the service's `onrender.com` URL. The game page and WebSocket multiplayer are served from the same URL.
6. Test `/health`; it should return JSON with `ok: true`.

If you already created a separate Render Static Site for the client, use the new Web Service URL as the client/server origin instead; this package is designed for the simpler single-service setup.

## Important notes

- Render Web Services support WebSocket connections. The server binds to `0.0.0.0` and uses Render's `PORT` environment variable.
- On Render Free, the service may spin down after inactivity and the first connection can take a little while while it wakes up.
- The existing `players.json` file is still auto-saved, but Render's default filesystem is ephemeral. On a free service, progress can be lost when the service restarts or redeploys. For durable player progress, connect a database or use a paid persistent disk and set `DATA_DIR` to its mount path.
- This is still a prototype: the current movement validation is basic, and player IDs are not secure account authentication.
