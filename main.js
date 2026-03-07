import { initScene } from "./initScene.js";
import { initCamera } from "./initCamera.js";
import { requestDevicePermissions } from "./requestPermissions.js";
import { initBox } from "./initBox.js";
import { latLonToLocal, distanceXZ, parseAnchorInput, sanitizeAnchorId, rebaseLocalPoint } from "./geo.js";

const canvas = document.getElementById("renderCanvas");
const statusEl = document.getElementById("status");

const { engine, scene } = initScene(canvas);
const camera = initCamera(scene, canvas);
camera.position.y = 2.4;

const worldRoot = new BABYLON.TransformNode("worldRoot", scene);
const socket = io({ path: "/socket.io", transports: ["websocket", "polling"] });

const PLAYER_Y = -5;
const OBJECT_Y = -1;
const PLAYER_POINTER_Y_OFFSET = 1.6;
const FOLLOW_DEFAULT = true;
const GPS_ALPHA = 0.12;
const DEAD_BAND_M = 1.8;
const SEND_MIN_MS = 350;
const YAW_ALPHA = 0.08;
const YAW_SEND_MIN_MS = 120;
const YAW_SEND_MIN_DELTA = 0.03;
const SELECT_DELETE_RANGE_M = 8;
const TELEMETRY_MIN_MS = 500;

let followMe = FOLLOW_DEFAULT;
let lockNorth = false;
let yawZero = 0;
let yawSmoothed = 0;
let lastYawSent = null;
let lastYawSentAt = 0;
let lastTelemAt = 0;
let lastWorldState = null;
let myDeletedCount = 0;

let rawLat = null;
let rawLon = null;
let filtLat = null;
let filtLon = null;
let lastSentPose = null;
let lastSentAt = 0;

let anchor = loadAnchor();

const playerPointers = {};
const worldObjects = {};

let selectedMesh = null;
let selectedObjectId = null;
let selectedKind = null;
let selectedPoint = null;
let ui = null;
let uiStatusText = null;
let uiCountsText = null;
let uiSelectedText = null;
let uiDeleteBtn = null;
let uiAnchorText = null;
let uiAnchorLatInput = null;
let uiAnchorLonInput = null;
let uiAnchorIdInput = null;

let highlight = null;
try {
  highlight = new BABYLON.HighlightLayer("hl", scene);
} catch (_) {}

function isNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
  if (uiStatusText) uiStatusText.text = text;
}

function setCounts(users, objects, deleted) {
  if (uiCountsText) uiCountsText.text = `Users: ${users} | Objects: ${objects} | Deleted: ${deleted}`;
}

function setSelectionText(text, canDelete) {
  if (uiSelectedText) uiSelectedText.text = text;
  if (uiDeleteBtn) {
    uiDeleteBtn.isEnabled = !!canDelete;
    uiDeleteBtn.alpha = canDelete ? 1 : 0.45;
  }
}

function setAnchorText() {
  if (!uiAnchorText) return;
  uiAnchorText.text = `Reference: ${anchor.anchorId} (${anchor.lat.toFixed(5)}, ${anchor.lon.toFixed(5)})`;
}

function loadAnchor() {
  try {
    const raw = localStorage.getItem("privateWorldAnchor");
    if (!raw) return { lat: 0, lon: 0, anchorId: "private-anchor" };
    const parsed = JSON.parse(raw);
    if (!isNumber(parsed.lat) || !isNumber(parsed.lon)) return { lat: 0, lon: 0, anchorId: "private-anchor" };
    return { lat: parsed.lat, lon: parsed.lon, anchorId: sanitizeAnchorId(parsed.anchorId || "private-anchor") };
  } catch (_) {
    return { lat: 0, lon: 0, anchorId: "private-anchor" };
  }
}

function saveAnchor(next) {
  anchor = next;
  try {
    localStorage.setItem("privateWorldAnchor", JSON.stringify(anchor));
  } catch (_) {}
  setAnchorText();
}

