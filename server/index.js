// server/index.js
// Recommended fix: Authoritative world snapshots + stable shared world origin.
// - Server picks worldOrigin once (first valid GPS fix) and never changes it.
// - Server emits worldState after every mutation (gpsUpdate, dropCube, connect, disconnect).

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// Same-origin by default. If you host client separately, configure CORS here.
const io = new Server(server, { path: "/socket.io" });

app.use(express.static("public"));

const COLORS = ["#00A3FF", "#FFCC00", "#34D399", "#F472B6", "#F59E0B", "#22D3EE", "#A78BFA"];
let nextColorIdx = 0;

const clients = {};        // id -> { lat, lon, color }
const droppedBlocks = [];  // [{ id, lat, lon, color }]
let nextBlockId = 1;

// Stable shared origin for all clients (set once)
let worldOrigin = null;    // { lat, lon }

function emitWorldState() {
  io.emit("worldState", {
    clients,
    droppedBlocks,
    worldOrigin
  });
}

function isNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

io.on("connection", (socket) => {
  const color = COLORS[nextColorIdx++ % COLORS.length];
  clients[socket.id] = { lat: null, lon: null, color };

  // Send full snapshot immediately
  socket.emit("worldState", { clients, droppedBlocks, worldOrigin });

  socket.on("gpsUpdate", ({ lat, lon }) => {
    if (!clients[socket.id]) return;
    if (!isNumber(lat) || !isNumber(lon)) return;

    clients[socket.id].lat = lat;
    clients[socket.id].lon = lon;

    // Set world origin once (first valid fix from anyone)
    if (!worldOrigin) {
      worldOrigin = { lat, lon };
    }

    emitWorldState();
  });

  socket.on("dropCube", ({ lat, lon }) => {
    if (!isNumber(lat) || !isNumber(lon)) return;

    // If origin isn't set yet, set it from the first drop too (fallback)
    if (!worldOrigin) {
      worldOrigin = { lat, lon };
    }

    const block = {
      id: nextBlockId++,
      lat,
      lon,
      color: clients[socket.id]?.color || "#ffffff"
    };

    droppedBlocks.push(block);
    emitWorldState();
  });

  socket.on("toggleColor", () => {
    const current = clients[socket.id]?.color;
    if (!current) return;

    const idx = Math.max(0, COLORS.indexOf(current));
    clients[socket.id].color = COLORS[(idx + 1) % COLORS.length];
    emitWorldState();
  });

  socket.on("disconnect", () => {
    delete clients[socket.id];
    emitWorldState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
