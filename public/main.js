import { initScene } from "./initScene.js";
import { initCamera } from "./initCamera.js";
import { requestDevicePermissions } from "./requestPermissions.js";
import { initBox } from "./initBox.js";
import { latLonToLocal, toFix5 } from "./geo.js";

const state = {
  refLat: null, refLon: null,
  myLat: null,  myLon: null,
  others: new Map(),  // id -> { mesh, color, lat, lon }
  blocks: new Map(),  // key -> { lat, lon, mesh }
  myColor: "#00A3FF"
};

const canvas = document.getElementById("renderCanvas");
const hud    = document.getElementById("status");
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

// --- Helpers ---
function updateHUD(clientsCount = null) {
  const lat = state.myLat != null ? state.myLat.toFixed(5) : "…";
  const lon = state.myLon != null ? state.myLon.toFixed(5) : "…";
  const parts = [
    `You: ${lat}, ${lon}`,
    state.refLat != null ? `Ref: ${state.refLat.toFixed(5)}, ${state.refLon.toFixed(5)}` : "Ref: …",
  ];
  if (clientsCount != null) parts.push(`Clients: ${clientsCount}`);
  hud.textContent = parts.join("  |  ");
}

function blockKey(lat, lon) {
  return `${lat}:${lon}`;
}

function realizeBlock(rec) {
  if (!rec || state.refLat == null) return;
  const { x, z } = latLonToLocal(rec.lat, rec.lon, state.refLat, state.refLon);
  if (!rec.mesh) {
    const block = BABYLON.MeshBuilder.CreateBox("block", { size: 0.8 }, scene);
    const mat = new BABYLON.StandardMaterial("blockMat", scene);
    mat.diffuseColor = new BABYLON.Color3(0.6, 0.3, 0.9);
    block.material = mat;
    block.position = new BABYLON.Vector3(x, 0.4, z);
    rec.mesh = block;
    return;
  }
  rec.mesh.position.set(x, 0.4, z);
}

function placeBlockAt(lat, lon) {
  const key = blockKey(lat, lon);
  let rec = state.blocks.get(key);
  if (!rec) {
    rec = { lat, lon, mesh: null };
    state.blocks.set(key, rec);
  }
  // Keep latest coordinates for when the reference frame becomes available.
  rec.lat = lat;
  rec.lon = lon;
  realizeBlock(rec);
}

function ensureOther(id, color) {
  let rec = state.others.get(id);
  if (!rec) {
    const mesh = BABYLON.MeshBuilder.CreateSphere(`p_${id}`, { diameter: 1.6 }, scene);
    const mat = new BABYLON.StandardMaterial(`p_${id}_mat`, scene);
    mesh.material = mat;
    rec = { mesh, color: null, lat: null, lon: null };
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
  me.material.diffuseColor = BABYLON.Color3.FromHexString(hex);
}

function positionOther(rec) {
  if (!rec || rec.lat == null || rec.lon == null || state.refLat == null) return;
  const { x, z } = latLonToLocal(rec.lat, rec.lon, state.refLat, state.refLon);
  rec.mesh.position.set(x, 0.8, z);
}

function realizePendingEntities() {
  state.blocks.forEach(rec => realizeBlock(rec));
  state.others.forEach(rec => positionOther(rec));
}

// --- Permissions for iOS gyro ---
canvas.addEventListener("click", async () => { await requestDevicePermissions(); }, { once: true });

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

    // Move camera in local frame
    const { x, z } = latLonToLocal(lat, lon, state.refLat, state.refLon);
    camera.position.x = x; camera.position.z = z; camera.position.y = 2;

    // Emit only on change
    if (lat !== state.myLat || lon !== state.myLon) {
      state.myLat = lat; state.myLon = lon;
      socket.emit("gpsUpdate", { lat, lon });
      updateHUD();
    }

    if (firstFix) {
      realizePendingEntities();
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
    if (c.lat != null && c.lon != null) {
      rec.lat = c.lat;
      rec.lon = c.lon;
      positionOther(rec);
    }
  });
  droppedBlocks.forEach(({ lat, lon }) => placeBlockAt(lat, lon));
  updateHUD(Object.keys(clients).length);
});

socket.on("clientListUpdate", (clients) => {
  const ids = new Set(Object.keys(clients));
  [...state.others.keys()].forEach(id => { if (!ids.has(id) || id === socket.id) removeOther(id); });
  Object.entries(clients).forEach(([id, c]) => {
    if (id === socket.id) return;
    const rec = ensureOther(id, c.color);
    if (c.lat != null && c.lon != null) {
      rec.lat = c.lat;
      rec.lon = c.lon;
      positionOther(rec);
    }
  });
  updateHUD(Object.keys(clients).length);
});

socket.on("updateClientPosition", ({ id, lat, lon }) => {
  if (id === socket.id) return;
  const rec = ensureOther(id);
  rec.lat = lat;
  rec.lon = lon;
  positionOther(rec);
});

socket.on("removeClient", id => removeOther(id));

socket.on("createBlock", ({ lat, lon }) => placeBlockAt(lat, lon));

socket.on("colorUpdate", ({ id, color }) => {
  if (id === socket.id) { setMyColor(color); return; }
  const rec = ensureOther(id, color);
});

// render loop
engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());