function promptForAnchor(prefill) {
  const starter = prefill || `${anchor.lat}, ${anchor.lon}, ${anchor.anchorId}`;
  const answer = window.prompt("Enter reference point as: latitude, longitude, anchorId", starter);
  const parsed = parseAnchorInput(answer);
  if (!parsed) return false;
  saveAnchor(parsed);
  syncAnchorInputs();
  emitTelemetry("anchor", { anchorId: parsed.anchorId, refLat: parsed.lat, refLon: parsed.lon });
  maybeSendPose(true);
  return true;
}

function getAnchorPayload() {
  return {
    anchorId: anchor.anchorId,
    refLat: anchor.lat,
    refLon: anchor.lon
  };
}

function syncAnchorInputs() {
  if (uiAnchorLatInput) uiAnchorLatInput.text = String(anchor.lat);
  if (uiAnchorLonInput) uiAnchorLonInput.text = String(anchor.lon);
  if (uiAnchorIdInput) uiAnchorIdInput.text = anchor.anchorId;
}

function saveAnchorFromInputs() {
  const parsed = parseAnchorInput(`${uiAnchorLatInput?.text || "0"}, ${uiAnchorLonInput?.text || "0"}, ${uiAnchorIdInput?.text || "private-anchor"}`);
  if (!parsed) {
    setStatus("Reference point is invalid");
    return false;
  }
  saveAnchor(parsed);
  syncAnchorInputs();
  setStatus(`Reference saved: ${parsed.anchorId}`);
  emitTelemetry("anchor", { anchorId: parsed.anchorId, refLat: parsed.lat, refLon: parsed.lon });
  maybeSendPose(true);
  return true;
}


function currentPose() {
  if (!anchor) return null;
  const lat = isNumber(filtLat) ? filtLat : rawLat;
  const lon = isNumber(filtLon) ? filtLon : rawLon;
  if (!isNumber(lat) || !isNumber(lon)) return null;
  const local = latLonToLocal(lat, lon, anchor.lat, anchor.lon);
  return {
    x: local.x,
    z: local.z,
    yaw: getCameraYawRad(),
    accuracyM: null,
    ...getAnchorPayload()
  };
}

function distCurrentTo(point) {
  const me = currentPose();
  if (!me || !point) return Infinity;
  return distanceXZ(me, point);
}

