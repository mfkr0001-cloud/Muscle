import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, "../../client");
const dataDir = process.env.DATA_DIR || path.resolve(here, "../data");
const saveFile = path.join(dataDir, "players.json");
const tempSaveFile = `${saveFile}.tmp`;
const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";
const TICK_MS = 1000;
const MAX_SPEED = 7.2;
const MOVE_TOLERANCE = 1.0;
const WORLD_LIMIT = 48;
const MAX_PETS = 30;
const MAX_EQUIPPED_PETS = 3;

// Station positions and rewards are checked on the server. Client-side buttons cannot grant strength by themselves.
const STATIONS = {
  starter: { name: "Гантели", x: 0, z: 0, radius: 6.5, power: 1, unlock: p => true },
  forest: { name: "Скамья", x: 22, z: 0, radius: 6.5, power: 5, unlock: p => p.strength >= 100 || p.rebirths >= 1 },
  volcano: { name: "Тяжёлый жим", x: -22, z: 0, radius: 6.5, power: 15, unlock: p => p.strength >= 1000 || p.rebirths >= 1 },
  crystal: { name: "Кристальный тренажёр", x: 0, z: 22, radius: 6.5, power: 50, unlock: p => p.strength >= 10000 || p.rebirths >= 2 }
};

const EGGS = {
  basic: {
    name: "Обычное яйцо", cost: 150, unlock: p => true,
    pets: [
      { name: "Зайчик", rarity: "Обычный", bonus: 1.10, weight: 62, icon: "🐰" },
      { name: "Щенок", rarity: "Редкий", bonus: 1.20, weight: 30, icon: "🐶" },
      { name: "Дракончик", rarity: "Эпический", bonus: 1.45, weight: 8, icon: "🐉" }
    ]
  },
  forest: {
    name: "Лесное яйцо", cost: 800, unlock: p => p.strength >= 100 || p.rebirths >= 1,
    pets: [
      { name: "Тигр", rarity: "Редкий", bonus: 1.25, weight: 55, icon: "🐯" },
      { name: "Лесной голем", rarity: "Эпический", bonus: 1.55, weight: 32, icon: "🌳" },
      { name: "Феникс", rarity: "Легендарный", bonus: 1.85, weight: 13, icon: "🔥" }
    ]
  },
  legend: {
    name: "Легендарное яйцо", cost: 3000, unlock: p => p.strength >= 1000 || p.rebirths >= 1,
    pets: [
      { name: "Феникс", rarity: "Эпический", bonus: 1.65, weight: 55, icon: "🔥" },
      { name: "Титан", rarity: "Легендарный", bonus: 2.00, weight: 34, icon: "🗿" },
      { name: "Космический дракон", rarity: "Мифический", bonus: 2.50, weight: 11, icon: "🐲" }
    ]
  }
};

