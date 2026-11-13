import { WebSocketServer, WebSocket } from "ws";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "../data");
const saveFile = path.join(dataDir, "players.json");
const PORT = Number(process.env.PORT || 8080);
const TICK_MS = 1000;

await mkdir(dataDir, { recursive: true });
let saved = {};
try { saved = JSON.parse(await readFile(saveFile, "utf8")); } catch {}
const online = new Map();

function publicPlayer(p) {
  return { id:p.id, name:p.name, strength:p.strength, coins:p.coins, rebirths:p.rebirths, x:p.x, z:p.z };
}
async function persist() {
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

const wss = new WebSocketServer({ port:PORT });
console.log(`Muscle Legends multiplayer server listening on :${PORT}`);

wss.on("connection", (ws) => {
  let player = null;
  ws.on("message", async raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws,"error",{message:"Invalid JSON"}); }
    if (!player) {
      if (msg.type !== "join") return send(ws,"error",{message:"Send join first"});
      const id = typeof msg.playerId === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(msg.playerId) ? msg.playerId : randomUUID();
      const name = String(msg.name || "Player").replace(/[<>\\u0000-\\u001f]/g,"").slice(0,18) || "Player";
      const old = saved[id] || {};
      player = { id, name, strength:Number(old.strength)||0, coins:Number(old.coins)||0,
        rebirths:Number(old.rebirths)||0, x:0, z:0, lastTrain:0 };
      online.set(id, ws);
      ws.player = player;
      send(ws,"joined",{player:publicPlayer(player), players:[...online.values()].map(s=>s.player).filter(Boolean).map(publicPlayer)});
      broadcast({type:"playerJoined",player:publicPlayer(player)});
      return;
    }
    if (msg.type === "move") {
      const x = Number(msg.x), z = Number(msg.z);
      if (!Number.isFinite(x)||!Number.isFinite(z)) return;
      player.x = clamp(x,-500,500); player.z = clamp(z,-500,500);
      broadcast({type:"playerMoved",player:publicPlayer(player)});
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
    online.delete(player.id);
    saved[player.id] = {name:player.name,strength:player.strength,coins:player.coins,rebirths:player.rebirths};
    await persist();
    broadcast({type:"playerLeft",id:player.id});
  });
});

setInterval(async () => {
  for (const ws of online.values()) {
    const p = ws.player;
    if (p) saved[p.id] = {name:p.name,strength:p.strength,coins:p.coins,rebirths:p.rebirths};
  }
  await persist();
  broadcast({type:"worldState",players:[...online.values()].map(s=>s.player).filter(Boolean).map(publicPlayer)});
}, TICK_MS);