function ensurePlayerPointer(id, color) {
  if (playerPointers[id]) return playerPointers[id];
  const p = BABYLON.MeshBuilder.CreateCylinder(`playerPointer_${id}`, {
    diameterTop: 0,
    diameterBottom: 0.9,
    height: 1.6,
    tessellation: 4
  }, scene);
  const mat = new BABYLON.StandardMaterial(`playerPointerMat_${id}`, scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(color || "#FFCC00");
  mat.emissiveColor = BABYLON.Color3.FromHexString("#1f2937");
  mat.specularColor = BABYLON.Color3.Black();
  p.material = mat;
  p.rotation.x = Math.PI / 2;
  p.parent = worldRoot;
  p.isPickable = true;
  playerPointers[id] = p;
  return p;
}

function buildDisc(object) {
  const mesh = BABYLON.MeshBuilder.CreateCylinder(`object_${object.id}`, {
    diameter: 3,
    height: 0.35,
    tessellation: 32
  }, scene);
  return mesh;
}

function buildObjectMesh(object) {
  if (object.type === "disc") return buildDisc(object);
  return initBox(scene, object.style?.color || "#34D399");
}

function ensureObjectMesh(object) {
  if (worldObjects[object.id]) return worldObjects[object.id];
  const mesh = buildObjectMesh(object);
  mesh.name = `object_${object.id}`;
  mesh.parent = worldRoot;
  mesh.isPickable = true;
  worldObjects[object.id] = mesh;
  return mesh;
}

function applyObjectVisuals(mesh, object) {
  mesh.position.set(object.x || 0, isNumber(object.y) ? object.y : OBJECT_Y, object.z || 0);
  mesh.rotation.y = object.rotY || 0;
  mesh.scaling.set(object.scale?.x || 1, object.scale?.y || 1, object.scale?.z || 1);
  if (mesh.material) {
    if (object.style?.color && BABYLON.Color3.FromHexString) {
      try {
        mesh.material.diffuseColor = BABYLON.Color3.FromHexString(object.style.color);
      } catch (_) {}
    }
    if (isNumber(object.style?.alpha)) mesh.material.alpha = object.style.alpha;
  }
  mesh.metadata = {
    kind: "worldObject",
    objectId: object.id,
    x: object.x,
    z: object.z,
    type: object.type,
    owner: object.owner,
    trigger: object.trigger || null
  };
}

function getCameraYawRad() {
  const q = camera.rotationQuaternion;
  if (!q) return camera.rotation?.y || 0;
  const ysqr = q.y * q.y;
  const t3 = 2.0 * (q.w * q.y + q.x * q.z);
  const t4 = 1.0 - 2.0 * (ysqr + q.z * q.z);
  return Math.atan2(t3, t4);
}

function normalizeAngleRad(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function maybeSendOrientationUpdate() {
  if (!socket.connected) return;
  const now = Date.now();
  if (now - lastYawSentAt < YAW_SEND_MIN_MS) return;
  const yaw = getCameraYawRad();
  if (lastYawSent !== null && Math.abs(normalizeAngleRad(yaw - lastYawSent)) < YAW_SEND_MIN_DELTA) return;
  lastYawSent = yaw;
  lastYawSentAt = now;
  socket.emit("orientationUpdate", { yaw });
}

function applyHeadingStabilization() {
  if (!lockNorth) {
    worldRoot.rotation.y = 0;
    return;
  }
  const yaw = getCameraYawRad();
  const delta = normalizeAngleRad(yaw - yawSmoothed);
  yawSmoothed = normalizeAngleRad(yawSmoothed + delta * YAW_ALPHA);
  worldRoot.rotation.y = -(yawSmoothed - yawZero);
}

function emitTelemetry(kind, extra = {}) {
  const now = Date.now();
  if ((kind === "gps" || kind === "state") && now - lastTelemAt < TELEMETRY_MIN_MS) return;
  lastTelemAt = now;
  socket.emit("telemetry", {
    kind,
    anchorId: anchor?.anchorId || null,
    reference: anchor ? { anchorId: anchor.anchorId, refLat: anchor.lat, refLon: anchor.lon } : null,
    pose: currentPose(),
    yaw: getCameraYawRad(),
    extra
  });
}

function maybeSendPose(force = false, coords = null) {
  if (!socket.connected || !anchor) return;
  const pose = currentPose();
  if (!pose) return;
  if (coords && isNumber(coords.accuracy)) pose.accuracyM = coords.accuracy;

  const now = Date.now();
  if (!force) {
    if (lastSentPose && now - lastSentAt < SEND_MIN_MS) return;
    if (lastSentPose && distanceXZ(lastSentPose, pose) < DEAD_BAND_M) return;
  }

  lastSentPose = { ...pose };
  lastSentAt = now;
  socket.emit("poseUpdate", pose);
}

function clearSelection() {
  if (highlight && selectedMesh) {
    try { highlight.removeMesh(selectedMesh); } catch (_) {}
  }
  selectedMesh = null;
  selectedObjectId = null;
  selectedKind = null;
  selectedPoint = null;
  setSelectionText("Selected: none", false);
}

function setSelection(mesh) {
  if (!mesh || !mesh.metadata) return clearSelection();
  if (highlight && selectedMesh) {
    try { highlight.removeMesh(selectedMesh); } catch (_) {}
  }
  selectedMesh = mesh;
  selectedObjectId = mesh.metadata.objectId || null;
  selectedKind = mesh.metadata.kind || null;
  selectedPoint = { x: mesh.metadata.x, z: mesh.metadata.z };
  if (highlight) {
    try { highlight.addMesh(mesh, BABYLON.Color3.FromHexString("#FFCC00")); } catch (_) {}
  }
  updateSelectionHUD();
}

function updateSelectionHUD() {
  if (!selectedMesh || !selectedPoint) {
    setSelectionText("Selected: none", false);
    return;
  }
  const distM = distCurrentTo(selectedPoint);
  const canDelete = selectedKind === "worldObject" && isNumber(selectedObjectId) && distM <= SELECT_DELETE_RANGE_M;
  const label = selectedMesh.metadata.type || "object";
  setSelectionText(`Selected: ${label} #${selectedObjectId} | distance: ${isNumber(distM) ? distM.toFixed(1) : "?"}m`, canDelete);
}

function attemptDeleteSelected() {
  if (!isNumber(selectedObjectId)) return;
  const distM = distCurrentTo(selectedPoint);
  if (!isNumber(distM) || distM > SELECT_DELETE_RANGE_M) return;
  socket.emit("destroyObjectRequest", { objectId: selectedObjectId });
  emitTelemetry("ui", { action: "destroyObjectRequest", objectId: selectedObjectId, distM });
  clearSelection();
}

function addHorizonRing() {
  const ring = BABYLON.MeshBuilder.CreateTorus("horizonRing", { diameter: 10, thickness: 0.03, tessellation: 64 }, scene);
  const mat = new BABYLON.StandardMaterial("horizonMat", scene);
  mat.emissiveColor = new BABYLON.Color3(0.4, 0.65, 0.95);
  mat.alpha = 0.75;
  ring.material = mat;
  ring.parent = camera;
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, -1.2, 0);
}

function createDrawerUI() {
  if (!BABYLON.GUI) return null;
  const adt = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("drawerUI", true, scene);
  const toggle = BABYLON.GUI.Button.CreateSimpleButton("btnDrawerToggle", "☰");
  toggle.width = "44px";
  toggle.height = "44px";
  toggle.color = "#e6edf3";
  toggle.background = "#111827";
  toggle.cornerRadius = 12;
  toggle.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  toggle.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
  toggle.left = "10px";
  toggle.top = "10px";
  toggle.isPointerBlocker = true;
  adt.addControl(toggle);

  const drawer = new BABYLON.GUI.Rectangle("drawerPane");
  drawer.width = "360px";
  drawer.height = "520px";
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

  const title = new BABYLON.GUI.TextBlock("drawerTitle", "Field Kit");
  title.color = "#e6edf3";
  title.fontSize = 18;
  title.height = "32px";
  title.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  root.addControl(title);

  uiStatusText = new BABYLON.GUI.TextBlock("uiStatus", "Connecting…");
  uiStatusText.color = "#e6edf3";
  uiStatusText.fontSize = 12;
  uiStatusText.height = "34px";
  uiStatusText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  uiStatusText.textWrapping = true;
  root.addControl(uiStatusText);

  uiCountsText = new BABYLON.GUI.TextBlock("uiCounts", "Users: 0 | Objects: 0 | Deleted: 0");
  uiCountsText.color = "#cbd5e1";
  uiCountsText.fontSize = 12;
  uiCountsText.height = "24px";
  uiCountsText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  root.addControl(uiCountsText);

  uiAnchorText = new BABYLON.GUI.TextBlock("uiAnchor", "Reference: private-anchor (0.00000, 0.00000)");
  uiAnchorText.color = "#cbd5e1";
  uiAnchorText.fontSize = 12;
  uiAnchorText.height = "54px";
  uiAnchorText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  uiAnchorText.textWrapping = true;
  root.addControl(uiAnchorText);

  uiSelectedText = new BABYLON.GUI.TextBlock("uiSelected", "Selected: none");
  uiSelectedText.color = "#cbd5e1";
  uiSelectedText.fontSize = 12;
  uiSelectedText.height = "36px";
  uiSelectedText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  uiSelectedText.textWrapping = true;
  root.addControl(uiSelectedText);

  function addButton(id, label, onClick) {
    const button = BABYLON.GUI.Button.CreateSimpleButton(id, label);
    button.width = "100%";
    button.height = "40px";
    button.color = "#e6edf3";
    button.background = "#111827";
    button.thickness = 1;
    button.cornerRadius = 12;
    button.paddingTop = "6px";
    button.isPointerBlocker = true;
    button.onPointerUpObservable.add(() => onClick(button));
    root.addControl(button);
    return button;
  }

  addButton("uiFollow", `Follow: ${followMe ? "On" : "Off"}`, (b) => {
    followMe = !followMe;
    b.textBlock.text = `Follow: ${followMe ? "On" : "Off"}`;
  });

  addButton("uiNorth", "Lock North: Off", (b) => {
    lockNorth = !lockNorth;
    yawSmoothed = getCameraYawRad();
    yawZero = yawSmoothed;
    b.textBlock.text = `Lock North: ${lockNorth ? "On" : "Off"}`;
  });

  addButton("uiPerm", "Enable Motion", async (b) => {
    const ok = await requestDevicePermissions();
    b.textBlock.text = ok ? "Motion Enabled" : "Motion Blocked";
  });

  const refLabel = new BABYLON.GUI.TextBlock("uiRefLabel", "Reference point (shared, raw GPS stays local)");
  refLabel.color = "#cbd5e1";
  refLabel.fontSize = 12;
  refLabel.height = "20px";
  refLabel.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  root.addControl(refLabel);


  function addInput(name, placeholder, value) {
    const input = new BABYLON.GUI.InputText(name);
    input.width = "100%";
    input.maxWidth = 0.95;
    input.height = "36px";
    input.color = "#e6edf3";
    input.background = "#111827";
    input.focusedBackground = "#0f172a";
    input.thickness = 1;
    input.cornerRadius = 10;
    input.placeholderText = placeholder;
    input.text = value;
    input.paddingTop = "4px";
    input.paddingBottom = "2px";
    root.addControl(input);
    return input;
  }

  uiAnchorLatInput = addInput("uiAnchorLat", "Reference latitude", String(anchor.lat));
  uiAnchorLonInput = addInput("uiAnchorLon", "Reference longitude", String(anchor.lon));
  uiAnchorIdInput = addInput("uiAnchorId", "Reference ID", anchor.anchorId);

  addButton("uiAnchorBtn", "Save Reference Point", () => {
    saveAnchorFromInputs();
  });

  addButton("uiAnchorPrompt", "Edit Reference in Prompt", () => {
    promptForAnchor();
  });

  addButton("uiColor", "Toggle Color", () => socket.emit("toggleColor"));

  addButton("uiDrop", "Drop Cube Object", () => {
    const pose = currentPose();
    if (!pose) return;
    socket.emit("createObjectRequest", {
      object: {
        type: "cube",
        x: pose.x,
        y: OBJECT_Y,
        z: pose.z,
        scale: { x: 1, y: 1, z: 1 },
        style: { color: "#34D399", alpha: 1 },
        ...getAnchorPayload()
      }
    });
  });

  uiDeleteBtn = addButton("uiDelete", "Delete Selected", () => attemptDeleteSelected());
  uiDeleteBtn.isEnabled = false;
  uiDeleteBtn.alpha = 0.45;

  toggle.onPointerUpObservable.add(() => {
    drawer.isVisible = !drawer.isVisible;
  });

  return { adt, drawer };
}

function isPointerOverDrawerUI(evt) {
  if (!evt || !ui?.drawer?.isVisible) return false;
  const x = evt.clientX;
  const y = evt.clientY;
  const w = engine.getRenderWidth(true);
  const drawerWidth = 360;
  const drawerHeight = 520;
  const margin = 10;
  const left = w - (drawerWidth + margin);
  return x >= left && x <= w - margin && y >= margin && y <= drawerHeight + margin;
}

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
  emitTelemetry("gps", { accuracy: coords?.accuracy || null });
  maybeSendPose(false, coords || null);
}

