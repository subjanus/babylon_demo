// public/main.js
// Babylon.js + Socket.IO GPS toy.
// - Each client shares GPS position + heading (yaw).
// - Players are shown as rotating pyramids.
// - You can drop cubes at your location.
// - You can delete a cube if you're close enough (both client + server check).
// - In-canvas drawer UI (Babylon GUI) replaces the old HTML HUD.

import { initScene } from "./initScene.js";
import { initCamera } from "./initCamera.js";
import { requestDevicePermissions } from "./requestPermissions.js";
import { initBox, initPyramid } from "./initBox.js";
import { isNumber, approxDistMeters } from "./geo.js";

// --- DOM ---
const canvas = document.getElementById("renderCanvas");
const statusEl = document.getElementById("status");
const hudButtons = document.getElementById("buttons");

// --- Babylon ---
const { engine, scene } = initScene(canvas);
const camera = initCamera(scene, canvas);

// World root: all game objects are parented here.
// When "Lock North" is enabled we rotate this node to stabilize yaw.
const worldRoot = new BABYLON.TransformNode("worldRoot", scene);

// --- Socket ---
const socket = io({
  path: "/socket.io",
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 800
});

// --- Constants ---
const DROPPED_CUBE_Y = -1;                // ground-ish plane
const PLAYER_POINTER_Y_OFFSET = 1.6;      // pointer sits higher than dropped cubes
const GPS_ALPHA = 0.12;                   // smoothing (0..1)
const DEAD_BAND_M = 1.8;                  // ignore small movements
const SEND_MIN_MS = 350;                  // throttle outgoing gps updates
const SELECT_DELETE_RANGE_M = 8;          // must be within this to delete a cube (client-side)
const YAW_ALPHA = 0.08;                   // lock-north smoothing
const YAW_SEND_MIN_MS = 120;
const YAW_SEND_MIN_DELTA = 0.03;          // radians (~1.7 degrees)

// --- UI state ---
let followMe = true;
let lockNorth = false;

// Fallback HTML buttons (hidden by default in index.html, but kept for compatibility)
const btnPerm = ensureButton("btnPerm", "Permissions");
const btnNorth = ensureButton("btnNorth", "Lock North: Off");
const btnColor = ensureButton("btnColor", "Color");
const btnDrop = ensureButton("btnDrop", "Drop");

// Selection UI fallback (also mirrored into drawer UI)
let selectionEl = document.getElementById("selection") || null;
let btnDelete = document.getElementById("btnDelete") || null;

// --- Drawer UI (Babylon GUI) ---
let ui = null;
let uiStatusText = null;
let uiCountsText = null;
let uiSelectedText = null;
let uiDeleteBtn = null;

