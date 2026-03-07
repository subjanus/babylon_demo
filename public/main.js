import { initScene } from "./initScene.js";
import { initCamera } from "./initCamera.js";
import { requestDevicePermissions } from "./requestPermissions.js";

const canvas = document.getElementById("renderCanvas");
const statusEl = document.getElementById("status");

const { engine, scene } = initScene(canvas);
const camera = initCamera(scene, canvas);
camera.position.y = 2.4;

const socket = io({
  path: "/socket.io",
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 800
});

const worldRoot = new BABYLON.TransformNode("worldRoot", scene);
const horizonRoot = new BABYLON.TransformNode("horizonRoot", scene);
const horizonRing = BABYLON.MeshBuilder.CreateTorus("horizonRing", { diameter: 18, thickness: 0.06, tessellation: 96 }, scene);
const horizonMat = new BABYLON.StandardMaterial("horizonMat", scene);
horizonMat.emissiveColor = new BABYLON.Color3(0.3, 0.6, 1.0);
horizonMat.alpha = 0.55;
horizonMat.disableLighting = true;
horizonRing.material = horizonMat;
// Torus is already in the ground plane here; leave it level for a true horizon guide.
horizonRing.parent = horizonRoot;

const northTick = BABYLON.MeshBuilder.CreateCylinder("northTick", { height: 0.85, diameterTop: 0.0, diameterBottom: 0.35, tessellation: 12 }, scene);
const northMat = new BABYLON.StandardMaterial("northMat", scene);
northMat.emissiveColor = new BABYLON.Color3(1.0, 0.35, 0.2);
northMat.alpha = 0.92;
northMat.disableLighting = true;
northTick.material = northMat;
northTick.rotation.z = Math.PI / 2;
northTick.position.set(0, 0, -9.4);
northTick.parent = horizonRoot;

const eastTick = BABYLON.MeshBuilder.CreateBox("eastTick", { width: 0.18, height: 0.18, depth: 0.9 }, scene);
const eastMat = new BABYLON.StandardMaterial("eastMat", scene);
eastMat.emissiveColor = new BABYLON.Color3(0.4, 0.85, 1.0);
eastMat.alpha = 0.65;
eastMat.disableLighting = true;
eastTick.material = eastMat;
eastTick.position.set(9, 0, 0);
eastTick.parent = horizonRoot;

let followMe = true;
let lockNorth = false;
let yawZero = 0;
let yawSmoothed = 0;
let lastYawSent = null;
let lastYawSentAt = 0;
let lastTelemAt = 0;
let myDeletedCount = 0;
let lastWorldState = null;
let selectedMesh = null;
let selectedObjectId = null;
let selectedLabel = "none";
let selectedKind = null;
let selectedRel = null;
let highlight = null;
let uiStatusText = null;
let uiCountsText = null;
let uiSelectedText = null;
let uiDeleteBtn = null;
let anchorInput = null;
let anchorSummaryText = null;
let bFollow = null;
let bNorth = null;

const YAW_ALPHA = 0.08;
const YAW_SEND_MIN_MS = 120;
const YAW_SEND_MIN_DELTA = 0.03;
const GPS_ALPHA = 0.12;
const SEND_MIN_MS = 350;
const DEAD_BAND_M = 1.8;
const TELEMETRY_MIN_MS = 500;
const SELECT_DELETE_RANGE_M = 8;
const DROPPED_CUBE_Y = -1;
const PLAYER_POINTER_Y = 0.6;
const ANCHOR_KEY = "fieldkit.anchor.v1";

let anchorLat = 0;
let anchorLon = 0;
let anchorKey = "0.000000,0.000000";
let rawLat = null, rawLon = null;
let filtLat = null, filtLon = null;
let lastSentRelX = null, lastSentRelZ = null, lastSentAt = 0;

const playerPointers = {};
const objectMeshes = {};
const triggerMemory = new Map();

try { highlight = new BABYLON.HighlightLayer("hl", scene); } catch (_) { highlight = null; }

