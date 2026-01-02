const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// Keep Socket.IO path default (/socket.io) to match the client config.
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve client (../public because this file lives in /server)
const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.use(express.static(PUBLIC_DIR));

// Small helper pages
app.get("/debug", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "debug.html")));
app.get("/circles", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "circles.html")));

// --- World state (shared) ---
let worldOrigin = null; // { lat, lon } set once (first valid gps sample)

let nextBlockId = 1;
const droppedBlocks = []; // { id, lat, lon, color }

let nextCircleId = 1;
const circles = []; // { id, x, z, scale }

const colors = [
  "#00A3FF", "#FFCC00", "#34D399", "#F472B6",
  "#A78BFA", "#FB7185", "#22C55E", "#F59E0B"
];

// clients[id] = { lat, lon, yaw, color }
const clients = {};

// Per-client counters (private)
const deletedCubesByClient = {}; // socketId -> number

// --- Telemetry (optional, for /debug) ---
const telemetryRing = [];
const TELEMETRY_MAX = 600;
function pushTelemetry(evt) {
  telemetryRing.push(evt);
  while (telemetryRing.length > TELEMETRY_MAX) telemetryRing.shift();
}
app.get("/debug/telemetry", (req, res) => {
  res.json({ count: telemetryRing.length, events: telemetryRing });
});

// --- Helpers ---
function metersPerDegLat() { return 111_320; }
function metersPerDegLonAt(latDeg) { return 111_320 * Math.cos((latDeg * Math.PI) / 180); }

function latLonToXZ(lat, lon) {
  if (!worldOrigin) return { x: 0, z: 0 };
  const mLat = metersPerDegLat();
  const mLon = metersPerDegLonAt(worldOrigin.lat);
  const dLat = lat - worldOrigin.lat;
  const dLon = lon - worldOrigin.lon;
  return { x: dLon * mLon, z: dLat * mLat };
}

function distMeters(aLat, aLon, bLat, bLon) {
  const a = latLonToXZ(aLat, aLon);
  const b = latLonToXZ(bLat, bLon);
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function pickColor() {
  return colors[Math.floor(Math.random() * colors.length)];
}

// --- worldState emit throttling (prevents orientation spam) ---
let lastEmitAt = 0;
let emitTimer = null;
const EMIT_MIN_MS = 90;

function buildWorldState() {
  return { worldOrigin, clients, droppedBlocks, circles };
}

function emitWorldStateNow() {
  lastEmitAt = Date.now();
  io.emit("worldState", buildWorldState());
}

function scheduleWorldStateEmit() {
  const now = Date.now();
  const dueIn = Math.max(0, EMIT_MIN_MS - (now - lastEmitAt));

  if (emitTimer) return; // already queued
  emitTimer = setTimeout(() => {
    emitTimer = null;
    emitWorldStateNow();
  }, dueIn);
}

// --- Socket.IO ---
io.on("connection", (socket) => {
  const color = pickColor();

  clients[socket.id] = { lat: null, lon: null, yaw: 0, color };
  deletedCubesByClient[socket.id] = deletedCubesByClient[socket.id] || 0;

  socket.emit("myCounters", { deletedCubes: deletedCubesByClient[socket.id] });
  socket.emit("worldState", buildWorldState());

  socket.on("telemetry", (payload) => {
    // Best-effort; don't trust the client too much.
    pushTelemetry({
      at: Date.now(),
      socketId: socket.id,
      kind: payload?.kind || "unknown",
      lockNorth: !!payload?.lockNorth,
      raw: payload?.raw || null,
      filt: payload?.filt || null,
      proj: payload?.proj || null,
      yaw: Number(payload?.yaw) || 0,
      extra: payload?.extra || null
    });
  });

  socket.on("gpsUpdate", ({ lat, lon }) => {
    const c = clients[socket.id];
    if (!c) return;

    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return;

    if (!worldOrigin) {
      worldOrigin = { lat: la, lon: lo };
    }

    c.lat = la;
    c.lon = lo;

    scheduleWorldStateEmit();
  });

  socket.on("orientationUpdate", ({ yaw }) => {
    const c = clients[socket.id];
    if (!c) return;

    const y = Number(yaw);
    if (!Number.isFinite(y)) return;

    c.yaw = y;
    scheduleWorldStateEmit();
  });

  socket.on("toggleColor", () => {
    const c = clients[socket.id];
    if (!c) return;

    c.color = pickColor();

    // Keep existing dropped blocks color (historical), or switch? We'll keep historical.
    scheduleWorldStateEmit();
  });

  socket.on("dropCube", ({ lat, lon } = {}) => {
    const c = clients[socket.id];
    if (!c) return;

    const la = Number(lat ?? c.lat);
    const lo = Number(lon ?? c.lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return;

    if (!worldOrigin) worldOrigin = { lat: la, lon: lo };

    const block = { id: nextBlockId++, lat: la, lon: lo, color: c.color };
    droppedBlocks.push(block);

    scheduleWorldStateEmit();
  });

  socket.on("deleteCube", ({ blockId }) => {
    const c = clients[socket.id];
    const id = Number(blockId);

    if (!c || !Number.isFinite(id)) {
      socket.emit("deleteResult", { ok: false, reason: "bad_request" });
      return;
    }

    const idx = droppedBlocks.findIndex(b => b.id === id);
    if (idx === -1) {
      socket.emit("deleteResult", { ok: false, reason: "not_found", blockId: id });
      return;
    }

    // Server-side safety check: must be close to the cube.
    const b = droppedBlocks[idx];
    if (Number.isFinite(c.lat) && Number.isFinite(c.lon)) {
      const d = distMeters(c.lat, c.lon, b.lat, b.lon);
      if (d > 10) { // a touch looser than client UI
        socket.emit("deleteResult", { ok: false, reason: "too_far", blockId: id, distM: d });
        return;
      }
    }

    droppedBlocks.splice(idx, 1);

    deletedCubesByClient[socket.id] = (deletedCubesByClient[socket.id] || 0) + 1;
    socket.emit("myCounters", { deletedCubes: deletedCubesByClient[socket.id] });

    socket.emit("deleteResult", { ok: true, blockId: id });

    scheduleWorldStateEmit();
  });

  // Debug toy: spawn "proto grass circles" around the requesting player
  socket.on("spawnCircles", ({ count, radius } = {}) => {
    const c = clients[socket.id];
    const n = Math.max(1, Math.min(400, Number(count) || 60));
    const r = Math.max(1, Math.min(350, Number(radius) || 80));

    let cx = 0, cz = 0;
    if (c && Number.isFinite(c.lat) && Number.isFinite(c.lon) && worldOrigin) {
      const p = latLonToXZ(c.lat, c.lon);
      cx = p.x; cz = p.z;
    }

    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const scale = 0.6 + Math.random() * 1.8;
      circles.push({ id: nextCircleId++, x, z, scale });
    }

    scheduleWorldStateEmit();
  });

  socket.on("clearCircles", () => {
    circles.length = 0;
    scheduleWorldStateEmit();
  });

  socket.on("disconnect", () => {
    delete clients[socket.id];
    delete deletedCubesByClient[socket.id];
    scheduleWorldStateEmit();
  });
});

server.listen(PORT, () => {
  console.log(`GPS game listening on http://localhost:${PORT}`);
});
