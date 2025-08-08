const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: true }});

const clients       = {};       // {socketId: { lat, lon }}
const droppedBlocks = [];       // if you use block-drops elsewhere
const diagSamples   = {};       // { socketId: { t, device, lat, lon, accuracy, proj:{x,y,z}, mesh:{x,y,z} } }

// --- SOCKET HANDLERS ---
io.on('connection', (socket) => {
  clients[socket.id] = { lat: null, lon: null };

  // Send existing blocks if you have that feature
  socket.emit('initialBlocks', droppedBlocks);

  // GPS updates from client
  socket.on('gpsUpdate', ({ lat, lon }) => {
    clients[socket.id] = { lat, lon };
    socket.broadcast.emit('updateClientPosition', { id: socket.id, lat, lon });
    io.emit('clientListUpdate', clients);
  });

  // Optional: user drops a cube (persist + broadcast)
  socket.on('dropCube', ({ lat, lon }) => {
    const block = { lat, lon };
    droppedBlocks.push(block);
    io.emit('createBlock', block);
  });

  // Diagnostics sample from clients
  socket.on('diagSample', (sample) => {
    diagSamples[socket.id] = sample;
  });

  socket.on('disconnect', () => {
    delete clients[socket.id];
    delete diagSamples[socket.id];
    io.emit('removeClient', socket.id);
    io.emit('clientListUpdate', clients);
  });
});

// Periodic server-side pairwise diagnostics (laptop vs iphone, etc.)
setInterval(() => {
  const recent = Object.entries(diagSamples)
    .map(([id, s]) => ({ id, s }))
    .sort((a, b) => b.s.t - a.s.t)
    .slice(0, 6);

  if (recent.length < 2) return;

  for (let i = 0; i < recent.length; i++) {
    for (let j = i + 1; j < recent.length; j++) {
      const A = recent[i].s, B = recent[j].s;
      const dLat = (A.lat ?? 0) - (B.lat ?? 0);
      const dLon = (A.lon ?? 0) - (B.lon ?? 0);
      const dPX = (A.proj?.x ?? 0) - (B.proj?.x ?? 0);
      const dPY = (A.proj?.y ?? 0) - (B.proj?.y ?? 0);
      const dPZ = (A.proj?.z ?? 0) - (B.proj?.z ?? 0);
      const dMX = (A.mesh?.x ?? 0) - (B.mesh?.x ?? 0);
      const dMY = (A.mesh?.y ?? 0) - (B.mesh?.y ?? 0);
      const dMZ = (A.mesh?.z ?? 0) - (B.mesh?.z ?? 0);

      io.emit('diagnostics', {
        ts: Date.now(),
        pair: [A.device || 'A', B.device || 'B'],
        gps: { dLat, dLon },
        proj: { dPX, dPY, dPZ },
        mesh: { dMX, dMY, dMZ },
        acc: { A: A.accuracy, B: B.accuracy }
      });
    }
  }
}, 1000);

// --- STATIC ---
app.use(express.static(path.join(__dirname, 'public')));

// --- START ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
