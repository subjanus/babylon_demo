// server/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let color = '#ff0000';

io.on('connection', (socket) => {
  socket.emit('colorUpdate', color);

  socket.on('toggleColor', () => {
    color = color === '#ff0000' ? '#00ff00' : '#ff0000';
    io.emit('colorUpdate', color);
  });
});

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