function reconcileWorld(state) {
  lastWorldState = state;
  const clients = state.clients || {};
  const objects = state.objects || [];
  setStatus(`Connected (${String(socket.id || "").slice(-4)})`);
  setCounts(Object.keys(clients).length, objects.length, myDeletedCount);

  for (const [id, c] of Object.entries(clients)) {
    const ptr = ensurePlayerPointer(id, c.color);
    const rebased = rebaseLocalPoint(
      { x: c.x || 0, z: c.z || 0 },
      c.refLat,
      c.refLon,
      anchor.lat,
      anchor.lon
    );
    ptr.position.set(rebased.x, PLAYER_Y + PLAYER_POINTER_Y_OFFSET, rebased.z);
    ptr.rotation.y = (c.yaw || 0) - worldRoot.rotation.y;
    ptr.metadata = { kind: "playerPointer", socketId: id, x: rebased.x, z: rebased.z };
  }

  for (const id of Object.keys(playerPointers)) {
    if (!clients[id]) {
      playerPointers[id].dispose();
      delete playerPointers[id];
    }
  }

  if (followMe && socket.id && playerPointers[socket.id]) {
    const me = playerPointers[socket.id];
    worldRoot.position.x = -me.position.x;
    worldRoot.position.z = -me.position.z;
  } else {
    worldRoot.position.x = 0;
    worldRoot.position.z = 0;
  }

  const seen = new Set();
  for (const object of objects) {
    seen.add(String(object.id));
    const mesh = ensureObjectMesh(object);
    const rebased = rebaseLocalPoint(
      { x: object.x || 0, z: object.z || 0 },
      object.refLat,
      object.refLon,
      anchor.lat,
      anchor.lon
    );
    applyObjectVisuals(mesh, { ...object, x: rebased.x, z: rebased.z });
  }

  for (const id of Object.keys(worldObjects)) {
    if (!seen.has(String(id))) {
      if (selectedObjectId !== null && String(selectedObjectId) === String(id)) clearSelection();
      worldObjects[id].dispose();
      delete worldObjects[id];
    }
  }

  updateSelectionHUD();
}

