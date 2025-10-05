import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// presence map
const state = new Map();

function peerSummary() {
  const arr = [];
  state.forEach((v) => {
    arr.push({
      id: v.id, name: v.name || v.id.slice(0,5),
      sessionId: v.sessionId, gps: v.gps || null,
      orient: v.orient || null, lastSeen: v.lastSeen || null
    });
  });
  return arr;
}

io.on('connection', (socket) => {
  const id = socket.id;
  const role = socket.handshake.query.role === 'admin' ? 'admin' : 'client';
  state.set(id, { id, role, lastSeen: Date.now() });
  io.emit('peer:join', { id, role });

  socket.on('client:hello', (msg = {}) => {
    const s = state.get(id); if (!s) return;
    s.name = msg.name || s.name;
    s.sessionId = msg.sessionId || s.sessionId;
    s.lastSeen = Date.now();
    socket.emit('server:peers', peerSummary());
  });

  socket.on('client:update', (msg = {}) => {
    const s = state.get(id); if (!s) return;
    if (msg.gps) s.gps = msg.gps;
    if (msg.orient) s.orient = msg.orient;
    s.lastSeen = Date.now();
    socket.broadcast.emit('peer:update', { id, gps: s.gps, orient: s.orient, lastSeen: s.lastSeen });
  });

  socket.on('request:peers', () => socket.emit('server:peers', peerSummary()));
  socket.on('admin:peek', () => socket.emit('server:peers', peerSummary()));

  // Relay shape spawns/updates to others
  socket.on('shape:spawn', (payload = {}) => {
    payload.from = id;
    socket.broadcast.emit('shape:spawn', payload);
  });

  socket.on('disconnect', () => {
    state.delete(id);
    io.emit('peer:leave', { id });
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});