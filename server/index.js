const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { path: "/socket.io" });

const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.use(express.static(PUBLIC_DIR));

app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

const COLORS = ["#00A3FF", "#FFCC00", "#34D399", "#F472B6", "#F59E0B", "#22D3EE", "#A78BFA"];
let nextColorIdx = 0;

// Privacy-preserving world state:
// - Server never needs the client's true GPS fix.
// - Each client reports a shared anchor point plus relative meter offsets from that anchor.
// - As long as users share the same anchor, they share the same world.
const clients = {};        // id -> { anchorLat, anchorLon, relX, relZ, yaw, color }
const droppedBlocks = [];  // [{ id, anchorLat, anchorLon, relX, relZ, color }]
let nextBlockId = 1;

const deletedCubesByClient = {}; // socketId -> number

const TELEMETRY_MAX = 5000;
const telemetry = [];

function pushTelemetry(entry) {
  telemetry.push(entry);
  if (telemetry.length > TELEMETRY_MAX) {
    telemetry.splice(0, telemetry.length - TELEMETRY_MAX);
  }
}

function emitWorldState() {
  io.emit("worldState", {
    clients,
    droppedBlocks
  });
}

function isNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

const MAX_DELETE_M = 8;

function sameAnchor(a, b) {
  return !!a && !!b && a.anchorLat === b.anchorLat && a.anchorLon === b.anchorLon;
}

function approxDistMetersFromRelative(a, b) {
  if (!a || !b) return Infinity;
  if (!isNumber(a.relX) || !isNumber(a.relZ) || !isNumber(b.relX) || !isNumber(b.relZ)) return Infinity;
  if (!sameAnchor(a, b)) return Infinity;
  return Math.hypot(b.relX - a.relX, b.relZ - a.relZ);
}

app.get("/debug/state", (_req, res) => {
  res.json({ clients, droppedBlocks });
});

app.get("/debug/telemetry", (req, res) => {
  const limit = Math.max(1, Math.min(5000, parseInt(req.query.limit || "500", 10)));
  const filterId = (req.query.id || "").trim();
  const filtered = filterId ? telemetry.filter(e => e.id === filterId) : telemetry;

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
  clients[socket.id] = {
    anchorLat: 0,
    anchorLon: 0,
    relX: null,
    relZ: null,
    yaw: null,
    color
  };

  deletedCubesByClient[socket.id] = deletedCubesByClient[socket.id] || 0;
  socket.emit("myCounters", { deletedCubes: deletedCubesByClient[socket.id] });
  socket.emit("worldState", { clients, droppedBlocks });

  pushTelemetry({ t: Date.now(), id: socket.id, kind: "connect", color });

  socket.on("orientationUpdate", ({ yaw }) => {
    if (!clients[socket.id]) return;
    const y = Number(yaw);
    if (!Number.isFinite(y)) return;
    clients[socket.id].yaw = y;
    emitWorldState();
  });

  socket.on("gpsUpdate", ({ anchorLat, anchorLon, relX, relZ }) => {
    if (!clients[socket.id]) return;
    if (!isNumber(anchorLat) || !isNumber(anchorLon) || !isNumber(relX) || !isNumber(relZ)) return;

    clients[socket.id].anchorLat = anchorLat;
    clients[socket.id].anchorLon = anchorLon;
    clients[socket.id].relX = relX;
    clients[socket.id].relZ = relZ;

    emitWorldState();
  });

  socket.on("dropCube", ({ anchorLat, anchorLon, relX, relZ }) => {
    if (!isNumber(anchorLat) || !isNumber(anchorLon) || !isNumber(relX) || !isNumber(relZ)) return;

    const block = {
      id: nextBlockId++,
      anchorLat,
      anchorLon,
      relX,
      relZ,
      color: clients[socket.id]?.color || "#ffffff"
    };

    droppedBlocks.push(block);
    pushTelemetry({ t: Date.now(), id: socket.id, kind: "dropCube", blockId: block.id, anchorLat, anchorLon, relX, relZ, color: block.color });
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

    const me = clients[socket.id];
    const block = droppedBlocks[idx];

    if (!me || !isNumber(me.relX) || !isNumber(me.relZ)) {
      socket.emit("deleteResult", { ok: false, blockId: idNum, reason: "no_gps" });
      return;
    }

    if (!sameAnchor(me, block)) {
      socket.emit("deleteResult", { ok: false, blockId: idNum, reason: "anchor_mismatch" });
      return;
    }

    const d = approxDistMetersFromRelative(me, block);
    if (d > MAX_DELETE_M) {
      socket.emit("deleteResult", { ok: false, blockId: idNum, reason: "too_far", distM: d, maxM: MAX_DELETE_M });
      return;
    }

    droppedBlocks.splice(idx, 1);
    deletedCubesByClient[socket.id] = (deletedCubesByClient[socket.id] || 0) + 1;
    socket.emit("myCounters", { deletedCubes: deletedCubesByClient[socket.id] });

    pushTelemetry({ t: Date.now(), id: socket.id, kind: "deleteCube", blockId: idNum, distM: d });
    socket.emit("deleteResult", { ok: true, blockId: idNum, distM: d });
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

  socket.on("telemetry", (payload) => {
    if (!payload || typeof payload !== "object") return;
    let json = "";
    try { json = JSON.stringify(payload); } catch (_) { return; }
    if (json.length > 8000) return;
    pushTelemetry({ t: Date.now(), id: socket.id, kind: payload.kind || "telemetry", payload });
  });

  socket.on("disconnect", () => {
    delete clients[socket.id];
    delete deletedCubesByClient[socket.id];
    pushTelemetry({ t: Date.now(), id: socket.id, kind: "disconnect" });
    emitWorldState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