function isNumber(n) { return typeof n === "number" && Number.isFinite(n); }
function shortId(id) { return String(id || "").slice(-4); }
function normAnchor(lat, lon) {
  const aLat = Number(lat);
  const aLon = Number(lon);
  return {
    lat: Number.isFinite(aLat) ? aLat : 0,
    lon: Number.isFinite(aLon) ? aLon : 0,
    key: `${(Number.isFinite(aLat) ? aLat : 0).toFixed(6)},${(Number.isFinite(aLon) ? aLon : 0).toFixed(6)}`
  };
}
function metersPerDegLonAt(lat) { return 111320 * Math.cos(lat * Math.PI / 180); }
function latLonToRel(lat, lon, aLat = anchorLat, aLon = anchorLon) {
  const dLat = lat - aLat;
  const dLon = lon - aLon;
  return { x: dLon * metersPerDegLonAt(aLat), z: dLat * 111320 };
}
function relDist(a, b) { return Math.hypot((a.x || 0) - (b.x || 0), (a.z || 0) - (b.z || 0)); }
function currentRel() {
  const lat = isNumber(filtLat) ? filtLat : rawLat;
  const lon = isNumber(filtLon) ? filtLon : rawLon;
  if (!isNumber(lat) || !isNumber(lon)) return null;
  return latLonToRel(lat, lon);
}
function setStatus(s) {
  if (statusEl) statusEl.textContent = s;
  if (uiStatusText) uiStatusText.text = s;
}
function setCounts(users, objects, deleted) {
  if (uiCountsText) uiCountsText.text = `Users: ${users} | Objects: ${objects} | Deleted: ${deleted}`;
}
function setSelected(s, canDelete = false) {
  if (uiSelectedText) uiSelectedText.text = s;
  if (uiDeleteBtn) {
    uiDeleteBtn.isEnabled = !!canDelete;
    uiDeleteBtn.alpha = canDelete ? 1 : 0.5;
  }
}
function saveAnchor() {
  localStorage.setItem(ANCHOR_KEY, JSON.stringify({ lat: anchorLat, lon: anchorLon }));
}
function loadAnchor() {
  try {
    const raw = JSON.parse(localStorage.getItem(ANCHOR_KEY) || "null");
    if (raw && Number.isFinite(Number(raw.lat)) && Number.isFinite(Number(raw.lon))) {
      const n = normAnchor(raw.lat, raw.lon);
      anchorLat = n.lat; anchorLon = n.lon; anchorKey = n.key;
    }
  } catch (_) {}
}
function parseAnchorText(value) {
  const raw = String(value ?? "").trim();
  const m = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}
