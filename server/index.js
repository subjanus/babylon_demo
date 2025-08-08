const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const fs      = require('fs'); // added for fallback

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

const clients       = {};
const droppedBlocks = [];    // ← holds all dropped‐cube coords

io.on('connection', (socket) => {
  // initialize this client
  clients[socket.id] = { lat: null, lon: null };

  // send existing blocks to the newcomer
  socket.emit('initialBlocks', droppedBlocks);

  // broadcast your color state
  socket.emit('colorUpdate', /* your current color if using toggle */ );

  // color toggle (unchanged)
  socket.on('toggleColor', () => {
    // ... your existing toggle logic ...
    io.emit('colorUpdate', /* newColor */);
  });

  // GPS updates
  socket.on('gpsUpdate', ({ lat, lon }) => {
    clients[socket.id] = { lat, lon };
    socket.broadcast.emit('updateClientPosition', { id: socket.id, lat, lon });
    io.emit('clientListUpdate', clients);
  });

  // DROP CUBE: store and broadcast to all clients
  socket.on('dropCube', ({ lat, lon }) => {
    const block = { lat, lon };
    droppedBlocks.push(block);
    io.emit('createBlock', block);
  });

  // disconnect cleanup
  socket.on('disconnect', () => {
    delete clients[socket.id];
    io.emit('removeClient', socket.id);
    io.emit('clientListUpdate', clients);
  });
});

// ===== Static hosting fix =====
// Resolve path to public folder one level up from /server
const staticRoot = path.join(__dirname, '..', 'public');
app.use(express.static(staticRoot));

// Fallback to index.html so "/" works on Render
app.get('*', (req, res) => {
  const file = path.join(staticRoot, 'index.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  res.status(404).send('index.html not found');
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => console.log(`Server running on port ${PORT}`));
