import { initScene } from "./initScene.js";
import { initCamera } from "./initCamera.js";
import { requestDevicePermissions } from "./requestPermissions.js";
import { initBox } from "./initBox.js";
import { latLonToLocal, toFix5 } from "./geo.js";

const state = {
  refLat: null, refLon: null,
  myLat: null,  myLon: null,
  others: new Map(),  // id -> { mesh, color, lat, lon, localX, localZ, justSpawned }
  blocks: new Map(),  // id -> { lat, lon, localX, localZ, color, mesh, justSpawned }
  myColor: "#00A3FF",
  clientCount: null,
  myLocalX: 0,
  myLocalZ: 0,
  myLocalTargetX: 0,
  myLocalTargetZ: 0,
  gyroEnabled: false
};

const SELF_SMOOTH_SPEED = 5;
const ENTITY_SMOOTH_SPEED = 6;
const BLOCK_SMOOTH_SPEED = 10;

function clamp01(v) {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function lerp(from, to, t) {
  return from + (to - from) * t;
}

const canvas   = document.getElementById("renderCanvas");
const hud      = document.getElementById("status");
const btnPerm  = document.getElementById("btnPerm");
const btnColor = document.getElementById("btnColor");
const btnDrop  = document.getElementById("btnDrop");

// Prefer same-origin Socket.IO when server & static are one service.
const socket = io(window.location.origin, {
  path: "/socket.io",
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 800
});

socket.on("connect", () => {
  console.log("socket connected", socket.id);
  hud.textContent = `Connected as ${socket.id}`;
});

socket.on("connect_error", (err) => {
  console.error("connect_error", err);
  hud.textContent = `Socket error: ${err.message || err}`;
});

socket.on("disconnect", (reason) => {
  console.warn("socket disconnected", reason);
  hud.textContent = `Disconnected: ${reason}`;
});

// Scene, camera, player cube
const { engine, scene } = initScene(canvas);
const camera = initCamera(scene, canvas);
const me     = initBox(scene, state.myColor);
me.isVisible = false;
me.isPickable = false;

// --- Helpers ---
function updateHUD(clientsCount = null) {
  const lat = state.myLat != null ? state.myLat.toFixed(5) : "…";
  const lon = state.myLon != null ? state.myLon.toFixed(5) : "…";
  const parts = [
    `You: ${lat}, ${lon}`,
    state.refLat != null ? `Ref: ${state.refLat.toFixed(5)}, ${state.refLon.toFixed(5)}` : "Ref: …",
  ];
  if (clientsCount != null) state.clientCount = clientsCount;
  if (state.clientCount != null) parts.push(`Clients: ${state.clientCount}`);
  parts.push(`Cubes: ${state.blocks.size}`);
  parts.push(state.gyroEnabled ? "Gyro: ON" : "Gyro: off");
  hud.textContent = parts.join("  |  ");
}

function offsetToPlayerFrame(x = 0, z = 0) {
  return {
    x: x - (state.myLocalX ?? 0),
    z: z - (state.myLocalZ ?? 0)
  };
}

function ensureBlockMesh(rec) {
  if (!rec) return;
  if (!rec.mesh) {
    const block = BABYLON.MeshBuilder.CreateBox("block", { size: 0.8 }, scene);
    const mat = new BABYLON.StandardMaterial("blockMat", scene);
    block.material = mat;
    block.position = new BABYLON.Vector3(0, 0.4, 0);
    block.isPickable = false;
    block.isVisible = false;
    rec.mesh = block;
    rec.justSpawned = true;
  }
  const hex = rec.color || "#9C62E0";
  rec.mesh.material.diffuseColor = BABYLON.Color3.FromHexString(hex);
}

function updateBlockLocal(rec) {
  if (!rec || rec.lat == null || rec.lon == null || state.refLat == null) return false;
  if (!Number.isFinite(rec.lat) || !Number.isFinite(rec.lon)) return false;
  const { x, z } = latLonToLocal(rec.lat, rec.lon, state.refLat, state.refLon);
  const first = rec.localX == null && rec.localZ == null;
  rec.localX = x;
  rec.localZ = z;
  if (first) rec.justSpawned = true;
  return true;
}

function upsertBlock({ id, lat, lon, color }) {
  if (id == null) return;
  let rec = state.blocks.get(id);
  if (!rec) {
    rec = { id, lat: null, lon: null, localX: null, localZ: null, color: color || null, mesh: null, justSpawned: true };
    state.blocks.set(id, rec);
  }
  if (typeof lat === "number") rec.lat = lat;
  if (typeof lon === "number") rec.lon = lon;
  const nextColor = color || rec.color || "#9C62E0";
  rec.color = nextColor;
  if (state.refLat != null) updateBlockLocal(rec);
  ensureBlockMesh(rec);
  updateHUD();
}

function ensureOther(id, color) {
  let rec = state.others.get(id);
  if (!rec) {
    const mesh = BABYLON.MeshBuilder.CreateSphere(`p_${id}`, { diameter: 1.6 }, scene);
    const mat = new BABYLON.StandardMaterial(`p_${id}_mat`, scene);
    mesh.material = mat;
    mesh.position = new BABYLON.Vector3(0, 0.8, 0);
    mesh.isPickable = false;
    mesh.isVisible = false;
    rec = { mesh, color: null, lat: null, lon: null, localX: null, localZ: null, justSpawned: true };
    state.others.set(id, rec);
  }
  const nextColor = color ?? rec.color ?? "#FFCC00";
  if (nextColor !== rec.color) {
    rec.color = nextColor;
    rec.mesh.material.diffuseColor = BABYLON.Color3.FromHexString(nextColor);
  }
  return rec;
}

function removeOther(id) {
  const rec = state.others.get(id);
  if (rec) {
    rec.mesh.dispose();
    state.others.delete(id);
  }
}

function setMyColor(hex) {
  state.myColor = hex;
  if (me && me.material) {
    me.material.diffuseColor = BABYLON.Color3.FromHexString(hex);
  }
}

function updateOtherLocal(rec) {
  if (!rec || rec.lat == null || rec.lon == null || state.refLat == null) return false;
  if (!Number.isFinite(rec.lat) || !Number.isFinite(rec.lon)) return false;
  const { x, z } = latLonToLocal(rec.lat, rec.lon, state.refLat, state.refLon);
  const first = rec.localX == null && rec.localZ == null;
  rec.localX = x;
  rec.localZ = z;
  if (first) rec.justSpawned = true;
  return true;
}

function realizePendingEntities() {
  state.blocks.forEach(rec => {
    ensureBlockMesh(rec);
    updateBlockLocal(rec);
  });
  state.others.forEach((rec, id) => {
    const ensured = ensureOther(id, rec.color);
    updateOtherLocal(ensured);
  });
}

function applySmoothing(rec, targetX, targetZ, height, t) {
  if (!rec.mesh) return;
  if (rec.justSpawned || !Number.isFinite(rec.mesh.position.x) || !Number.isFinite(rec.mesh.position.z)) {
    rec.mesh.position.x = targetX;
    rec.mesh.position.z = targetZ;
    rec.justSpawned = false;
  } else {
    rec.mesh.position.x = lerp(rec.mesh.position.x, targetX, t);
    rec.mesh.position.z = lerp(rec.mesh.position.z, targetZ, t);
  }
  rec.mesh.position.y = height;
  rec.mesh.isVisible = true;
}

function updateBlockRender(rec, deltaSec) {
  if (!rec || !rec.mesh) return;
  if ((rec.localX == null || rec.localZ == null) && !updateBlockLocal(rec)) return;
  const rel = offsetToPlayerFrame(rec.localX, rec.localZ);
  const t = clamp01(deltaSec * BLOCK_SMOOTH_SPEED);
  applySmoothing(rec, rel.x, rel.z, 0.4, t);
}

function updateOtherRender(rec, deltaSec) {
  if (!rec || !rec.mesh) return;
  if ((rec.localX == null || rec.localZ == null) && !updateOtherLocal(rec)) return;
  const rel = offsetToPlayerFrame(rec.localX, rec.localZ);
  const t = clamp01(deltaSec * ENTITY_SMOOTH_SPEED);
  applySmoothing(rec, rel.x, rel.z, 0.8, t);
}

function stepFrame(deltaMs) {
  const deltaSec = clamp01(Math.max(deltaMs, 0) / 1000);
  const selfT = clamp01(deltaSec * SELF_SMOOTH_SPEED);
  state.myLocalX = lerp(state.myLocalX, state.myLocalTargetX, selfT);
  state.myLocalZ = lerp(state.myLocalZ, state.myLocalTargetZ, selfT);

  state.blocks.forEach(rec => updateBlockRender(rec, deltaSec));
  state.others.forEach(rec => updateOtherRender(rec, deltaSec));
}

// --- Motion/orientation permissions (iOS) ---
async function enableMotionFromGesture() {
  const granted = await requestDevicePermissions();
  state.gyroEnabled = !!granted;
  btnPerm.disabled = granted;
  updateHUD();
  if (!granted) {
    hud.textContent = "Motion/orientation not granted. Try Safari settings or tap again.";
  }
}
btnPerm.addEventListener("click", enableMotionFromGesture, { passive: true });

// Also allow a single canvas tap to request (nice on mobile)
canvas.addEventListener("click", async () => {
  if (btnPerm.disabled) return;
  await enableMotionFromGesture();
}, { once: true });

// --- Buttons ---
btnColor.addEventListener("click", () => socket.emit("toggleColor"));
btnDrop.addEventListener("click", () => {
  if (state.myLat == null || state.myLon == null) return;
  socket.emit("dropCube", { lat: state.myLat, lon: state.myLon });
});

// --- Geolocation watch ---
function startGps() {
  if (!("geolocation" in navigator)) { hud.textContent = "No geolocation available"; return; }
  navigator.geolocation.watchPosition(pos => {
    const { latitude, longitude } = pos.coords;
    const lat = toFix5(latitude);
    const lon = toFix5(longitude);

    const firstFix = state.refLat == null;
    if (firstFix) {
      state.refLat = lat;
      state.refLon = lon;
    }

    if (state.refLat != null) {
      const { x, z } = latLonToLocal(lat, lon, state.refLat, state.refLon);
      state.myLocalTargetX = x;
      state.myLocalTargetZ = z;
      if (firstFix) {
        state.myLocalX = x;
        state.myLocalZ = z;
        state.myLocalTargetX = x;
        state.myLocalTargetZ = z;
        realizePendingEntities();
      }
    }

    // Emit only on change
    if (lat !== state.myLat || lon !== state.myLon) {
      state.myLat = lat; state.myLon = lon;
      socket.emit("gpsUpdate", { lat, lon });
      updateHUD();
    }

  }, err => {
    console.error("GPS error", err);
    hud.textContent = `GPS error: ${err.message}`;
  }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 });
}
startGps();

