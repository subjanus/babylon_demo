// public/main.js
// Illustrative wiring for local vs remote players

import { initBox, createRemoteSphere } from './initBox.js';
import { updatePlayerPosition, updateRemoteSphere } from './geo.js';

const socket = io();

const localCube = initBox(scene, "#00A3FF");

// remote players map
const remotes = {};

socket.on("playerJoined", ({ id, color }) => {
  const cube = initBox(scene, color);
  const sphere = createRemoteSphere(scene, color);
  remotes[id] = { cube, sphere };
});

socket.on("playerMoved", ({ id, x, z }) => {
  const p = remotes[id];
  if (!p) return;
  updatePlayerPosition(p.cube, x, z);
  updateRemoteSphere(p.sphere, p.cube, scene);
});

// local GPS update (example)
function onLocalGPS(x, z) {
  updatePlayerPosition(localCube, x, z);
  socket.emit("move", { x, z });
}
