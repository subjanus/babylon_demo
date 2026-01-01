// public/main.js
// FIXES:
// 1) Restore HUD stats (clients + cubes)
// 2) Correct lat/lon -> local world mapping (relative coords)

import { initScene } from "./initScene.js";
import { initCamera } from "./initCamera.js";
import { initBox } from "./initBox.js";

const canvas = document.getElementById("renderCanvas");
const status = document.getElementById("status");

const { engine, scene } = initScene(canvas);
const camera = initCamera(scene, canvas);

const socket = io();

// --- World state ---
const cubes = {};   // id -> player cube
const dropped = {}; // blockId -> dropped cube

// Reference origin (first GPS fix)
let originLat = null;
let originLon = null;

// Very simple lat/lon -> meters projection (good enough locally)
function latLonToXZ(lat, lon) {
  if (originLat === null || originLon === null) {
    originLat = lat;
    originLon = lon;
  }
  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos(originLat * Math.PI / 180);

  const x = (lon - originLon) * metersPerDegLon;
  const z = (lat - originLat) * metersPerDegLat;
  return { x, z };
}

function reconcileWorld(state) {
  const clientIds = Object.keys(state.clients);

  // --- HUD ---
  status.textContent =
    `Connected | Users: ${clientIds.length} | Cubes: ${state.droppedBlocks.length}`;

  // --- Players ---
  for (const [id, c] of Object.entries(state.clients)) {
    if (!cubes[id]) {
      cubes[id] = initBox(scene, c.color);
    }
    if (c.lat != null && c.lon != null) {
      const { x, z } = latLonToXZ(c.lat, c.lon);
      cubes[id].position.set(x, -130, z);
    }
  }

  // Remove disconnected players
  for (const id of Object.keys(cubes)) {
    if (!state.clients[id]) {
      cubes[id].dispose();
      delete cubes[id];
    }
  }

  // --- Dropped cubes ---
  for (const b of state.droppedBlocks) {
    if (!dropped[b.id]) {
      dropped[b.id] = initBox(scene, b.color);
    }
    const { x, z } = latLonToXZ(b.lat, b.lon);
    dropped[b.id].position.set(x, -130, z);
  }
}

socket.on("connect", () => {
  status.textContent = "Connected";
});

socket.on("worldState", (state) => {
  reconcileWorld(state);
});

engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());
