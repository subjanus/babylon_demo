const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve client
app.use(express.static(path.join(__dirname, 'public')));
app.get('/debug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'debug.html'));
});

// --- Game state ---
let worldOrigin = null; // {lat, lon} fixed once set

let nextCubeId = 1;
const cubes = []; // {id, lat, lon, color}

let nextCircleId = 1;
const circles = []; // {id, x, z, scale}

const userColors = [
  '#00A3FF', '#FFCC00', '#34D399', '#F472B6', '#A78BFA', '#FB7185', '#22C55E', '#F59E0B'
];

const users = new Map(); // socket.id -> {id, color, lat, lon, x, z, yaw, lockNorth}
const scores = new Map(); // socket.id -> number

function metersPerDegreeLat() { return 111_320; }
function metersPerDegreeLonAt(latDeg) { return 111_320 * Math.cos(latDeg * Math.PI / 180); }

function projectLatLonToXZ(lat, lon) {
  if (!worldOrigin) return { x: 0, z: 0 };
  const mLat = metersPerDegreeLat();
  const mLon = metersPerDegreeLonAt(worldOrigin.lat);
  const dLat = lat - worldOrigin.lat;
  const dLon = lon - worldOrigin.lon;
  return { x: dLon * mLon, z: dLat * mLat };
}

function snapshotFor(socketId) {
  const usersArr = [...users.values()].map(u => ({
    id: u.id,
    color: u.color,
    x: u.x ?? 0,
    z: u.z ?? 0,
    yaw: u.yaw ?? 0
  }));

  return {
    worldOrigin,
    users: usersArr,
    usersCount: usersArr.length,
    cubes: cubes.slice(),
    cubesCount: cubes.length,
    circles: circles.slice(),
    myScore: scores.get(socketId) ?? 0
  };
}

function broadcastCounts() {
  for (const id of users.keys()) {
    io.to(id).emit('state', snapshotFor(id));
  }
}

io.on('connection', (socket) => {
  const color = userColors[Math.floor(Math.random() * userColors.length)];
  users.set(socket.id, { id: socket.id, color, lat: null, lon: null, x: 0, z: 0, yaw: 0, lockNorth: false });
  if (!scores.has(socket.id)) scores.set(socket.id, 0);

  // Send initial state
  socket.emit('state', snapshotFor(socket.id));

  socket.on('gps', (payload) => {
    const u = users.get(socket.id);
    if (!u || !payload) return;

    const lat = Number(payload.lat);
    const lon = Number(payload.lon);
    if (!isFinite(lat) || !isFinite(lon)) return;

    if (!worldOrigin) {
      worldOrigin = { lat, lon };
      // When origin is first set, resync everyone
      broadcastCounts();
    }

    u.lat = lat;
    u.lon = lon;
    u.yaw = Number(payload.yaw) || 0;
    u.lockNorth = !!payload.lockNorth;

    const xz = projectLatLonToXZ(lat, lon);
    u.x = xz.x;
    u.z = xz.z;

    // Broadcast updated state (cheap & simple)
    broadcastCounts();
  });

  socket.on('dropCube', (payload) => {
    const u = users.get(socket.id);
    if (!u) return;

    const lat = Number(payload?.lat ?? u.lat);
    const lon = Number(payload?.lon ?? u.lon);
    if (!isFinite(lat) || !isFinite(lon)) return;

    const cube = { id: nextCubeId++, lat, lon, color: u.color };
    cubes.push(cube);

    io.emit('cubeAdded', cube);
    broadcastCounts();
  });

  socket.on('deleteCube', ({ cubeId }) => {
    const id = Number(cubeId);
    if (!isFinite(id)) return;
    const idx = cubes.findIndex(c => c.id === id);
    if (idx === -1) return;

    cubes.splice(idx, 1);
    io.emit('cubeDeleted', { cubeId: id });

    // Per-user score (only the deleting client sees it)
    const next = (scores.get(socket.id) ?? 0) + 1;
    scores.set(socket.id, next);
    socket.emit('scoreUpdate', { myScore: next });

    broadcastCounts();
  });

  socket.on('spawnCircles', ({ count, radius }) => {
    const c = Math.max(1, Math.min(500, Number(count) || 60));
    const r = Math.max(1, Math.min(500, Number(radius) || 80));

    const added = [];
    for (let i = 0; i < c; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const scale = 0.6 + Math.random() * 1.6;
      const circle = { id: nextCircleId++, x, z, scale };
      circles.push(circle);
      added.push(circle);
    }

    io.emit('circlesAdded', { circles: added });
    broadcastCounts();
  });

  socket.on('clearCircles', () => {
    circles.length = 0;
    io.emit('circlesCleared');
    broadcastCounts();
  });

  socket.on('disconnect', () => {
    users.delete(socket.id);
    scores.delete(socket.id);
    broadcastCounts();
  });
});

server.listen(PORT, () => {
  console.log(`GPS game listening on http://localhost:${PORT}`);
});
