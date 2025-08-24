import { initScene } from "./initScene.js";
import { initCamera } from "./initCamera.js";
import { requestDevicePermissions } from "./requestPermissions.js";
import { initBox } from "./initBox.js";
import { latLonToLocal, toFix5 } from "./geo.js";

const state = {
  refLat: null, refLon: null,
  myLat: null,  myLon: null,
  others: new Map(),  // id -> { mesh, color }
  blocks: [],
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

function placeBlockAt(lat, lon) {
  if (state.refLat == null) return; // wait for frame
  const { x, z } = latLonToLocal(lat, lon, state.refLat, state.refLon);
  const block = BABYLON.MeshBuilder.CreateBox("block", { size: 0.8 }, scene);
  const mat = new BABYLON.StandardMaterial("blockMat", scene);
  mat.diffuseColor = new BABYLON.Color3(0.6, 0.3, 0.9);
  block.material = mat;
  block.position = new BABYLON.Vector3(x, 0.4, z);
  state.blocks.push(block);
}

function ensureOther(id, color = "#FFCC00") {
  if (state.others.has(id)) return state.others.get(id);
  const mesh = BABYLON.MeshBuilder.CreateSphere(`p_${id}`, { diameter: 1.6 }, scene);
  const mat = new BABYLON.StandardMaterial(`p_${id}_mat`, scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(color);
  mesh.material = mat;
  const rec = { mesh, color };
  state.others.set(id, rec);
  return rec;
}

function removeOther(id) {
  const rec = state.others.get(id);
  if (rec) { rec.mesh.dispose(); state.others.delete(id); }
}

function setMyColor(hex) {
  state.myColor = hex;
  me.material.diffuseColor = BABYLON.Color3.FromHexString(hex);
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

    if (state.refLat == null) { state.refLat = lat; state.refLon = lon; }

    // Move camera in local frame
    const { x, z } = latLonToLocal(lat, lon, state.refLat, state.refLon);
    camera.position.x = x; camera.position.z = z; camera.position.y = 2;

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
    const rec = ensureOther(id, c.color || "#FFCC00");
    if (c.lat != null && c.lon != null && state.refLat != null) {
      const { x, z } = latLonToLocal(c.lat, c.lon, state.refLat, state.refLon);
      rec.mesh.position.set(x, 0.8, z);
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
    const rec = ensureOther(id, c.color || "#FFCC00");
    if (c.lat != null && c.lon != null && state.refLat != null) {
      const { x, z } = latLonToLocal(c.lat, c.lon, state.refLat, state.refLon);
      rec.mesh.position.set(x, 0.8, z);
    }
  });
  updateHUD(Object.keys(clients).length);
});

socket.on("updateClientPosition", ({ id, lat, lon }) => {
  if (id === socket.id) return;
  const rec = ensureOther(id);
  if (state.refLat == null) return;
  const { x, z } = latLonToLocal(lat, lon, state.refLat, state.refLon);
  rec.mesh.position.set(x, 0.8, z);
});

socket.on("removeClient", id => removeOther(id));

socket.on("createBlock", ({ lat, lon }) => placeBlockAt(lat, lon));

socket.on("colorUpdate", ({ id, color }) => {
  if (id === socket.id) { setMyColor(color); return; }
  const rec = ensureOther(id, color);
  rec.color = color;
  rec.mesh.material.diffuseColor = BABYLON.Color3.FromHexString(color);
});

// render loop
engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());
