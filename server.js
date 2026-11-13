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
const MAX_SPEED = 7.2;       // серверная максимальная горизонтальная скорость
const MOVE_TOLERANCE = 0.8;  // небольшой запас на сетевую задержку
const WORLD_LIMIT = 500;

await mkdir(dataDir, { recursive: true });
let saved = {};
try { saved = JSON.parse(await readFile(saveFile, "utf8")); } catch {}
const online = new Map();

function publicPlayer(p) {
  return {
    id:p.id, name:p.name, strength:p.strength, coins:p.coins, rebirths:p.rebirths,
    x:p.x, z:p.z, y:p.y, yaw:p.yaw, jumping:p.jumping
  };
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
function cleanName(value) {
  return String(value || "Player").replace(/[<>]/g, "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0,18) || "Player";
}

const wss = new WebSocketServer({ port:PORT });
console.log(`Muscle Legends multiplayer server listening on :${PORT}`);

wss.on("connection", (ws) => {
  let player = null;
  ws.on("message", async raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws,"error",{message:"Invalid JSON"}); }

    if (!player) {
      if (msg.type !== "join") return send(ws,"error",{message:"Send join first"});
      let id = typeof msg.playerId === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(msg.playerId) ? msg.playerId : randomUUID();
      // Не допускаем двух активных соединений с одним playerId.
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
      // Клиент сообщает только состояние прыжка; высота ограничена сервером.
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
