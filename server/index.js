// server/index.js
// Option 1 (authoritative) — FIX: keep authoritative state,
// but do NOT change coordinate semantics (still lat/lon).

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const COLORS = ["#00A3FF", "#FFCC00", "#34D399", "#F472B6", "#F59E0B"];
let nextColor = 0;

const clients = {};        // id -> { lat, lon, color }
const droppedBlocks = [];  // [{ id, lat, lon, color }]
let nextBlockId = 1;

function emitWorldState() {
  io.emit("worldState", {
    clients,
    droppedBlocks
  });
}

io.on("connection", (socket) => {
  const color = COLORS[nextColor++ % COLORS.length];
  clients[socket.id] = { lat: null, lon: null, color };

  // Send full authoritative snapshot
  socket.emit("worldState", { clients, droppedBlocks });

  socket.on("gpsUpdate", ({ lat, lon }) => {
    if (!clients[socket.id]) return;
    clients[socket.id].lat = lat;
    clients[socket.id].lon = lon;
    emitWorldState();
  });

  socket.on("dropCube", ({ lat, lon }) => {
    const block = {
      id: nextBlockId++,
      lat,
      lon,
      color: clients[socket.id]?.color || "#ffffff"
    };
    droppedBlocks.push(block);
    emitWorldState();
  });

  socket.on("disconnect", () => {
    delete clients[socket.id];
    emitWorldState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log("Server listening on http://localhost:" + PORT)
);