function createDrawerUI() {
  if (!BABYLON.GUI) return null;

  const adt = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("drawerUI", true, scene);

  const toggle = BABYLON.GUI.Button.CreateSimpleButton("btnDrawerToggle", "☰");
  toggle.width = "44px";
  toggle.height = "44px";
  toggle.color = "#e6edf3";
  toggle.background = "#111827";
  toggle.thickness = 1;
  toggle.cornerRadius = 12;
  toggle.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  toggle.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
  toggle.left = "10px";
  toggle.top = "10px";
  toggle.isPointerBlocker = true;
  adt.addControl(toggle);

  const drawer = new BABYLON.GUI.Rectangle("drawerPane");
  drawer.width = "340px";
  drawer.height = "460px";
  drawer.cornerRadius = 16;
  drawer.thickness = 1;
  drawer.color = "#374151";
  drawer.background = "#0d1117";
  drawer.alpha = 0.94;
  drawer.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
  drawer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
  drawer.top = "10px";
  drawer.left = "-10px";
  drawer.isVisible = false;
  drawer.isPointerBlocker = true;
  adt.addControl(drawer);

  const root = new BABYLON.GUI.StackPanel("drawerStack");
  root.paddingTop = "10px";
  root.paddingLeft = "12px";
  root.paddingRight = "12px";
  root.paddingBottom = "10px";
  root.isPointerBlocker = true;
  drawer.addControl(root);

  const headerRow = new BABYLON.GUI.StackPanel("hdrRow");
  headerRow.isVertical = false;
  headerRow.height = "34px";
  headerRow.isPointerBlocker = true;
  root.addControl(headerRow);

  const title = new BABYLON.GUI.TextBlock("drawerTitle", "Field Kit");
  title.color = "#e6edf3";
  title.fontSize = 18;
  title.height = "34px";
  title.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  title.resizeToFit = true;
  headerRow.addControl(title);

  const close = BABYLON.GUI.Button.CreateSimpleButton("btnDrawerClose", "×");
  close.width = "34px";
  close.height = "34px";
  close.color = "#e6edf3";
  close.background = "#111827";
  close.thickness = 1;
  close.cornerRadius = 10;
  close.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
  close.isPointerBlocker = true;
  headerRow.addControl(close);

  uiStatusText = new BABYLON.GUI.TextBlock("uiStatus", "Connecting…");
  uiStatusText.color = "#e6edf3";
  uiStatusText.fontSize = 12;
  uiStatusText.height = "34px";
  uiStatusText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  uiStatusText.textWrapping = true;
  root.addControl(uiStatusText);

  uiCountsText = new BABYLON.GUI.TextBlock("uiCounts", "Users: 0 | Cubes: 0 | Deleted: 0");
  uiCountsText.color = "#cbd5e1";
  uiCountsText.fontSize = 12;
  uiCountsText.height = "28px";
  uiCountsText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  root.addControl(uiCountsText);

  uiSelectedText = new BABYLON.GUI.TextBlock("uiSelected", "Selected: none");
  uiSelectedText.color = "#cbd5e1";
  uiSelectedText.fontSize = 12;
  uiSelectedText.height = "40px";
  uiSelectedText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  uiSelectedText.textWrapping = true;
  root.addControl(uiSelectedText);

  const sep = new BABYLON.GUI.Rectangle("sep");
  sep.height = "1px";
  sep.thickness = 0;
  sep.background = "#1f2937";
  root.addControl(sep);

  // Buttons
  const btnRow1 = new BABYLON.GUI.StackPanel("row1");
  btnRow1.isVertical = false;
  btnRow1.height = "44px";
  btnRow1.spacing = 8;
  btnRow1.isPointerBlocker = true;
  root.addControl(btnRow1);

  const uiPerm = mkUIButton("uiPerm", "Permissions");
  const uiNorth = mkUIButton("uiNorth", "Lock North: Off");
  btnRow1.addControl(uiPerm);
  btnRow1.addControl(uiNorth);

  const btnRow2 = new BABYLON.GUI.StackPanel("row2");
  btnRow2.isVertical = false;
  btnRow2.height = "44px";
  btnRow2.spacing = 8;
  btnRow2.isPointerBlocker = true;
  root.addControl(btnRow2);

  const uiFollow = mkUIButton("uiFollow", "Follow: On");
  const uiColor = mkUIButton("uiColor", "Color");
  btnRow2.addControl(uiFollow);
  btnRow2.addControl(uiColor);

  const btnRow3 = new BABYLON.GUI.StackPanel("row3");
  btnRow3.isVertical = false;
  btnRow3.height = "44px";
  btnRow3.spacing = 8;
  btnRow3.isPointerBlocker = true;
  root.addControl(btnRow3);

  const uiDrop = mkUIButton("uiDrop", "Drop");
  uiDeleteBtn = mkUIButton("uiDelete", "Delete");
  uiDeleteBtn.isEnabled = false;
  uiDeleteBtn.alpha = 0.5;
  btnRow3.addControl(uiDrop);
  btnRow3.addControl(uiDeleteBtn);

  // Wire events
  toggle.onPointerUpObservable.add(() => { drawer.isVisible = !drawer.isVisible; });
  close.onPointerUpObservable.add(() => { drawer.isVisible = false; });

  uiPerm.onPointerUpObservable.add(async () => {
    const res = await requestDevicePermissions();
    emitTelemetry("ui", { action: "permissions", res });
    setUIStatus(`Permissions: motion=${res.motion ?? "n/a"} orientation=${res.orientation ?? "n/a"}`);
  });

  uiNorth.onPointerUpObservable.add(() => {
    toggleLockNorth();
    uiNorth.textBlock.text = lockNorth ? "Lock North: On" : "Lock North: Off";
  });

  uiFollow.onPointerUpObservable.add(() => {
    followMe = !followMe;
    uiFollow.textBlock.text = followMe ? "Follow: On" : "Follow: Off";
    emitTelemetry("ui", { action: "followMe", followMe });
    if (!followMe) {
      worldRoot.position.x = 0;
      worldRoot.position.z = 0;
    }
  });

  uiColor.onPointerUpObservable.add(() => {
    socket.emit("toggleColor");
    emitTelemetry("ui", { action: "toggleColor" });
  });

  uiDrop.onPointerUpObservable.add(() => dropCubeNow());

  uiDeleteBtn.onPointerUpObservable.add(() => attemptDeleteSelected());

  return { adt, drawer };
}

