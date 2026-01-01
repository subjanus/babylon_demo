// public/main.js
// Recommended fix package:
// 1) Stable shared origin from server (worldOrigin) so everyone agrees on coordinates.
// 2) Smooth + deadband local GPS so the world doesn't "swing" from jitter.
// 3) Optional heading stabilization (Lock North) to neutralize compass drift if desired.
// 4) Remote users get spheres; local user does not.

import { initScene } from "./initScene.js";
import { initCamera } from "./initCamera.js";
import { requestDevicePermissions } from "./requestPermissions.js";
import { initBox } from "./initBox.js";

// --- UI ---
const canvas = document.getElementById("renderCanvas");
const statusEl = document.getElementById("status");
const btnPerm  = document.getElementById("btnPerm");
const btnNorth = document.getElementById("btnNorth");
const btnColor = document.getElementById("btnColor");
const btnDrop  = document.getElementById("btnDrop");

// --- Babylon ---
const { engine, scene } = initScene(canvas);
const camera = initCamera(scene, canvas);

// A root node for world objects (lets us optionally stabilize heading by rotating the world).
const worldRoot = new BABYLON.TransformNode("worldRoot", scene);

// Expose minimal debug handles (optional)
window.__scene = scene;

// --- Socket ---
const socket = io({
  path: "/socket.io",
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 800
});

// --- Constants ---
const PLAYER_CUBE_Y  = -5;   // below the camera but still reasonable
const DROPPED_CUBE_Y = -1;   // "ground-ish"
const REMOTE_SPHERE_Y_OFFSET = 10;

const GPS_ALPHA = 0.12;      // smoothing strength (0..1). Higher = more responsive, more jitter.
const DEAD_BAND_M = 1.8;     // ignore smaller movements (meters)
const SEND_MIN_MS = 350;     // throttle outgoing gps updates

const YAW_ALPHA = 0.08;      // heading smoothing if Lock North is enabled

// --- State ---
let worldOrigin = null;      // {lat, lon} from server
let metersPerDegLon = null;

let rawLat = null, rawLon = null;
let filtLat = null, filtLon = null;
let lastSentLat = null, lastSentLon = null;
let lastSentAt = 0;

// Lock North
let lockNorth = false;
let yawZero = 0;
let yawSmoothed = 0;

// Entities
const playerCubes = {};  // socketId -> cube mesh (including local)
const remoteSpheres = {}; // socketId -> sphere mesh (remote only)
const droppedCubes = {}; // blockId -> cube mesh

// --- Helpers ---
function isNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function setupProjection(origin) {
  if (!origin) return;
  const lat0 = origin.lat;
  worldOrigin = origin;
  metersPerDegLon = 111320 * Math.cos(lat0 * Math.PI / 180);
}

function latLonToXZ(lat, lon) {
  // Fallback: if origin missing, treat first value as origin
  if (!worldOrigin) setupProjection({ lat, lon });

  const dLat = (lat - worldOrigin.lat);
  const dLon = (lon - worldOrigin.lon);
  const x = dLon * metersPerDegLon;
  const z = dLat * 111320;
  return { x, z };
}

