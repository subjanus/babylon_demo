import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

io.on('connection', (socket) => {
  socket.on('code:run', ({ snippet }) => {
    const msg = { from: socket.id, len: (snippet||'').length, at: Date.now() };
    socket.emit('code:ack', msg);
    socket.broadcast.emit('code:notice', msg);
  });
});

server.listen(PORT, () => console.log('Listening on http://localhost:'+PORT));