function mkUIButton(name, label) {
  const b = BABYLON.GUI.Button.CreateSimpleButton(name, label);
  b.width = "100%";
  b.height = "44px";
  b.thickness = 1;
  b.cornerRadius = 12;
  b.color = "#e6edf3";
  b.background = "#111827";
  b.isPointerBlocker = true;
  b.paddingLeft = "0px";
  b.paddingRight = "0px";
  return b;
}

function isPointerOverDrawerUI(evt) {
  // If Babylon GUI is being interacted with, it will stop propagation to canvas; but mobile browsers vary.
  // A simple heuristic: ignore if target is not the canvas.
  return evt && evt.target && evt.target !== canvas;
}

ui = createDrawerUI();

// --- World projection ---
let worldOrigin = null; // {lat, lon}
let metersPerDegLon = null;

function setupProjection(origin) {
  worldOrigin = origin;
  metersPerDegLon = 111320 * Math.cos(origin.lat * Math.PI / 180);
}

function latLonToXZ(lat, lon) {
  if (!worldOrigin || !metersPerDegLon) return { x: 0, z: 0 };
  const x = (lon - worldOrigin.lon) * metersPerDegLon;
  const z = (lat - worldOrigin.lat) * 111320;
  return { x, z };
}

function distMeters(lat1, lon1, lat2, lon2) {
  const lat0 = (worldOrigin?.lat ?? lat1);
  return approxDistMeters(lat1, lon1, lat2, lon2, lat0);
}

// --- Entities ---
const playerPointers = {}; // socketId -> mesh
const droppedCubes = {};   // blockId -> mesh

function ensurePlayerPointer(id, color) {
  if (playerPointers[id] && !playerPointers[id].isDisposed()) return playerPointers[id];

  const ptr = initPyramid(scene, { name: "ptr_" + id, height: 2.2, base: 1.2, color: color || "#ffffff" });
  ptr.parent = worldRoot;
  ptr.isPickable = true;
  ptr.metadata = { kind: "playerPointer", socketId: id };

  playerPointers[id] = ptr;
  return ptr;
}

function ensureDroppedCube(blockId, color) {
  const key = String(blockId);
  if (droppedCubes[key] && !droppedCubes[key].isDisposed()) return droppedCubes[key];

  const cube = initBox(scene, { name: "cube_" + key, size: 1.4, color: color || "#ffffff", y: DROPPED_CUBE_Y });
  cube.parent = worldRoot;
  cube.isPickable = true;
  cube.metadata = { kind: "droppedCube", blockId: blockId };

  droppedCubes[key] = cube;
  return cube;
}

// --- Selection / highlight ---
let selectedMesh = null;
let selectedLabel = "none";
let selectedLat = null;
let selectedLon = null;
let selectedKind = null;
let selectedId = null;

let highlight = null;
try { highlight = new BABYLON.HighlightLayer("hl", scene); } catch (_) { highlight = null; }

function setUIStatus(s) {
  if (statusEl) statusEl.textContent = s;
  if (uiStatusText) uiStatusText.text = s;
}

function setUICounts(users, cubes, deleted) {
  const s = `Users: ${users} | Cubes: ${cubes} | Deleted: ${deleted}`;
  if (uiCountsText) uiCountsText.text = s;
}

function setUISelected(s, canDelete) {
  if (selectionEl) selectionEl.textContent = s;
  if (uiSelectedText) uiSelectedText.text = s;

  const enabled = !!canDelete;
  if (btnDelete) btnDelete.disabled = !enabled;
  if (uiDeleteBtn) {
    uiDeleteBtn.isEnabled = enabled;
    uiDeleteBtn.alpha = enabled ? 1.0 : 0.5;
  }
}