await mkdir(dataDir, { recursive: true });
let saved = {};
try {
  const parsed = JSON.parse(await readFile(saveFile, "utf8"));
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed;
} catch {}
const online = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json", ".ico": "image/x-icon"
};

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function cleanName(value) {
  return String(value || "Player").replace(/[<>]/g, "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 18) || "Player";
}
function getLevel(xp) { return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1; }
function getPetBoost(player) {
  return player.pets
    .filter(pet => pet.equipped)
    .reduce((sum, pet) => sum + Math.max(0, finiteNumber(pet.bonus, 1) - 1), 1);
}
function getTrainingMultiplier(player) {
  return (1 + player.upgradeLevel * 0.25) * (1 + player.rebirths * 0.5) * getPetBoost(player);
}
function getZoneForPlayer(player) {
  const distances = [
    ["starter", Math.hypot(player.x, player.z)],
    ["forest", Math.hypot(player.x - 22, player.z)],
    ["volcano", Math.hypot(player.x + 22, player.z)],
    ["crystal", Math.hypot(player.x, player.z - 22)]
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][0];
}
function normalisePets(pets) {
  if (!Array.isArray(pets)) return [];
  return pets.slice(0, MAX_PETS).map(pet => ({
    id: typeof pet.id === "string" ? pet.id.slice(0, 64) : randomUUID(),
    name: cleanName(pet.name),
    rarity: cleanName(pet.rarity || "Обычный"),
    bonus: clamp(finiteNumber(pet.bonus, 1.1), 1, 3),
    icon: typeof pet.icon === "string" ? pet.icon.slice(0, 8) : "🐾",
    equipped: Boolean(pet.equipped)
  }));
}
function playerFromSave(id, name) {
  const old = saved[id] && typeof saved[id] === "object" ? saved[id] : {};
  const player = {
    id, name: cleanName(old.name || name),
    strength: clamp(finiteNumber(old.strength), 0, 1e12),
    coins: clamp(finiteNumber(old.coins), 0, 1e12),
    rebirths: clamp(Math.floor(finiteNumber(old.rebirths)), 0, 1e6),
    xp: clamp(finiteNumber(old.xp), 0, 1e15),
    upgradeLevel: clamp(Math.floor(finiteNumber(old.upgradeLevel)), 0, 100),
    pets: normalisePets(old.pets),
    x: 0, z: 5, y: 0, yaw: 0, jumping: false,
    lastTrain: 0, lastShop: 0, lastEgg: 0, lastPet: 0, lastMoveAt: Date.now()
  };
  // Older saves may contain more than three equipped pets; normalise them safely.
  const equipped = player.pets.filter(pet => pet.equipped);
  equipped.slice(MAX_EQUIPPED_PETS).forEach(pet => { pet.equipped = false; });
  return player;
}
function publicPlayer(player, includeInventory = false) {
  const data = {
    id: player.id, name: player.name,
    strength: player.strength, coins: player.coins, rebirths: player.rebirths,
    level: getLevel(player.xp), xp: player.xp, upgradeLevel: player.upgradeLevel,
    petBoost: Number(getPetBoost(player).toFixed(2)),
    trainMultiplier: Number(getTrainingMultiplier(player).toFixed(2)),
    x: player.x, z: player.z, y: player.y, yaw: player.yaw, jumping: player.jumping,
    zone: getZoneForPlayer(player)
  };
  if (includeInventory) data.pets = player.pets.map(pet => ({ ...pet }));
  return data;
}
let persistQueue = Promise.resolve();
function persist() {
  const writeSnapshot = async () => {
    const snapshot = { ...saved };
    for (const ws of online.values()) {
      const p = ws.player;
      if (p) snapshot[p.id] = {
        name: p.name, strength: p.strength, coins: p.coins, rebirths: p.rebirths,
        xp: p.xp, upgradeLevel: p.upgradeLevel, pets: p.pets
      };
    }
    await mkdir(dataDir, { recursive: true });
    await writeFile(tempSaveFile, JSON.stringify(snapshot, null, 2));
    await rename(tempSaveFile, saveFile);
    saved = snapshot;
  };
  persistQueue = persistQueue.then(writeSnapshot, writeSnapshot);
  return persistQueue;
}
function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const ws of online.values()) if (ws.readyState === WebSocket.OPEN) ws.send(message);
}
function send(ws, type, data = {}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
}
function sendStats(ws, player) {
  send(ws, "stats", { player: publicPlayer(player, true) });
}
function stationError(player, stationId) {
  const station = STATIONS[stationId];
  if (!station) return "Неизвестный тренажёр";
  if (!station.unlock(player)) return `Зона закрыта. Нужно больше силы или rebirth.`;
  const distance = Math.hypot(player.x - station.x, player.z - station.z);
  if (distance > station.radius) return `Подойди ближе к тренажёру «${station.name}».`;
  return null;
}
function chooseWeighted(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

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
    return res.end(req.method === "HEAD" ? undefined : JSON.stringify({ ok: true, service: "muscle-legends-online", online: online.size }));
  }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(clientDir, relative);
  if (filePath !== clientDir && !filePath.startsWith(clientDir + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Forbidden");
  }
  try {
    const content = await readFile(filePath);
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

const wss = new WebSocketServer({ server: httpServer, maxPayload: 16 * 1024 });
httpServer.listen(PORT, HOST, () => {
  console.log(`Muscle Legends Online listening on http://${HOST}:${PORT}`);
  console.log(`WebSocket endpoint: ws(s)://<your-render-domain>`);
  console.log(`Player data directory: ${dataDir}`);
});

wss.on("connection", ws => {
  let player = null;
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return send(ws, "error", { message: "Invalid JSON" }); }
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

    if (!player) {
      if (msg.type !== "join") return send(ws, "error", { message: "Send join first" });
      let id = typeof msg.playerId === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(msg.playerId) ? msg.playerId : randomUUID();
      if (online.has(id)) id = randomUUID();
      player = playerFromSave(id, msg.name);
      online.set(id, ws);
      ws.player = player;
      send(ws, "joined", {
        player: publicPlayer(player, true),
        players: [...online.values()].map(socket => socket.player).filter(Boolean).map(p => publicPlayer(p))
      });
      broadcast({ type: "playerJoined", player: publicPlayer(player) });
      return;
    }

    if (msg.type === "move") {
      const x = finiteNumber(msg.x, NaN), z = finiteNumber(msg.z, NaN), yaw = finiteNumber(msg.yaw, 0);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      const now = Date.now();
      const elapsed = clamp((now - player.lastMoveAt) / 1000, 0.016, 0.25);
      const targetX = clamp(x, -WORLD_LIMIT, WORLD_LIMIT);
      const targetZ = clamp(z, -WORLD_LIMIT, WORLD_LIMIT);
      const dx = targetX - player.x, dz = targetZ - player.z;
      const distance = Math.hypot(dx, dz);
      const allowed = MAX_SPEED * elapsed + MOVE_TOLERANCE;
      if (distance > allowed) {
        const scale = allowed / distance;
        player.x += dx * scale;
        player.z += dz * scale;
      } else {
        player.x = targetX;
        player.z = targetZ;
      }
      player.yaw = clamp(yaw, -Math.PI * 4, Math.PI * 4);
      const requestedY = finiteNumber(msg.y, 0);
      player.y = clamp(requestedY, 0, 2.2);
      player.jumping = Boolean(msg.jumping) && player.y > 0.02;
      if (!player.jumping) player.y = 0;
      player.lastMoveAt = now;
      broadcast({ type: "playerMoved", player: publicPlayer(player) });
      return;
    }

    if (msg.type === "train") {
      const stationId = typeof msg.stationId === "string" ? msg.stationId : "starter";
      const problem = stationError(player, stationId);
      if (problem) return send(ws, "error", { message: problem });
      const station = STATIONS[stationId];
      const now = Date.now();
      if (now - player.lastTrain < 350) return;
      player.lastTrain = now;
      const gain = Math.max(1, Math.floor(station.power * getTrainingMultiplier(player)));
      player.strength = Math.min(1e12, player.strength + gain);
      player.xp = Math.min(1e15, player.xp + gain * 2);
      sendStats(ws, player);
      broadcast({ type: "playerUpdated", player: publicPlayer(player) });
      return;
    }

    if (msg.type === "sell") {
      const earned = Math.floor(player.strength);
      if (earned <= 0) return send(ws, "error", { message: "Пока нечего продавать" });
      player.coins = Math.min(1e12, player.coins + earned);
      player.strength = 0;
      sendStats(ws, player);
      broadcast({ type: "playerUpdated", player: publicPlayer(player) });
      return;
    }

    if (msg.type === "buyUpgrade") {
      const now = Date.now();
      if (now - player.lastShop < 250) return;
      player.lastShop = now;
      const cost = Math.floor(100 * Math.pow(1.7, player.upgradeLevel));
      if (player.coins < cost) return send(ws, "error", { message: `Нужно ${cost} монет для улучшения` });
      if (player.upgradeLevel >= 30) return send(ws, "error", { message: "Улучшение уже максимальное" });
      player.coins -= cost;
      player.upgradeLevel += 1;
      sendStats(ws, player);
      return;
    }

    if (msg.type === "hatchEgg") {
      const now = Date.now();
      if (now - player.lastEgg < 900) return;
      player.lastEgg = now;
      const eggId = typeof msg.eggId === "string" ? msg.eggId : "basic";
      const egg = EGGS[eggId];
      if (!egg) return send(ws, "error", { message: "Такого яйца нет" });
      if (!egg.unlock(player)) return send(ws, "error", { message: "Это яйцо пока закрыто" });
      if (player.coins < egg.cost) return send(ws, "error", { message: `Нужно ${egg.cost} монет` });
      if (player.pets.length >= MAX_PETS) return send(ws, "error", { message: "Инвентарь питомцев заполнен" });
      player.coins -= egg.cost;
      const chosen = chooseWeighted(egg.pets);
      const pet = { id: randomUUID(), name: chosen.name, rarity: chosen.rarity, bonus: chosen.bonus, icon: chosen.icon, equipped: player.pets.filter(item => item.equipped).length < MAX_EQUIPPED_PETS };
      player.pets.push(pet);
      send(ws, "petHatched", { pet: { ...pet } });
      sendStats(ws, player);
      return;
    }

    if (msg.type === "togglePet") {
      const now = Date.now();
      if (now - player.lastPet < 250) return;
      player.lastPet = now;
      const petId = typeof msg.petId === "string" ? msg.petId : "";
      const pet = player.pets.find(item => item.id === petId);
      if (!pet) return send(ws, "error", { message: "Питомец не найден" });
      if (pet.equipped) {
        pet.equipped = false;
      } else {
        const equippedCount = player.pets.filter(item => item.equipped).length;
        if (equippedCount >= MAX_EQUIPPED_PETS) return send(ws, "error", { message: "Можно экипировать только 3 питомцев" });
        pet.equipped = true;
      }
      sendStats(ws, player);
      return;
    }

    if (msg.type === "rebirth") {
      const cost = 10000 * (player.rebirths + 1);
      if (player.strength < cost) return send(ws, "error", { message: `Нужно ${cost} силы для rebirth` });
      player.strength = 0;
      player.coins = 0;
      player.upgradeLevel = 0;
      player.rebirths += 1;
      sendStats(ws, player);
      broadcast({ type: "playerUpdated", player: publicPlayer(player) });
    }
  });

  ws.on("close", async () => {
    if (!player) return;
    if (online.get(player.id) === ws) online.delete(player.id);
    saved[player.id] = {
      name: player.name, strength: player.strength, coins: player.coins, rebirths: player.rebirths,
      xp: player.xp, upgradeLevel: player.upgradeLevel, pets: player.pets
    };
    try { await persist(); } catch (error) { console.error("Could not save player data:", error); }
    broadcast({ type: "playerLeft", id: player.id });
  });
  ws.on("error", error => console.warn("WebSocket client error:", error.message));
});

const saveTimer = setInterval(async () => {
  try { await persist(); }
  catch (error) { console.error("Could not save player data:", error); }
  broadcast({ type: "worldState", players: [...online.values()].map(socket => socket.player).filter(Boolean).map(p => publicPlayer(p)) });
}, TICK_MS);

function shutdown() {
  clearInterval(saveTimer);
  for (const ws of online.values()) ws.close(1001, "Server shutting down");
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
