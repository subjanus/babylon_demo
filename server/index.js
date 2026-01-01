import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, { cors: { origin: "*" } });

const players = new Map();
const ORIGIN = { lat0: 35.9940, lon0: -78.8986 };

function latLonToXZ(lat, lon) {
  const R = 6371000;
  const lat0 = ORIGIN.lat0 * Math.PI / 180;
  const dLat = (lat - ORIGIN.lat0) * Math.PI / 180;
  const dLon = (lon - ORIGIN.lon0) * Math.PI / 180;
  return {
    x: R * dLon * Math.cos(lat0),
    z: R * dLat
  };
}

io.on("connection", socket => {
  const id = socket.id;
  players.set(id, { id, ...latLonToXZ(ORIGIN.lat0, ORIGIN.lon0) });

  socket.emit("hello", { id, origin: ORIGIN });

  socket.on("gps", data => {
    const p = players.get(id);
    if (!p) return;
    Object.assign(p, latLonToXZ(data.lat, data.lon));
  });

  socket.on("disconnect", () => players.delete(id));
});

setInterval(() => {
  io.emit("state", { players: [...players.values()] });
}, 100);

server.listen(process.env.PORT || 10000);