function clearSelection() {
  if (highlight && selectedMesh) {
    try { highlight.removeMesh(selectedMesh); } catch (_) {}
  }
  selectedMesh = null;
  selectedLabel = "none";
  selectedLat = null;
  selectedLon = null;
  selectedKind = null;
  selectedId = null;
  setUISelected("Selected: none", false);
}

function setSelection(mesh) {
  if (!mesh) return clearSelection();

  const md = mesh.metadata || {};
  if (!md.kind) return clearSelection();

  if (highlight) {
    if (selectedMesh) { try { highlight.removeMesh(selectedMesh); } catch (_) {} }
    try { highlight.addMesh(mesh, BABYLON.Color3.FromHexString("#FFCC00")); } catch (_) {}
  }

  selectedMesh = mesh;
  selectedKind = md.kind;
  selectedId = md.blockId ?? md.socketId ?? null;

  selectedLat = (typeof md.lat === "number") ? md.lat : null;
  selectedLon = (typeof md.lon === "number") ? md.lon : null;

  if (selectedKind === "droppedCube") selectedLabel = `Cube #${selectedId}`;
  else if (selectedKind === "playerPointer") selectedLabel = `Player ${shortId(String(selectedId || ""))}`;
  else selectedLabel = String(md.kind);

  updateSelectionHUD();
}

function currentLatLon() {
  if (isNumber(filtLat) && isNumber(filtLon)) return { lat: filtLat, lon: filtLon };
  if (isNumber(rawLat) && isNumber(rawLon)) return { lat: rawLat, lon: rawLon };
  return null;
}

function updateSelectionHUD() {
  if (!selectedMesh) {
    setUISelected("Selected: none", false);
    return;
  }

  let distTxt = "distance: ?";
  let canDelete = false;

  const me = currentLatLon();
  if (me && isNumber(selectedLat) && isNumber(selectedLon) && worldOrigin) {
    const d = distMeters(me.lat, me.lon, selectedLat, selectedLon);
    distTxt = `distance: ${d.toFixed(1)}m`;
    if (selectedKind === "droppedCube" && d <= SELECT_DELETE_RANGE_M) canDelete = true;
  }

  setUISelected(`Selected: ${selectedLabel} | ${distTxt}`, canDelete);
}

function attemptDeleteSelected() {
  if (!selectedMesh) return;
  if (selectedKind !== "droppedCube" || selectedId == null) return;

  const me = currentLatLon();
  if (!me || !isNumber(selectedLat) || !isNumber(selectedLon) || !worldOrigin) return;

  const d = distMeters(me.lat, me.lon, selectedLat, selectedLon);
  if (d > SELECT_DELETE_RANGE_M) return;

  socket.emit("deleteCube", { blockId: selectedId });
  emitTelemetry("ui", { action: "deleteCube", blockId: selectedId, distM: d });

  clearSelection(); // optimistic
}

// Pointer selection (tap/click)
scene.onPointerObservable.add((pi) => {
  if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
  if (isPointerOverDrawerUI(pi.event)) return;

  const pick = scene.pick(scene.pointerX, scene.pointerY);
  if (pick && pick.hit && pick.pickedMesh) setSelection(pick.pickedMesh);
  else clearSelection();
});

// Keyboard delete
window.addEventListener("keydown", (e) => {
  if (e.key === "Delete" || e.key === "Backspace") attemptDeleteSelected();
});

// --- Heading / yaw ---
let yawZero = 0;
let yawSmoothed = 0;
let lastYawSent = null;
let lastYawSentAt = 0;

function getCameraYawRad() {
  // ArcRotateCamera: yaw is alpha + PI/2 so that 0 = +Z forward-ish.
  if (camera instanceof BABYLON.ArcRotateCamera) {
    return camera.alpha + Math.PI / 2;
  }
  // DeviceOrientationCamera / FreeCamera store yaw in rotation.y (approx).
  return camera.rotation?.y ?? 0;
}

function toggleLockNorth() {
  lockNorth = !lockNorth;
  yawSmoothed = getCameraYawRad();
  yawZero = yawSmoothed;
  if (btnNorth) btnNorth.textContent = lockNorth ? "Lock North: On" : "Lock North: Off";
  emitTelemetry("ui", { action: "lockNorth", lockNorth });
}

