# Multiplayer server

Node.js + WebSocket prototype. Server owns player stats and validates training.
Run:

```bash
cd server
npm install
npm start
```

Default port: `8080` (override with `PORT=...`).
Player progress is saved to `data/players.json`.

This is a development prototype, not production-ready authentication or anti-cheat.
Before public deployment add accounts/session tokens, rate limits, origin checks,
database backups, moderation, and HTTPS/WSS via a reverse proxy.