function distMeters(lat1, lon1, lat2, lon2) {
  if (!worldOrigin) return Infinity;
  const a = latLonToXZ(lat1, lon1);
  const b = latLonToXZ(lat2, lon2);
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

function ensurePlayerCube(id, color) {
  if (!playerCubes[id]) {
    const cube = initBox(scene, color);
    cube.name = `playerCube_${id}`;
    cube.parent = worldRoot;
    playerCubes[id] = cube;
  }
  return playerCubes[id];
}

function ensureRemoteSphere(id, color) {
  if (remoteSpheres[id]) return remoteSpheres[id];

  const sphere = BABYLON.MeshBuilder.CreateSphere(
    `remoteSphere_${id}`,
    { diameter: 2, segments: 16 },
    scene
  );

  const mat = new BABYLON.StandardMaterial(`remoteSphereMat_${id}`, scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(color || "#FFCC00");
  mat.specularColor = BABYLON.Color3.Black();
  sphere.material = mat;

  sphere.parent = worldRoot;
  sphere.isPickable = false;

  remoteSpheres[id] = sphere;
  return sphere;
}

function ensureDroppedCube(blockId, color) {
  if (!droppedCubes[blockId]) {
    const cube = initBox(scene, color);
    cube.name = `droppedCube_${blockId}`;
    cube.parent = worldRoot;
    droppedCubes[blockId] = cube;
  }
  return droppedCubes[blockId];
}

// Extract yaw from camera quaternion (radians)
function getCameraYawRad() {
  const q = camera.rotationQuaternion;
  if (!q) return camera.rotation?.y || 0;

  // Convert quaternion to yaw (Y axis) using a common formula.
  const ysqr = q.y * q.y;

  // yaw (Y axis rotation)
  const t3 = +2.0 * (q.w * q.y + q.x * q.z);
  const t4 = +1.0 - 2.0 * (ysqr + q.z * q.z);
  return Math.atan2(t3, t4);
}

function normalizeAngleRad(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function applyHeadingStabilization() {
  if (!lockNorth) {
    worldRoot.rotation.y = 0;
    return;
  }

  const yaw = getCameraYawRad();
  // Smooth yaw
  const delta = normalizeAngleRad(yaw - yawSmoothed);
  yawSmoothed = normalizeAngleRad(yawSmoothed + delta * YAW_ALPHA);

  // Keep world stable relative to the heading at the moment we locked it.
  worldRoot.rotation.y = -(yawSmoothed - yawZero);
}

// --- UI wiring ---
if (btnPerm) {
  btnPerm.addEventListener("click", async () => {
    const ok = await requestDevicePermissions();
    btnPerm.textContent = ok ? "Motion Enabled" : "Motion Blocked";
  });
}

if (btnNorth) {
  btnNorth.addEventListener("click", () => {
    lockNorth = !lockNorth;
    // Capture current smoothed yaw as "north zero" at lock time
    yawSmoothed = getCameraYawRad();
    yawZero = yawSmoothed;

    btnNorth.textContent = lockNorth ? "Lock North: On" : "Lock North: Off";
  });
}

if (btnColor) {
  btnColor.addEventListener("click", () => socket.emit("toggleColor"));
}

if (btnDrop) {
  btnDrop.addEventListener("click", () => {
    // Use filtered position if available, else raw.
    const lat = isNumber(filtLat) ? filtLat : rawLat;
    const lon = isNumber(filtLon) ? filtLon : rawLon;
    if (!isNumber(lat) || !isNumber(lon)) return;
    socket.emit("dropCube", { lat, lon });
  });
}

// --- GPS ---
function onGeo(lat, lon) {
  rawLat = lat;
  rawLon = lon;

  if (filtLat === null || filtLon === null) {
    filtLat = lat;
    filtLon = lon;
  } else {
    filtLat = filtLat + (lat - filtLat) * GPS_ALPHA;
    filtLon = filtLon + (lon - filtLon) * GPS_ALPHA;
  }

  const now = Date.now();
  if (lastSentLat === null || lastSentLon === null) {
    lastSentLat = filtLat;
    lastSentLon = filtLon;
    lastSentAt = now;
    socket.emit("gpsUpdate", { lat: filtLat, lon: filtLon });
    return;
  }

  if (now - lastSentAt < SEND_MIN_MS) return;

  // deadband in meters
  const moved = distMeters(lastSentLat, lastSentLon, filtLat, filtLon);
  if (moved < DEAD_BAND_M) return;

  lastSentLat = filtLat;
  lastSentLon = filtLon;
  lastSentAt = now;
  socket.emit("gpsUpdate", { lat: filtLat, lon: filtLon });
}

// Start watchPosition immediately (permissions may be needed on iOS; that's okay — it will fail quietly)
if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      if (isNumber(lat) && isNumber(lon)) onGeo(lat, lon);
    },
    () => {},
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 20000
    }
  );
}

// --- World reconciliation (authoritative snapshots) ---
function reconcileWorld(state) {
  if (state.worldOrigin && (!worldOrigin || state.worldOrigin.lat !== worldOrigin.lat || state.worldOrigin.lon !== worldOrigin.lon)) {
    setupProjection(state.worldOrigin);
  }

  const clientIds = Object.keys(state.clients || {});
  const blockCount = (state.droppedBlocks || []).length;

  // HUD
  statusEl.textContent = `Connected | Users: ${clientIds.length} | Cubes: ${blockCount}`;

  // Players
  for (const [id, c] of Object.entries(state.clients || {})) {
    const cube = ensurePlayerCube(id, c.color);

    if (isNumber(c.lat) && isNumber(c.lon)) {
      const { x, z } = latLonToXZ(c.lat, c.lon);
      cube.position.set(x, PLAYER_CUBE_Y, z);
    }

    // Remote sphere (everyone except local socket.id)
    if (id !== socket.id) {
      const sphere = ensureRemoteSphere(id, c.color);
      sphere.position.x = cube.position.x;
      sphere.position.z = cube.position.z;
      sphere.position.y = camera.position.y + REMOTE_SPHERE_Y_OFFSET;
    } else {
      // No local sphere
      if (remoteSpheres[id]) {
        remoteSpheres[id].dispose();
        delete remoteSpheres[id];
      }
    }
  }

  // Remove disconnected players
  for (const id of Object.keys(playerCubes)) {
    if (!state.clients || !state.clients[id]) {
      playerCubes[id].dispose();
      delete playerCubes[id];

      if (remoteSpheres[id]) {
        remoteSpheres[id].dispose();
        delete remoteSpheres[id];
      }
    }
  }

  // Dropped cubes
  for (const b of (state.droppedBlocks || [])) {
    if (!isNumber(b.lat) || !isNumber(b.lon)) continue;
    const cube = ensureDroppedCube(b.id, b.color);

    const { x, z } = latLonToXZ(b.lat, b.lon);
    cube.position.set(x, DROPPED_CUBE_Y, z);
  }
}

socket.on("connect", () => {
  statusEl.textContent = "Connected";
});

socket.on("worldState", (state) => {
  reconcileWorld(state);
});

// --- Render loop ---
engine.runRenderLoop(() => {
  applyHeadingStabilization();
  scene.render();
});

window.addEventListener("resize", () => engine.resize());
