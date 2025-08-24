const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const { Scene } = require('./scene');
const { registry } = require('./actions');

const COLORS = ["#00A3FF","#FFCC00","#34D399","#F472B6","#F59E0B","#22D3EE","#A78BFA"];

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Authoritative state
const scene = new Scene();
const clients = new Map();
let colorIdx = 0;

const ctx = {
  scene,
  clients,
  ref: { lat:null, lon:null },
  broadcastScene: () => io.emit("sceneUpdate", scene.snapshot()),
};

io.on('connection', (socket) => {
  const color = COLORS[colorIdx++ % COLORS.length];
  clients.set(socket.id, { color });
  socket.emit("welcome", { color });
  socket.emit("sceneUpdate", scene.snapshot());

  socket.on("gpsUpdate", ({ lat, lon }) => {
    const c = clients.get(socket.id) || {};
    clients.set(socket.id, { ...c, lat, lon });
    socket.broadcast.emit("peerPosition", { id: socket.id, lat, lon });
  });

  socket.on("invoke", ({ action, args = {}, id }) => {
    const fn = registry[action];
    if (!fn) return socket.emit("invokeResult", { id, ok:false, error:"unknown_action" });
    try {
      const result = fn({ ...ctx }, args, { socket, io });
      socket.emit("invokeResult", { id, ...result });
    } catch(e) {
      socket.emit("invokeResult", { id, ok:false, error:e.message });
    }
  });

  socket.on("objectEvent", ({ objectId, event, args = {} }) => {
    const fn = registry[event];
    if (fn) fn({ ...ctx }, { id:objectId, ...args }, { socket, io });
  });

  socket.on("disconnect", () => {
    clients.delete(socket.id);
    io.emit("removeClient", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running http://localhost:${PORT}`));