function formatAnchorText(lat = anchorLat, lon = anchorLon) {
  return `${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;
}
function applyAnchor(lat, lon) {
  const n = normAnchor(lat, lon);
  anchorLat = n.lat; anchorLon = n.lon; anchorKey = n.key;
  if (anchorInput) anchorInput.text = formatAnchorText(anchorLat, anchorLon);
  if (anchorSummaryText) anchorSummaryText.text = `Anchor: ${anchorLat.toFixed(6)}, ${anchorLon.toFixed(6)}`;
  saveAnchor();
  sendGpsNow();
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
  if (lastYawSent !== null) {
    const d = normalizeAngleRad(yaw - lastYawSent);
    if (Math.abs(d) < YAW_SEND_MIN_DELTA) return;
  }
  lastYawSent = yaw;
  lastYawSentAt = now;
  socket.emit("orientationUpdate", { yaw });
}
function updateLocalHorizon() {
  const q = camera.rotationQuaternion;
  const yaw = q ? q.toEulerAngles().y : (camera.rotation?.y || 0);
  horizonRoot.position.set(camera.position.x, camera.position.y - 2.15, camera.position.z);
  horizonRoot.rotation.set(0, -yaw, 0);
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
  if (now - lastTelemAt < TELEMETRY_MIN_MS && (kind === "gps" || kind === "state")) return;
  lastTelemAt = now;
  socket.emit("telemetry", {
    kind,
    anchorKey,
    anchorLat,
    anchorLon,
    rel: currentRel(),
    raw: isNumber(rawLat) && isNumber(rawLon) ? { lat: rawLat, lon: rawLon } : null,
    extra
  });
}

function mkInput(stack, id, labelText, initialText) {
  const label = new BABYLON.GUI.TextBlock(id + "Label", labelText);
  label.height = "18px";
  label.fontSize = 12;
  label.color = "#cbd5e1";
  label.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  stack.addControl(label);

  const input = new BABYLON.GUI.InputText(id);
  input.width = "100%";
  input.height = "34px";
  input.background = "#111827";
  input.color = "#e6edf3";
  input.focusedBackground = "#0f172a";
  input.thickness = 1;
  input.cornerRadius = 10;
  input.text = initialText;
  input.maxWidth = 1;
  stack.addControl(input);
  return input;
}

function mkButton(stack, id, label, onClick) {
  const b = BABYLON.GUI.Button.CreateSimpleButton(id, label);
  b.width = "100%";
  b.height = "40px";
  b.color = "#e6edf3";
  b.background = "#111827";
  b.thickness = 1;
  b.cornerRadius = 12;
  b.paddingTop = "6px";
  b.isPointerBlocker = true;
  b.onPointerUpObservable.add(() => onClick(b));
  stack.addControl(b);
  return b;
}

function createDrawerUI() {
  const adt = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("ui", true, scene);

  const toggle = BABYLON.GUI.Button.CreateSimpleButton("drawerToggle", "☰");
  toggle.width = "44px";
  toggle.height = "44px";
  toggle.color = "#e6edf3";
  toggle.background = "#111827";
  toggle.cornerRadius = 12;
  toggle.thickness = 1;
  toggle.left = "10px";
  toggle.top = "10px";
  toggle.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  toggle.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
  adt.addControl(toggle);

  const drawer = new BABYLON.GUI.Rectangle("drawer");
  drawer.width = "340px";
  drawer.height = "560px";
  drawer.thickness = 1;
  drawer.cornerRadius = 16;
  drawer.color = "#334155";
  drawer.background = "#0b1220ee";
  drawer.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
  drawer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
  drawer.left = "-10px";
  drawer.top = "10px";
  drawer.isVisible = true;
  adt.addControl(drawer);

  const root = new BABYLON.GUI.StackPanel("drawerRoot");
  root.width = 0.94;
  root.paddingTop = "10px";
  root.paddingLeft = "10px";
  root.paddingRight = "10px";
  drawer.addControl(root);

  const headerRow = new BABYLON.GUI.StackPanel("headerRow");
  headerRow.isVertical = false;
  headerRow.height = "34px";
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
  headerRow.addControl(close);

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
  uiCountsText.height = "28px";
  uiCountsText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  root.addControl(uiCountsText);

  uiSelectedText = new BABYLON.GUI.TextBlock("uiSelected", "Selected: none");
  uiSelectedText.color = "#cbd5e1";
  uiSelectedText.fontSize = 12;
  uiSelectedText.height = "40px";
  uiSelectedText.textWrapping = true;
  uiSelectedText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  root.addControl(uiSelectedText);

  const sep = new BABYLON.GUI.Rectangle("sep");
  sep.height = "1px";
  sep.thickness = 0;
  sep.background = "#1f2937";
  root.addControl(sep);

  anchorSummaryText = new BABYLON.GUI.TextBlock("anchorSummary", "Anchor: 0.000000, 0.000000");
  anchorSummaryText.color = "#93c5fd";
  anchorSummaryText.fontSize = 12;
  anchorSummaryText.height = "24px";
  anchorSummaryText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  root.addControl(anchorSummaryText);

  anchorInput = mkInput(root, "anchorInput", "Anchor Lat,Lon", formatAnchorText(anchorLat, anchorLon));

  mkButton(root, "uiSetAnchor", "Set Anchor", () => {
    const parsed = parseAnchorText(anchorInput?.text);
    if (!parsed) {
      setStatus("Anchor format: lat,lon");
      emitTelemetry("ui", { action: "setAnchorInvalid", value: anchorInput?.text || "" });
      return;
    }
    applyAnchor(parsed.lat, parsed.lon);
    emitTelemetry("ui", { action: "setAnchor", anchorLat, anchorLon });
  });

  mkButton(root, "uiPasteAnchor", "Paste Anchor", async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseAnchorText(text);
      if (!parsed) {
        setStatus("Clipboard needs: lat,lon");
        emitTelemetry("ui", { action: "pasteAnchorInvalid", value: String(text || "").slice(0, 120) });
        return;
      }
      applyAnchor(parsed.lat, parsed.lon);
      emitTelemetry("ui", { action: "pasteAnchor", anchorLat, anchorLon });
    } catch (_) {
      setStatus("Clipboard paste blocked");
      emitTelemetry("ui", { action: "pasteAnchorBlocked" });
    }
  });

  mkButton(root, "uiUseGpsAnchor", "Use My GPS as Anchor", () => {
    if (isNumber(rawLat) && isNumber(rawLon)) {
      applyAnchor(rawLat, rawLon);
      emitTelemetry("ui", { action: "useGpsAnchor", anchorLat, anchorLon });
    }
  });

  bFollow = mkButton(root, "uiFollow", "Follow: On", () => {
    followMe = !followMe;
    bFollow.textBlock.text = followMe ? "Follow: On" : "Follow: Off";
    if (!followMe) {
      worldRoot.position.x = 0;
      worldRoot.position.z = 0;
    }
  });

  bNorth = mkButton(root, "uiNorth", "Lock North: Off", () => {
    lockNorth = !lockNorth;
    yawSmoothed = getCameraYawRad();
    yawZero = yawSmoothed;
    bNorth.textBlock.text = lockNorth ? "Lock North: On" : "Lock North: Off";
  });

  mkButton(root, "uiPerm", "Enable Motion", async (btn) => {
    const ok = await requestDevicePermissions();
    btn.textBlock.text = ok ? "Motion Enabled" : "Motion Blocked";
  });

  mkButton(root, "uiColor", "Toggle Color", () => socket.emit("toggleColor"));
  mkButton(root, "uiDrop", "Drop Cube", () => {
    const rel = currentRel();
    if (!rel) return;
    socket.emit("dropCube", { anchorLat, anchorLon, relX: rel.x, relY: 0, relZ: rel.z });
    emitTelemetry("drop", { relX: rel.x, relZ: rel.z });
  });

  uiDeleteBtn = mkButton(root, "uiDelete", "Delete Selected", attemptDeleteSelected);
  uiDeleteBtn.isEnabled = false;
  uiDeleteBtn.alpha = 0.5;

  const help = new BABYLON.GUI.TextBlock("helpText", "Privacy mode: only anchor + relative meters are transmitted. Raw GPS stays on the client.");
  help.height = "70px";
  help.textWrapping = true;
  help.fontSize = 11;
  help.color = "#94a3b8";
  help.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  root.addControl(help);

  function setOpen(open) { drawer.isVisible = open; }
  toggle.onPointerUpObservable.add(() => setOpen(!drawer.isVisible));
  close.onPointerUpObservable.add(() => setOpen(false));
  return { drawer, toggle };
}

const ui = createDrawerUI();
loadAnchor();
applyAnchor(anchorLat, anchorLon);

function isPointerOverDrawerUI(evt) {
  if (!evt) return false;
  const w = engine.getRenderWidth(true);
  const x = evt.clientX;
  const y = evt.clientY;
  const overToggle = x >= 10 && x <= 54 && y >= 10 && y <= 54;
  let overDrawer = false;
  try {
    if (ui?.drawer?.isVisible) {
      const drawerWidth = 340;
      const drawerHeight = 560;
      const margin = 10;
      const drawerLeft = w - (drawerWidth + margin);
      const drawerTop = margin;
      overDrawer = x >= drawerLeft && x <= w - margin && y >= drawerTop && y <= drawerTop + drawerHeight;
    }
  } catch (_) {}
  return overToggle || overDrawer;
}

function ensurePlayerPointer(id, color) {
  if (playerPointers[id]) return playerPointers[id];
  const p = BABYLON.MeshBuilder.CreateCylinder(`playerPointer_${id}`, { diameterTop: 0, diameterBottom: 0.9, height: 1.6, tessellation: 4 }, scene);
  const mat = new BABYLON.StandardMaterial(`playerPointerMat_${id}`, scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(color || "#FFCC00");
  mat.emissiveColor = BABYLON.Color3.FromHexString("#1f2937");
  mat.specularColor = BABYLON.Color3.Black();
  p.material = mat;
  p.parent = worldRoot;
  p.isPickable = true;
  p.rotation.x = Math.PI / 2;
  playerPointers[id] = p;
  return p;
}

function disposeObjectMesh(id) {
  const mesh = objectMeshes[id];
  if (!mesh) return;
  if (selectedObjectId === Number(id) || selectedObjectId === String(id)) clearSelection();
  try { mesh.dispose(); } catch (_) {}
  delete objectMeshes[id];
}

function buildMeshForObject(obj) {
  let mesh;
  const kind = obj.kind;
  const sx = obj.scale?.x || 1;
  const sy = obj.scale?.y || 1;
  const sz = obj.scale?.z || 1;
  if (kind === "sphere") {
    mesh = BABYLON.MeshBuilder.CreateSphere(`obj_${obj.id}`, { diameter: Math.max(sx, sy, sz) }, scene);
  } else if (kind === "cylinder") {
    mesh = BABYLON.MeshBuilder.CreateCylinder(`obj_${obj.id}`, { diameter: Math.max(sx, sz), height: sy }, scene);
  } else if (kind === "plane" || kind === "billboard") {
    mesh = BABYLON.MeshBuilder.CreatePlane(`obj_${obj.id}`, { width: sx, height: sy }, scene);
  } else if (kind === "triggerZone") {
    mesh = BABYLON.MeshBuilder.CreateTorus(`obj_${obj.id}`, { diameter: Math.max(sx, sz), thickness: Math.max(0.05, Math.min(sx, sz) * 0.05) }, scene);
    mesh.rotation.x = Math.PI / 2;
  } else {
    mesh = BABYLON.MeshBuilder.CreateBox(`obj_${obj.id}`, { width: sx, height: sy, depth: sz }, scene);
  }

  const mat = new BABYLON.StandardMaterial(`mat_${obj.id}`, scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(obj.visual?.color || "#00A3FF");
  mat.emissiveColor = kind === "triggerZone" ? BABYLON.Color3.FromHexString(obj.visual?.color || "#00A3FF").scale(0.4) : BABYLON.Color3.Black();
  mat.specularColor = BABYLON.Color3.Black();
  mat.alpha = typeof obj.visual?.opacity === "number" ? obj.visual.opacity : 1;
  mat.wireframe = !!obj.visual?.wireframe;
  mesh.material = mat;
  mesh.parent = worldRoot;
  mesh.isPickable = true;
  if (obj.kind === "billboard" || obj.visual?.billboard) mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
  mesh.metadata = { kind: "worldObject", objectId: obj.id };

  if (obj.visual?.label) {
    const plane = BABYLON.MeshBuilder.CreatePlane(`label_${obj.id}`, { width: 4, height: 1 }, scene);
    plane.parent = mesh;
    plane.position.y = 1.5;
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    const tex = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(plane, 512, 128, false);
    const tb = new BABYLON.GUI.TextBlock(`tb_${obj.id}`, obj.visual.label);
    tb.color = "#e6edf3";
    tb.fontSize = 56;
    tex.addControl(tb);
  }

  return mesh;
}

function ensureObjectMesh(obj) {
  if (!objectMeshes[obj.id]) objectMeshes[obj.id] = buildMeshForObject(obj);
  return objectMeshes[obj.id];
}

function clearSelection() {
  if (highlight && selectedMesh) {
    try { highlight.removeMesh(selectedMesh); } catch (_) {}
  }
  selectedMesh = null;
  selectedObjectId = null;
  selectedLabel = "none";
  selectedKind = null;
  selectedRel = null;
  setSelected("Selected: none", false);
}

function setSelection(mesh) {
  if (!mesh) return clearSelection();
  const md = mesh.metadata || {};
  if (!md.kind) return clearSelection();
  if (highlight) {
    if (selectedMesh) {
      try { highlight.removeMesh(selectedMesh); } catch (_) {}
    }
    try { highlight.addMesh(mesh, BABYLON.Color3.FromHexString("#FFCC00")); } catch (_) {}
  }
  selectedMesh = mesh;
  selectedKind = md.kind;
  selectedObjectId = md.objectId ?? null;
  selectedLabel = md.kind === "worldObject" ? `Object #${selectedObjectId}` : String(md.kind);
  selectedRel = md.rel ? { ...md.rel } : null;
  updateSelectionHUD();
  maybeEmitTapTrigger(selectedObjectId);
}