socket.on("connect", () => {
  setStatus("Connected");
  maybeSendPose(true);
  emitTelemetry("connect", { id: socket.id });
});

socket.on("worldState", (state) => {
  reconcileWorld(state);
  emitTelemetry("state", { users: Object.keys(state.clients || {}).length, objects: (state.objects || []).length });
});

socket.on("myCounters", (c) => {
  if (!c || typeof c !== "object") return;
  const value = c.deletedObjects ?? c.deletedCubes;
  if (isNumber(value)) {
    myDeletedCount = value;
    setCounts(Object.keys(lastWorldState?.clients || {}).length, (lastWorldState?.objects || []).length, myDeletedCount);
  }
});

socket.on("deleteResult", (r) => {
  if (!r || typeof r !== "object") return;
  if (r.ok) setStatus(`Connected (${String(socket.id || "").slice(-4)}) | Deleted object #${r.objectId}`);
  else setStatus(`Connected (${String(socket.id || "").slice(-4)}) | Delete failed: ${r.reason || "rejected"}`);
});

scene.onPointerObservable.add((pi) => {
  if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
  if (isPointerOverDrawerUI(pi.event)) return;
  const pick = scene.pick(scene.pointerX, scene.pointerY);
  if (pick && pick.hit && pick.pickedMesh) setSelection(pick.pickedMesh);
  else clearSelection();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Delete" || e.key === "Backspace") attemptDeleteSelected();
});

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

addHorizonRing();
ui = createDrawerUI();
setAnchorText();
syncAnchorInputs();
window.__scene = scene;
window.__setPrivateAnchor = promptForAnchor;

engine.runRenderLoop(() => {
  applyHeadingStabilization();
  maybeSendOrientationUpdate();
  updateSelectionHUD();
  scene.render();
});

window.addEventListener("resize", () => engine.resize());
