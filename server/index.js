// server/index.js
// Telemetry logging patch:
// - Accepts lightweight client telemetry over Socket.IO ("telemetry" event)
// - Stores a rolling in-memory buffer
// - Exposes debug endpoints:
//     GET /debug/telemetry  (optionally ?limit=500)
//     GET /debug/state

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { path: "/socket.io" });

app.use(express.static("public"));

const COLORS = ["#00A3FF", "#FFCC00", "#34D399", "#F472B6", "#F59E0B", "#22D3EE", "#A78BFA"];
let nextColorIdx = 0;

const clients = {};        // id -> { lat, lon, color }
const droppedBlocks = [];  // [{ id, lat, lon, color }]
let nextBlockId = 1;

// Server-authoritative counters (extendable for mini-games)
const actionCounters = {
  deletedCubes: 0
};


// Stable shared origin for all clients (set once)
let worldOrigin = null;    // { lat, lon }

// ---- Telemetry (rolling buffer) ----
const TELEMETRY_MAX = 5000;
const telemetry = []; // [{t, id, kind, ...payload}]

function pushTelemetry(entry) {
  telemetry.push(entry);
  if (telemetry.length > TELEMETRY_MAX) {
    telemetry.splice(0, telemetry.length - TELEMETRY_MAX);
  }
}

function emitWorldState() {
  io.emit("worldState", {
    clients,
    droppedBlocks,
    worldOrigin,
    actionCounters
  });
}

function isNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}


const MAX_DELETE_M = 8; // must be within this many meters to delete a cube

function metersPerDegLon(lat) {
  return 111320 * Math.cos(lat * Math.PI / 180);
}

function approxDistMeters(lat1, lon1, lat2, lon2) {
  const lat0 = (worldOrigin?.lat ?? lat1);
  const kLon = metersPerDegLon(lat0);
  const dx = (lon2 - lon1) * kLon;
  const dz = (lat2 - lat1) * 111320;
  return Math.hypot(dx, dz);
}
// Debug endpoints (view from Mac browser)
app.get("/debug/state", (_req, res) => {
  res.json({ clients, droppedBlocks, worldOrigin, actionCounters });
});

app.get("/debug/telemetry", (req, res) => {
  const limit = Math.max(1, Math.min(5000, parseInt(req.query.limit || "500", 10)));
  const filterId = (req.query.id || "").trim();

  const filtered = filterId
    ? telemetry.filter(e => e.id === filterId)
    : telemetry;

  res.json({
    count: telemetry.length,
    filteredCount: filtered.length,
    returned: Math.min(limit, filtered.length),
    filterId: filterId || null,
    telemetry: filtered.slice(-limit)
  });
});

io.on("connection", (socket) => {
  const color = COLORS[nextColorIdx++ % COLORS.length];
  clients[socket.id] = { lat: null, lon: null, color };

  // Send full snapshot immediately
  socket.emit("worldState", { clients, droppedBlocks, worldOrigin });

  // Record connect
  pushTelemetry({ t: Date.now(), id: socket.id, kind: "connect", color });

  socket.on("gpsUpdate", ({ lat, lon }) => {
    if (!clients[socket.id]) return;
    if (!isNumber(lat) || !isNumber(lon)) return;

    clients[socket.id].lat = lat;
    clients[socket.id].lon = lon;

    // Set world origin once (first valid fix from anyone)
    if (!worldOrigin) {
      worldOrigin = { lat, lon };
      pushTelemetry({ t: Date.now(), id: socket.id, kind: "worldOriginSet", lat, lon });
    }

    emitWorldState();
  });

  socket.on("dropCube", ({ lat, lon }) => {
    if (!isNumber(lat) || !isNumber(lon)) return;

    // If origin isn't set yet, set it from the first drop too (fallback)
    if (!worldOrigin) {
      worldOrigin = { lat, lon };
      pushTelemetry({ t: Date.now(), id: socket.id, kind: "worldOriginSet", lat, lon });
    }

    const block = {
      id: nextBlockId++,
      lat,
      lon,
      color: clients[socket.id]?.color || "#ffffff"
    };

    droppedBlocks.push(block);

    // Record drop (authoritative)
    pushTelemetry({ t: Date.now(), id: socket.id, kind: "dropCube", blockId: block.id, lat, lon, color: block.color });

    emitWorldState();
  });

  
  socket.on("deleteCube", ({ blockId }) => {
    const idNum = Number(blockId);
    if (!Number.isFinite(idNum)) {
      socket.emit("deleteResult", { ok: false, blockId, reason: "bad_id" });
      return;
    }

    const idx = droppedBlocks.findIndex(b => b.id === idNum);
    if (idx === -1) {
      socket.emit("deleteResult", { ok: false, blockId: idNum, reason: "not_found" });
      return;
    }

    // Server-side guard: require client position and proximity.
    const me = clients[socket.id];
    const block = droppedBlocks[idx];

    if (!me || !isNumber(me.lat) || !isNumber(me.lon)) {
      socket.emit("deleteResult", { ok: false, blockId: idNum, reason: "no_gps" });
      return;
    }

    const d = approxDistMeters(me.lat, me.lon, block.lat, block.lon);
    if (d > MAX_DELETE_M) {
      socket.emit("deleteResult", { ok: false, blockId: idNum, reason: "too_far", distM: d, maxM: MAX_DELETE_M, actionCounters });
      return;
    }

    droppedBlocks.splice(idx, 1);

    actionCounters.deletedCubes += 1;



    pushTelemetry({ t: Date.now(), id: socket.id, kind: "deleteCube", blockId: idNum, distM: d });

    socket.emit("deleteResult", { ok: true, blockId: idNum, distM: d, actionCounters });

    emitWorldState();
  });

socket.on("toggleColor", () => {
    const current = clients[socket.id]?.color;
    if (!current) return;

    const idx = Math.max(0, COLORS.indexOf(current));
    const next = COLORS[(idx + 1) % COLORS.length];
    clients[socket.id].color = next;

    pushTelemetry({ t: Date.now(), id: socket.id, kind: "toggleColor", color: next });

    emitWorldState();
  });

  // Client telemetry (best-effort, does not affect game logic)
  socket.on("telemetry", (payload) => {
    if (!payload || typeof payload !== "object") return;

    // prevent huge spam payloads
    let json = "";
    try { json = JSON.stringify(payload); } catch (_) { return; }
    if (json.length > 8000) return;

    pushTelemetry({
      t: Date.now(),
      id: socket.id,
      kind: payload.kind || "telemetry",
      payload
    });
  });

  socket.on("disconnect", () => {
    delete clients[socket.id];
    pushTelemetry({ t: Date.now(), id: socket.id, kind: "disconnect" });
    emitWorldState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
