// server/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let color = '#ff0000';
const clients = {};

io.on('connection', (socket) => {
  clients[socket.id] = { lat: null, lon: null };

  socket.emit('colorUpdate', color);

  socket.on('toggleColor', () => {
    color = color === '#ff0000' ? '#00ff00' : '#ff0000';
    io.emit('colorUpdate', color);
  });

  socket.on('gpsUpdate', ({ lat, lon }) => {
    clients[socket.id] = { lat, lon };
    socket.broadcast.emit('updateClientPosition', {
      id: socket.id,
      lat,
      lon
    });
    io.emit('clientListUpdate', clients);
  });

  socket.on('disconnect', () => {
    delete clients[socket.id];
    io.emit('removeClient', socket.id);
    io.emit('clientListUpdate', clients);
  });
});

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});