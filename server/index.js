const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const fs      = require('fs');

const clients  = require('./modules/clients.js');
const blocks   = require('./modules/blocks.js');
const diag     = require('./modules/diagnostics.js');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

// Periodically sync blocks to all clients
setInterval(() => {
  io.emit('initialBlocks', blocks.list());
}, 5000);

io.on('connection', (socket) => {
  // Send current blocks
  socket.emit('initialBlocks', blocks.list());

  // GPS updates
  socket.on('gpsUpdate', ({ lat, lon }) => {
    clients.update(socket.id, lat, lon);
    socket.broadcast.emit('updateClientPosition', { id: socket.id, lat, lon });
    io.emit('clientListUpdate', clients.all());
  });

  // Drop block
  socket.on('dropCube', ({ lat, lon }) => {
    blocks.add(lat, lon);
    io.emit('createBlock', { lat, lon });
  });

  socket.on('disconnect', () => {
    clients.remove(socket.id);
    io.emit('removeClient', socket.id);
    io.emit('clientListUpdate', clients.all());
  });
});

// Optionally start diagnostics loop
diag.start(io);

// Static
const staticRoot = path.join(__dirname, '..', 'public');
app.use(express.static(staticRoot));
app.get('*', (req, res) => {
  const file = path.join(staticRoot, 'index.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  res.status(404).send('index.html not found');
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => console.log(`Server listening on http://${HOST}:${PORT}`));
