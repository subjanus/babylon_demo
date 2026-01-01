const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Same-origin by default. (If you host client separately, add explicit CORS here.)
const io = new Server(server, {
  path: '/socket.io',
});

const COLORS = ["#00A3FF", "#FFCC00", "#34D399", "#F472B6", "#F59E0B", "#22D3EE", "#A78BFA"];
let nextColorIdx = 0;

const clients = {};          // id -> { lat, lon, color }
const droppedBlocks = [];    // [{ id, lat, lon, color }]
let nextBlockId = 1;

io.on('connection', (socket) => {
  console.log('client connected', socket.id);

  const color = COLORS[nextColorIdx++ % COLORS.length];
  clients[socket.id] = { lat: null, lon: null, color };

  socket.emit('initialState', { clients, droppedBlocks, myColor: color });
  io.emit('clientListUpdate', clients);

  socket.on('gpsUpdate', ({ lat, lon }) => {
    if (!clients[socket.id]) return;
    clients[socket.id].lat = lat;
    clients[socket.id].lon = lon;
    socket.broadcast.emit('updateClientPosition', { id: socket.id, lat, lon });
    io.emit('clientListUpdate', clients);
  });

  socket.on('dropCube', ({ lat, lon }) => {
    if (typeof lat !== 'number' || typeof lon !== 'number') return;
    const color = clients[socket.id]?.color || null;
    const block = { id: nextBlockId++, lat, lon, color };
    droppedBlocks.push(block);
    io.emit('createBlock', block);
  });

  socket.on('toggleColor', () => {
    const current = clients[socket.id]?.color;
    if (!current) return;
    let idx = COLORS.indexOf(current);
    if (idx < 0) idx = 0;
    const next = COLORS[(idx + 1) % COLORS.length];
    clients[socket.id].color = next;
    io.emit('colorUpdate', { id: socket.id, color: next });
  });

  socket.on('disconnect', () => {
    console.log('client disconnected', socket.id);
    delete clients[socket.id];
    io.emit('removeClient', socket.id);
    io.emit('clientListUpdate', clients);
  });
});

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