function updateSelectionHUD() {
  if (!selectedMesh || !selectedRel) {
    setSelected("Selected: none", false);
    return;
  }
  const me = currentRel();
  let canDelete = false;
  let distTxt = "distance: ?";
  if (me) {
    const d = relDist(me, selectedRel);
    distTxt = `distance: ${d.toFixed(1)}m`;
    const obj = (lastWorldState?.worldObjects || []).find(o => Number(o.id) === Number(selectedObjectId));
    if (obj?.subtype === "droppedCube" && d <= SELECT_DELETE_RANGE_M) canDelete = true;
  }
  setSelected(`Selected: ${selectedLabel} | ${distTxt}`, canDelete);
}

function attemptDeleteSelected() {
  if (!selectedObjectId || !selectedRel) return;
  const obj = (lastWorldState?.worldObjects || []).find(o => Number(o.id) === Number(selectedObjectId));
  if (!obj || obj.subtype !== "droppedCube") return;
  const me = currentRel();
  if (!me) return;
  const d = relDist(me, selectedRel);
  if (d > SELECT_DELETE_RANGE_M) return;
  socket.emit("deleteCube", { objectId: selectedObjectId });
  clearSelection();
}

function maybeEmitTapTrigger(objectId) {
  const obj = (lastWorldState?.worldObjects || []).find(o => Number(o.id) === Number(objectId));
  if (!obj?.trigger?.enabled || obj.trigger.type !== "tap") return;
  const me = currentRel();
  socket.emit("objectTriggerEvent", {
    objectId: obj.id,
    triggerId: obj.trigger.triggerId,
    triggerType: "tap",
    relX: me?.x ?? 0,
    relZ: me?.z ?? 0,
    distM: me ? relDist(me, obj.position || { x: 0, z: 0 }) : null
  });
}

