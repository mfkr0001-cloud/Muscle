import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, "../../client");
const dataDir = process.env.DATA_DIR || path.resolve(here, "../data");
const saveFile = path.join(dataDir, "players.json");
const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";
const TICK_MS = 1000;
const MAX_SPEED = 7.2;
const MOVE_TOLERANCE = 0.8;
const WORLD_LIMIT = 500;

await mkdir(dataDir, { recursive: true });
let saved = {};
try { saved = JSON.parse(await readFile(saveFile, "utf8")); } catch {}
const online = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".ico": "image/x-icon"
};

function publicPlayer(p) {
  return {
    id:p.id, name:p.name, strength:p.strength, coins:p.coins, rebirths:p.rebirths,
    x:p.x, z:p.z, y:p.y, yaw:p.yaw, jumping:p.jumping
  };
}
async function persist() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(saveFile, JSON.stringify(saved, null, 2));
}
function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const ws of online.values()) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
}
function send(ws, type, data={}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type, ...data}));
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function cleanName(value) {
  return String(value || "Player").replace(/[<>]/g, "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0,18) || "Player";
}

// Render health checks use HTTP; the same server also serves the game and upgrades WebSocket connections.
const httpServer = createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", "Allow": "GET, HEAD" });
    return res.end("Method Not Allowed");
  }

  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Bad Request");
  }

  if (pathname === "/health" || pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(req.method === "HEAD" ? undefined : JSON.stringify({ ok:true, service:"muscle-legends-online", online:online.size }));
  }

  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(clientDir, relative);
  if (filePath !== clientDir && !filePath.startsWith(clientDir + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Forbidden");
  }

  try {
    let content = await readFile(filePath);
    // The existing client can keep its original UI: inject same-origin WebSocket discovery at delivery time.
    if (filePath === path.join(clientDir, "index.html")) {
      let html = content.toString("utf8");
      html = html.replace(
        '<input id="serverAddress" value="ws://localhost:8080" aria-label="Адрес сервера">',
        '<input id="serverAddress" value="" placeholder="Автоматически по адресу сайта" aria-label="Адрес сервера">'
      );
      html = html.replace(
        '<input id="serverSetting" value="ws://localhost:8080">',
        '<input id="serverSetting" value="" placeholder="Автоматически по адресу сайта">'
      );
      html = html.replace(
        'const address=$("#serverAddress").value.trim();setStatus("Подключаемся...");',
        'const configuredAddress=$("#serverAddress").value.trim();const address=configuredAddress||(location.protocol==="https:"?"wss://"+location.host:location.protocol==="http:"?"ws://"+location.host:"ws://localhost:8080");setStatus("Подключаемся...");'
      );
      content = Buffer.from(html, "utf8");
    }
    const type = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff"
    });
    return res.end(req.method === "HEAD" ? undefined : content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not Found");
  }
});

const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT, HOST, () => {
  console.log(`Muscle Legends Online listening on http://${HOST}:${PORT}`);
  console.log(`WebSocket endpoint: ws(s)://<your-render-domain>`);
  console.log(`Player data directory: ${dataDir}`);
});

wss.on("connection", (ws) => {
  let player = null;
  ws.on("message", async raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws,"error",{message:"Invalid JSON"}); }

    if (!player) {
      if (msg.type !== "join") return send(ws,"error",{message:"Send join first"});
      let id = typeof msg.playerId === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(msg.playerId) ? msg.playerId : randomUUID();
      if (online.has(id)) id = randomUUID();
      const name = cleanName(msg.name);
      const old = saved[id] || {};
      player = {
        id, name, strength:Number(old.strength)||0, coins:Number(old.coins)||0,
        rebirths:Number(old.rebirths)||0, x:0, z:0, y:0, yaw:0, jumping:false,
        lastTrain:0, lastMoveAt:Date.now()
      };
      online.set(id, ws);
      ws.player = player;
      send(ws,"joined",{player:publicPlayer(player),players:[...online.values()].map(s=>s.player).filter(Boolean).map(publicPlayer)});
      broadcast({type:"playerJoined",player:publicPlayer(player)});
      return;
    }

    if (msg.type === "move") {
      const x=Number(msg.x), z=Number(msg.z), yaw=Number(msg.yaw)||0;
      if (!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(yaw)) return;
      const now=Date.now(), elapsed=clamp((now-player.lastMoveAt)/1000,0.016,0.25);
      const dx=clamp(x,-WORLD_LIMIT,WORLD_LIMIT)-player.x;
      const dz=clamp(z,-WORLD_LIMIT,WORLD_LIMIT)-player.z;
      const distance=Math.hypot(dx,dz);
      const allowed=MAX_SPEED*elapsed+MOVE_TOLERANCE;
      if(distance>allowed){
        const scale=allowed/distance;
        player.x+=dx*scale;player.z+=dz*scale;
      }else{
        player.x=clamp(x,-WORLD_LIMIT,WORLD_LIMIT);
        player.z=clamp(z,-WORLD_LIMIT,WORLD_LIMIT);
      }
      player.yaw=clamp(yaw,-Math.PI*4,Math.PI*4);
      const requestedY=Number(msg.y);
      player.y=Number.isFinite(requestedY)?clamp(requestedY,0,2.2):0;
      player.jumping=Boolean(msg.jumping)&&player.y>0.02;
      if(!player.jumping)player.y=0;
      player.lastMoveAt=now;
      broadcast({type:"playerMoved",player:publicPlayer(player)});
    } else if (msg.type === "jump") {
      player.jumping=true;
    } else if (msg.type === "train") {
      const now = Date.now();
      if (now - player.lastTrain < 350) return send(ws,"error",{message:"Training cooldown"});
      player.lastTrain = now;
      player.strength += 1;
      send(ws,"stats",{player:publicPlayer(player)});
      broadcast({type:"playerUpdated",player:publicPlayer(player)});
    } else if (msg.type === "sell") {
      const earned = Math.floor(player.strength);
      if (earned <= 0) return;
      player.coins += earned;
      player.strength = 0;
      send(ws,"stats",{player:publicPlayer(player)});
      broadcast({type:"playerUpdated",player:publicPlayer(player)});
    } else if (msg.type === "rebirth") {
      const cost = 10000 * (player.rebirths + 1);
      if (player.strength < cost) return send(ws,"error",{message:`Need ${cost} strength`});
      player.strength = 0; player.coins = 0; player.rebirths += 1;
      send(ws,"stats",{player:publicPlayer(player)});
      broadcast({type:"playerUpdated",player:publicPlayer(player)});
    }
  });

  ws.on("close", async () => {
    if (!player) return;
    if (online.get(player.id) === ws) online.delete(player.id);
    saved[player.id] = {name:player.name,strength:player.strength,coins:player.coins,rebirths:player.rebirths};
    try { await persist(); } catch (error) { console.error("Could not save player data:", error); }
    broadcast({type:"playerLeft",id:player.id});
  });
});

const saveTimer = setInterval(async () => {
  for (const ws of online.values()) {
    const p = ws.player;
    if (p) saved[p.id] = {name:p.name,strength:p.strength,coins:p.coins,rebirths:p.rebirths};
  }
  try { await persist(); } catch (error) { console.error("Could not save player data:", error); }
  broadcast({type:"worldState",players:[...online.values()].map(s=>s.player).filter(Boolean).map(publicPlayer)});
}, TICK_MS);

function shutdown() {
  clearInterval(saveTimer);
  for (const ws of online.values()) ws.close(1001, "Server shutting down");
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