function applyHeadingStabilization() {
  if (!lockNorth) {
    worldRoot.rotation.y = 0;
    return;
  }
  const yaw = getCameraYawRad();
  yawSmoothed = yawSmoothed + (yaw - yawSmoothed) * YAW_ALPHA;
  const delta = yawSmoothed - yawZero;
  worldRoot.rotation.y = -delta;
}

function maybeSendOrientationUpdate() {
  const now = Date.now();
  if (now - lastYawSentAt < YAW_SEND_MIN_MS) return;

  const yaw = getCameraYawRad();
  if (lastYawSent != null && Math.abs(yaw - lastYawSent) < YAW_SEND_MIN_DELTA) return;

  lastYawSent = yaw;
  lastYawSentAt = now;

  socket.emit("orientationUpdate", { yaw });
}

// --- GPS ---
let rawLat = null, rawLon = null;
let filtLat = null, filtLon = null;
let lastSentLat = null, lastSentLon = null;
let lastSentAt = 0;

function onGeo(lat, lon, coords) {
  rawLat = lat;
  rawLon = lon;

  if (filtLat === null || filtLon === null) {
    filtLat = lat;
    filtLon = lon;
  } else {
    filtLat = filtLat + (lat - filtLat) * GPS_ALPHA;
    filtLon = filtLon + (lon - filtLon) * GPS_ALPHA;
  }

  emitTelemetry("gps", coords ? {
    accuracy: coords.accuracy,
    altitude: coords.altitude,
    altitudeAccuracy: coords.altitudeAccuracy,
    heading: coords.heading,
    speed: coords.speed
  } : undefined);

  const now = Date.now();
  if (lastSentLat === null || lastSentLon === null) {
    lastSentLat = filtLat;
    lastSentLon = filtLon;
    lastSentAt = now;
    socket.emit("gpsUpdate", { lat: filtLat, lon: filtLon });
    return;
  }

  if (now - lastSentAt < SEND_MIN_MS) return;

  const moved = distMeters(lastSentLat, lastSentLon, filtLat, filtLon);
  if (moved < DEAD_BAND_M) return;

  lastSentLat = filtLat;
  lastSentLon = filtLon;
  lastSentAt = now;
  socket.emit("gpsUpdate", { lat: filtLat, lon: filtLon });
}

if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      if (isNumber(lat) && isNumber(lon)) onGeo(lat, lon, pos.coords);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
  );
}

// --- Drop / buttons ---
async function doPermissions() {
  const res = await requestDevicePermissions();
  emitTelemetry("ui", { action: "permissions", res });
  setUIStatus(`Permissions: motion=${res.motion ?? "n/a"} orientation=${res.orientation ?? "n/a"}`);
}

function dropCubeNow() {
  const lat = isNumber(filtLat) ? filtLat : rawLat;
  const lon = isNumber(filtLon) ? filtLon : rawLon;
  if (!isNumber(lat) || !isNumber(lon)) return;

  socket.emit("dropCube", { lat, lon });
  emitTelemetry("drop", { lat, lon });
}

if (btnPerm) btnPerm.addEventListener("click", doPermissions);
if (btnNorth) btnNorth.addEventListener("click", toggleLockNorth);
if (btnColor) btnColor.addEventListener("click", () => { socket.emit("toggleColor"); emitTelemetry("ui", { action: "toggleColor" }); });
if (btnDrop) btnDrop.addEventListener("click", dropCubeNow);

function ensureButton(id, label) {
  if (!hudButtons) return null;
  let b = document.getElementById(id);
  if (!b) {
    b = document.createElement("button");
    b.id = id;
    b.textContent = label;
    hudButtons.appendChild(b);
  }
  return b;
}

// --- Telemetry ---
function emitTelemetry(kind, payload) {
  // best-effort; server will also record authoritative actions
  try {
    socket.emit("telemetry", { kind, payload });
  } catch (_) {}
}

function shortId(id) {
  return (id || "").slice(0, 6);
}

// --- World reconciliation ---
let lastWorldState = null;
let myDeletedCount = 0;