scene.onPointerObservable.add((pi) => {
  if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
  if (isPointerOverDrawerUI(pi.event)) return;
  const pick = scene.pick(scene.pointerX, scene.pointerY);
  if (pick && pick.hit && pick.pickedMesh) setSelection(pick.pickedMesh);
  else clearSelection();
});

function onGeo(lat, lon, coords) {
  rawLat = lat; rawLon = lon;
  if (filtLat === null || filtLon === null) {
    filtLat = lat; filtLon = lon;
  } else {
    filtLat = filtLat + (lat - filtLat) * GPS_ALPHA;
    filtLon = filtLon + (lon - filtLon) * GPS_ALPHA;
  }
  emitTelemetry("gps", {
    accuracy: coords?.accuracy,
    heading: coords?.heading,
    speed: coords?.speed
  });
  maybeSendGpsUpdate();
}

function sendGpsNow() {
  const rel = currentRel();
  if (!rel || !socket.connected) return;
  socket.emit("gpsUpdate", { anchorLat, anchorLon, relX: rel.x, relY: 0, relZ: rel.z });
}

function maybeSendGpsUpdate() {
  const rel = currentRel();
  if (!rel) return;
  const now = Date.now();
  if (lastSentRelX === null || lastSentRelZ === null) {
    lastSentRelX = rel.x; lastSentRelZ = rel.z; lastSentAt = now; sendGpsNow(); return;
  }
  if (now - lastSentAt < SEND_MIN_MS) return;
  const moved = Math.hypot(rel.x - lastSentRelX, rel.z - lastSentRelZ);
  if (moved < DEAD_BAND_M) return;
  lastSentRelX = rel.x; lastSentRelZ = rel.z; lastSentAt = now; sendGpsNow();
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

function reconcileWorld(state) {
  lastWorldState = state || { clients: {}, worldObjects: [] };
  const clients = state.clients || {};
  const worldObjects = Array.isArray(state.worldObjects) ? state.worldObjects : [];

  setStatus(`Connected (${shortId(socket.id)}) | Anchor ${anchorKey}`);
  setCounts(Object.keys(clients).filter(id => (clients[id]?.role || "player") === "player").length, worldObjects.length, myDeletedCount);

  for (const [id, c] of Object.entries(clients)) {
    if (c.role === "daemon") continue;
    const ptr = ensurePlayerPointer(id, c.color);
    if (c.anchorKey !== anchorKey || !isNumber(c.relX) || !isNumber(c.relZ)) {
      ptr.setEnabled(false);
      continue;
    }
    ptr.setEnabled(true);
    ptr.position.set(c.relX, PLAYER_POINTER_Y, c.relZ);
    ptr.metadata = { kind: "playerPointer", socketId: id, rel: { x: c.relX, z: c.relZ } };
    if (isNumber(c.yaw)) ptr.rotation.y = c.yaw - worldRoot.rotation.y;
  }

  for (const id of Object.keys(playerPointers)) {
    if (!clients[id] || clients[id].role === "daemon") {
      try { playerPointers[id].dispose(); } catch (_) {}
      delete playerPointers[id];
    }
  }

  const present = new Set();
  for (const obj of worldObjects) {
    present.add(String(obj.id));
    if (obj.anchorKey !== anchorKey || obj.state?.active === false) {
      disposeObjectMesh(obj.id);
      continue;
    }
    const mesh = ensureObjectMesh(obj);
    mesh.setEnabled(true);
    mesh.position.set(obj.position?.x || 0, (obj.position?.y || 0) + (obj.subtype === "droppedCube" ? DROPPED_CUBE_Y : 0), obj.position?.z || 0);
    mesh.rotation.set(obj.rotation?.x || 0, obj.rotation?.y || 0, obj.rotation?.z || 0);
    mesh.scaling.set(obj.scale?.x || 1, obj.scale?.y || 1, obj.scale?.z || 1);
    mesh.metadata = { kind: "worldObject", objectId: obj.id, rel: { x: obj.position?.x || 0, z: obj.position?.z || 0 } };
  }

  for (const id of Object.keys(objectMeshes)) {
    if (!present.has(String(id))) disposeObjectMesh(id);
  }

  if (followMe) {
    const meLocal = currentRel();
    if (meLocal && isNumber(meLocal.x) && isNumber(meLocal.z)) {
      worldRoot.position.x = -meLocal.x;
      worldRoot.position.z = -meLocal.z;
    } else {
      const me = clients[socket.id];
      if (me && me.anchorKey === anchorKey && isNumber(me.relX) && isNumber(me.relZ)) {
        worldRoot.position.x = -me.relX;
        worldRoot.position.z = -me.relZ;
      }
    }
  }

  updateSelectionHUD();
  processProximityTriggers();
}

function processProximityTriggers() {
  const me = currentRel();
  if (!me || !lastWorldState) return;
  const now = Date.now();
  for (const obj of (lastWorldState.worldObjects || [])) {
    if (obj.anchorKey !== anchorKey) continue;
    if (!obj.trigger?.enabled || obj.trigger.type !== "proximity") continue;
    const d = relDist(me, obj.position || { x: 0, z: 0 });
    const key = `${obj.id}:${obj.trigger.triggerId}`;
    const entry = triggerMemory.get(key) || { fired: false, lastAt: 0 };
    const inside = d <= Number(obj.trigger.radius || 0);
    if (inside) {
      const cooldownMs = Number(obj.trigger.cooldownMs || 0);
      const ready = !entry.fired || (cooldownMs > 0 && now - entry.lastAt >= cooldownMs);
      if (ready) {
        socket.emit("objectTriggerEvent", {
          objectId: obj.id,
          triggerId: obj.trigger.triggerId,
          triggerType: "proximity",
          relX: me.x,
          relZ: me.z,
          distM: d
        });
        entry.fired = true;
        entry.lastAt = now;
        triggerMemory.set(key, entry);
      }
    } else if (!obj.trigger.oncePerClient) {
      entry.fired = false;
      triggerMemory.set(key, entry);
    }
  }
}

socket.on("myCounters", (c) => {
  if (c && Number.isFinite(c.deletedCubes)) {
    myDeletedCount = c.deletedCubes;
    setCounts(Object.keys(lastWorldState?.clients || {}).length, (lastWorldState?.worldObjects || []).length, myDeletedCount);
  }
});

socket.on("deleteResult", (r) => {
  if (!r || typeof r !== "object") return;
  setStatus(r.ok ? `Connected (${shortId(socket.id)}) | Deleted object #${r.objectId}` : `Connected (${shortId(socket.id)}) | Delete failed: ${r.reason || 'rejected'}`);
});

socket.on("connect", () => {
  setStatus("Connected");
  emitTelemetry("connect", { id: socket.id });
  sendGpsNow();
});

socket.on("worldState", (state) => {
  reconcileWorld(state);
  emitTelemetry("state", { users: Object.keys(state.clients || {}).length, objects: (state.worldObjects || []).length });
});

engine.runRenderLoop(() => {
  applyHeadingStabilization();
  maybeSendOrientationUpdate();
  updateLocalHorizon();
  updateSelectionHUD();
  scene.render();
});
window.addEventListener("resize", () => engine.resize());
window.__scene = scene;
