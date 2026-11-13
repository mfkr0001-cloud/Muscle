# Render deployment

The repository already contains the Render Blueprint file `render.yaml`. This update keeps that file unchanged.

## Existing Render service

The configured service uses:

- Runtime: Node.js
- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`
- Health check: `/health`
- Auto-deploy: enabled

When the updated files reach the repository's `main` branch, Render should start a new deployment automatically. Open the existing `muscle-legends-online` Web Service in Render and check that the latest deploy becomes **Live**. You do not need to create a second service or change `render.yaml`.

## Manual setup (only if the service has not been created yet)

1. In Render, choose **New → Blueprint**.
2. Connect the GitHub repository `mfkr0001-cloud/Muscle`.
3. Let Render read the existing `render.yaml` and create the Web Service.
4. Wait for the service status to become **Live**.
5. Open the service URL. The game page, player model, and WebSocket connection use the same host.
6. Open `/health`; it should return JSON containing `"ok":true`.

## Player saves

Player data is written to `server/data/players.json` unless `DATA_DIR` is set. The default filesystem on a free Render service is temporary, so saved progress may be lost after a restart or redeploy. For durable saves, attach persistent storage or connect a database and point `DATA_DIR` at a persistent directory.

## Notes

- Render Web Services support WebSocket connections; the server binds to `0.0.0.0` and uses Render's `PORT` variable.
- The first connection can take longer if a free service has been sleeping.
- This is still a prototype: player IDs are convenience IDs stored in the browser, not secure account authentication.
