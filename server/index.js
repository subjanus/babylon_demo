const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let color = '#ff0000';
const clients = {};
const clientOrder = []; // Track join order

io.on('connection', (socket) => {
  // 1) Register client
  clients[socket.id] = { lat: null, lon: null };
  clientOrder.push(socket.id);

  // 2) Send current color and full client list
  socket.emit('colorUpdate', color);
  io.emit('clientListUpdate', { clients, clientOrder });

  // Color toggle (unchanged)
  socket.on('toggleColor', () => {
    color = color === '#ff0000' ? '#00ff00' : '#ff0000';
    io.emit('colorUpdate', color);
  });

  // GPS updates
  socket.on('gpsUpdate', ({ lat, lon }) => {
    clients[socket.id] = { lat, lon };
    // broadcast position delta
    socket.broadcast.emit('updateClientPosition', {
      id: socket.id, lat, lon
    });
    // send everyone the refreshed list + order
    io.emit('clientListUpdate', { clients, clientOrder });
  });

  // Drop cube request
  socket.on('dropCube', ({ lat, lon }) => {
    io.emit('droppedCube', { id: socket.id, lat, lon });
  });

  // Clean up on disconnect
  socket.on('disconnect', () => {
    delete clients[socket.id];
    const idx = clientOrder.indexOf(socket.id);
    if (idx !== -1) clientOrder.splice(idx, 1);
    io.emit('removeClient', socket.id);
    io.emit('clientListUpdate', { clients, clientOrder });
  });
});

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
