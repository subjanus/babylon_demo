// public/main.js
// OPTION 1: Reconcile full world state whenever received

import { initScene } from "./initScene.js";
import { initCamera } from "./initCamera.js";
import { initBox } from "./initBox.js";

const canvas = document.getElementById("renderCanvas");
const status = document.getElementById("status");

const { engine, scene } = initScene(canvas);
const camera = initCamera(scene, canvas);

const socket = io();

const cubes = {};   // id -> player cube
const dropped = {}; // blockId -> dropped cube

function reconcileWorld(state) {
  // Players
  for (const [id, c] of Object.entries(state.clients)) {
    if (!cubes[id]) {
      cubes[id] = initBox(scene, c.color);
    }
    if (c.lat != null && c.lon != null) {
      cubes[id].position.x = c.lon;
      cubes[id].position.z = c.lat;
      cubes[id].position.y = -130;
    }
  }

  // Remove players no longer present
  for (const id of Object.keys(cubes)) {
    if (!state.clients[id]) {
      cubes[id].dispose();
      delete cubes[id];
    }
  }

  // Dropped blocks
  for (const b of state.droppedBlocks) {
    if (!dropped[b.id]) {
      dropped[b.id] = initBox(scene, b.color);
    }
    dropped[b.id].position.x = b.lon;
    dropped[b.id].position.z = b.lat;
    dropped[b.id].position.y = -130;
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