function reconcileWorld(state) {
  lastWorldState = state;

  if (state.worldOrigin && (!worldOrigin || state.worldOrigin.lat !== worldOrigin.lat || state.worldOrigin.lon !== worldOrigin.lon)) {
    setupProjection(state.worldOrigin);
  }

  const clientIds = Object.keys(state.clients || {});
  const blockCount = (state.droppedBlocks || []).length;

  setUIStatus(`Connected (${shortId(socket.id)})`);
  setUICounts(clientIds.length, blockCount, myDeletedCount);

  // Players
  for (const [id, c] of Object.entries(state.clients || {})) {
    const ptr = ensurePlayerPointer(id, c.color);

    if (isNumber(c.lat) && isNumber(c.lon)) {
      const { x, z } = latLonToXZ(c.lat, c.lon);
      ptr.position.set(x, DROPPED_CUBE_Y + PLAYER_POINTER_Y_OFFSET, z);
      ptr.metadata = { ...(ptr.metadata || {}), lat: c.lat, lon: c.lon, kind: "playerPointer", socketId: id };
    }

    // Rotate to match player's heading in world coordinates.
    // ptr is parented to worldRoot, so convert world yaw -> local yaw by subtracting worldRoot rotation.
    if (isNumber(c.yaw)) {
      ptr.rotation.y = c.yaw - worldRoot.rotation.y;
    }
  }

  // Remove disconnected
  for (const id of Object.keys(playerPointers)) {
    if (!state.clients || !state.clients[id]) {
      playerPointers[id].dispose();
      delete playerPointers[id];
    }
  }

  // Follow mode (keep local player centered)
  if (followMe && socket.id && playerPointers[socket.id]) {
    const me = playerPointers[socket.id];
    worldRoot.position.x = -me.position.x;
    worldRoot.position.z = -me.position.z;
  }

  // Dropped cubes
  const present = new Set();
  for (const b of (state.droppedBlocks || [])) {
    if (!isNumber(b.id) || !isNumber(b.lat) || !isNumber(b.lon)) continue;
    present.add(String(b.id));

    const cube = ensureDroppedCube(b.id, b.color);
    const { x, z } = latLonToXZ(b.lat, b.lon);
    cube.position.set(x, DROPPED_CUBE_Y, z);
    cube.metadata = { ...(cube.metadata || {}), lat: b.lat, lon: b.lon, kind: "droppedCube", blockId: b.id };
  }

  // Remove deleted cubes
  for (const id of Object.keys(droppedCubes)) {
    if (!present.has(String(id))) {
      if (selectedKind === "droppedCube" && String(selectedId) === String(id)) clearSelection();
      droppedCubes[id].dispose();
      delete droppedCubes[id];
    }
  }

  if (selectedMesh && selectedMesh.isDisposed && selectedMesh.isDisposed()) clearSelection();
  updateSelectionHUD();
}

// --- Socket events ---
socket.on("connect", () => {
  setUIStatus("Connected");
  emitTelemetry("connect", { id: socket.id });
});

socket.on("worldState", (state) => {
  reconcileWorld(state);
  emitTelemetry("state", {
    users: Object.keys(state.clients || {}).length,
    cubes: (state.droppedBlocks || []).length
  });
});

socket.on("myCounters", (c) => {
  if (!c || typeof c !== "object") return;
  if (typeof c.deletedCubes === "number" && Number.isFinite(c.deletedCubes)) {
    myDeletedCount = c.deletedCubes;
    const users = Object.keys(lastWorldState?.clients || {}).length;
    const cubes = (lastWorldState?.droppedBlocks || []).length;
    setUICounts(users, cubes, myDeletedCount);
  }
});

socket.on("deleteResult", (r) => {
  if (!r || typeof r !== "object") return;
  if (r.ok) setUIStatus(`Connected (${shortId(socket.id)}) | Deleted cube #${r.blockId}`);
  else setUIStatus(`Connected (${shortId(socket.id)}) | Delete failed: ${r.reason || "rejected"}`);
});

// --- Render loop ---
engine.runRenderLoop(() => {
  applyHeadingStabilization();
  maybeSendOrientationUpdate();
  updateSelectionHUD();
  scene.render();
});

window.addEventListener("resize", () => engine.resize());

// Debug handles
window.__scene = scene;
window.__camera = camera;