// --- Socket events ---
socket.on("initialState", ({ clients, droppedBlocks, myColor }) => {
  if (myColor) setMyColor(myColor);
  Object.entries(clients).forEach(([id, c]) => {
    if (id === socket.id) return;
    const rec = ensureOther(id, c.color);
    if (typeof c.lat === "number") rec.lat = c.lat;
    if (typeof c.lon === "number") rec.lon = c.lon;
    if (state.refLat != null) updateOtherLocal(rec);
  });
  droppedBlocks.forEach(block => upsertBlock(block));
  updateHUD(Object.keys(clients).length);
});

socket.on("clientListUpdate", (clients) => {
  const ids = new Set(Object.keys(clients));
  [...state.others.keys()].forEach(id => { if (!ids.has(id) || id === socket.id) removeOther(id); });
  Object.entries(clients).forEach(([id, c]) => {
    if (id === socket.id) return;
    const rec = ensureOther(id, c.color);
    if (typeof c.lat === "number") rec.lat = c.lat;
    if (typeof c.lon === "number") rec.lon = c.lon;
    if (state.refLat != null) updateOtherLocal(rec);
  });
  updateHUD(Object.keys(clients).length);
});

socket.on("updateClientPosition", ({ id, lat, lon }) => {
  if (id === socket.id) return;
  const rec = ensureOther(id);
  if (typeof lat === "number") rec.lat = lat;
  if (typeof lon === "number") rec.lon = lon;
  if (state.refLat != null) updateOtherLocal(rec);
});

socket.on("removeClient", id => removeOther(id));

socket.on("createBlock", block => upsertBlock(block));

socket.on("colorUpdate", ({ id, color }) => {
  if (id === socket.id) { setMyColor(color); return; }
  ensureOther(id, color);
});

// render loop
engine.runRenderLoop(() => {
  const deltaMs = engine.getDeltaTime();
  stepFrame(deltaMs);
  scene.render();
});
window.addEventListener("resize", () => engine.resize());
