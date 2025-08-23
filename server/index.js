const express = require('express');
const http = require('http');
const { Server } = require('socket.io');


const app = express();
const server = http.createServer(app);
const io = new Server(server);


// Simple color palette to cycle through for fun
const COLORS = ["#00A3FF", "#FFCC00", "#34D399", "#F472B6", "#F59E0B", "#22D3EE", "#A78BFA"];
let nextColorIdx = 0;


// Authoritative state
const clients = {}; // id -> { lat, lon, color }
const droppedBlocks = []; // [{ lat, lon }]


io.on('connection', (socket) => {
// assign a color on join
const color = COLORS[nextColorIdx++ % COLORS.length];
clients[socket.id] = { lat: null, lon: null, color };


// Send snapshot to the newcomer, including their current color
socket.emit('initialState', { clients, droppedBlocks, myColor: color });
io.emit('clientListUpdate', clients);


socket.on('gpsUpdate', ({ lat, lon }) => {
if (!clients[socket.id]) return;
clients[socket.id].lat = lat; clients[socket.id].lon = lon;
socket.broadcast.emit('updateClientPosition', { id: socket.id, lat, lon });
io.emit('clientListUpdate', clients);
});


socket.on('dropCube', ({ lat, lon }) => {
if (typeof lat !== 'number' || typeof lon !== 'number') return;
droppedBlocks.push({ lat, lon });
io.emit('createBlock', { lat, lon });
});


socket.on('toggleColor', () => {
if (!clients[socket.id]) return;
// rotate to a new color
const current = clients[socket.id].color;
let idx = COLORS.indexOf(current);
if (idx < 0) idx = 0;
const next = COLORS[(idx + 1) % COLORS.length];
clients[socket.id].color = next;
io.emit('colorUpdate', { id: socket.id, color: next });
});


socket.on('disconnect', () => {
delete clients[socket.id];
io.emit('removeClient', socket.id);
io.emit('clientListUpdate', clients);
});
});


app.use(express.static('public'));


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));