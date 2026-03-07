// public/main.js
// Telemetry logging patch:
// - Emits telemetry on GPS samples + drops so you can inspect from a Mac via /debug/telemetry
// - Does NOT change gameplay logic

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

// Follow mode: keep local player centered under the camera
let followMe = true;
let sharedAnchor = { lat: 0, lon: 0 };

function ensureFollowButton() {
  // If HTML doesn't have it yet, create it (keeps this patch compatible with older index.html)
  const hudButtons = document.getElementById("buttons");
  if (!hudButtons) return;

  let btn = document.getElementById("btnFollow");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "btnFollow";
    btn.textContent = "Follow: On";
    hudButtons.insertBefore(btn, hudButtons.firstChild);
  }

  btn.addEventListener("click", () => {
    followMe = !followMe;
    btn.textContent = followMe ? "Follow: On" : "Follow: Off";
    emitTelemetry("ui", { action: "followMe", followMe });
    if (!followMe) {
      worldRoot.position.x = 0;
      worldRoot.position.z = 0;
    }
  });
}



// Selection UI + delete action (created dynamically so we don't have to change index.html)
let selectionEl = null;
let btnDelete = null;

function ensureSelectionUI() {
  // Selection line: placed right under #status if possible
  if (!selectionEl && statusEl && statusEl.parentElement) {
    selectionEl = document.getElementById("selection");
    if (!selectionEl) {
      selectionEl = document.createElement("div");
      selectionEl.id = "selection";
      selectionEl.style.fontSize = "12px";
      selectionEl.style.lineHeight = "1.3";
      selectionEl.style.opacity = "0.9";
      selectionEl.style.marginTop = "2px";
      selectionEl.textContent = "Selected: none";
      statusEl.parentElement.insertBefore(selectionEl, statusEl.nextSibling);
    }
  }

  // Delete button: appears in the button row
  const hudButtons = document.getElementById("buttons");
  if (hudButtons && !btnDelete) {
    btnDelete = document.getElementById("btnDelete");
    if (!btnDelete) {
      btnDelete = document.createElement("button");
      btnDelete.id = "btnDelete";
      btnDelete.textContent = "Delete";
      btnDelete.disabled = true;
      hudButtons.appendChild(btnDelete);
    }
  }
}


// --- Babylon ---
const { engine, scene } = initScene(canvas);
const camera = initCamera(scene, canvas);



// A root node for world objects (lets us optionally stabilize heading by rotating the world).
const worldRoot = new BABYLON.TransformNode("worldRoot", scene);



// --- In-canvas Drawer UI (Babylon GUI) ---
let ui = null;
let uiStatusText = null;
let uiCountsText = null;
let uiSelectedText = null;
let uiDeleteBtn = null;

function createDrawerUI() {
  if (!BABYLON.GUI) {
    console.warn("Babylon GUI not loaded; falling back to HTML HUD.");
    return null;
  }

  const adt = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("drawerUI", true, scene);

  // Toggle button (hamburger)
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

  // Drawer pane
  const drawer = new BABYLON.GUI.Rectangle("drawerPane");
  drawer.width = "340px";
  drawer.height = "440px";
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

  function mkButton(id, label, onClick) {
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
    root.addControl(b);
    return b;
  }

  const bFollow = mkButton("uiFollow", "Follow: On", () => {
    followMe = !followMe;
    bFollow.textBlock.text = followMe ? "Follow: On" : "Follow: Off";
    emitTelemetry("ui", { action: "followMe", followMe });
    if (!followMe) {
      worldRoot.position.x = 0;
      worldRoot.position.z = 0;
    }
  });

  const bNorth = mkButton("uiNorth", "Lock North: Off", () => {
    lockNorth = !lockNorth;
    yawSmoothed = getCameraYawRad();
    yawZero = yawSmoothed;
    bNorth.textBlock.text = lockNorth ? "Lock North: On" : "Lock North: Off";
    emitTelemetry("ui", { action: "lockNorth", lockNorth });
  });

  const bPerm = mkButton("uiPerm", "Enable Motion", async () => {
    const ok = await requestDevicePermissions();
    bPerm.textBlock.text = ok ? "Motion Enabled" : "Motion Blocked";
    emitTelemetry("ui", { action: "perm", ok });
  });

  mkButton("uiColor", "Toggle Color", () => {
    socket.emit("toggleColor");
    emitTelemetry("ui", { action: "toggleColor" });
  });

  mkButton("uiDrop", "Drop Cube", () => {
    const rel = getCurrentRelativePosition();
    if (!rel) return;
    socket.emit("dropCube", { anchorLat: sharedAnchor.lat, anchorLon: sharedAnchor.lon, relX: rel.x, relZ: rel.z });
    emitTelemetry("drop", { anchor: sharedAnchor, rel });
  });

  const anchorLabel = new BABYLON.GUI.TextBlock('anchorLabel', 'Anchor (lat, lon)');
  anchorLabel.color = '#cbd5e1';
  anchorLabel.fontSize = 12;
  anchorLabel.height = '22px';
  anchorLabel.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  root.addControl(anchorLabel);

  const anchorRow = new BABYLON.GUI.StackPanel('anchorRow');
  anchorRow.isVertical = false;
  anchorRow.height = '40px';
  anchorRow.isPointerBlocker = true;
  root.addControl(anchorRow);

  const anchorLatInput = new BABYLON.GUI.InputText('anchorLatInput', String(sharedAnchor.lat ?? 0));
  anchorLatInput.width = '48%';
  anchorLatInput.maxWidth = '48%';
  anchorLatInput.height = '40px';
  anchorLatInput.color = '#e6edf3';
  anchorLatInput.background = '#111827';
  anchorLatInput.focusedBackground = '#111827';
  anchorLatInput.thickness = 1;
  anchorLatInput.cornerRadius = 10;
  anchorLatInput.placeholderText = '0';
  anchorLatInput.isPointerBlocker = true;
  anchorRow.addControl(anchorLatInput);

  const anchorLonInput = new BABYLON.GUI.InputText('anchorLonInput', String(sharedAnchor.lon ?? 0));
  anchorLonInput.width = '48%';
  anchorLonInput.maxWidth = '48%';
  anchorLonInput.height = '40px';
  anchorLonInput.color = '#e6edf3';
  anchorLonInput.background = '#111827';
  anchorLonInput.focusedBackground = '#111827';
  anchorLonInput.thickness = 1;
  anchorLonInput.cornerRadius = 10;
  anchorLonInput.placeholderText = '0';
  anchorLonInput.isPointerBlocker = true;
  anchorRow.addControl(anchorLonInput);

  const anchorHint = new BABYLON.GUI.TextBlock('anchorHint', 'Default 0,0. Everyone must use the same anchor to share a world.');
  anchorHint.color = '#94a3b8';
  anchorHint.fontSize = 11;
  anchorHint.height = '38px';
  anchorHint.textWrapping = true;
  anchorHint.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  root.addControl(anchorHint);

  mkButton('uiAnchorSet', 'Set Anchor', () => {
    const lat = normalizeCoord(anchorLatInput.text, 0);
    const lon = normalizeCoord(anchorLonInput.text, 0);
    anchorLatInput.text = String(lat);
    anchorLonInput.text = String(lon);
    setSharedAnchor(lat, lon);
  });

  mkButton('uiAnchorUseMe', 'Use My GPS as Anchor', () => {
    const fix = currentLatLon();
    if (!fix) return;
    anchorLatInput.text = String(fix.lat);
    anchorLonInput.text = String(fix.lon);
    setSharedAnchor(fix.lat, fix.lon);
  });

  window.__anchorInputs = { anchorLatInput, anchorLonInput };

  uiDeleteBtn = mkButton("uiDelete", "Delete Selected", () => {
    attemptDeleteSelected();
  });
  uiDeleteBtn.isEnabled = false;
  uiDeleteBtn.alpha = 0.5;

  function setOpen(open) {
    drawer.isVisible = open;
  }
  toggle.onPointerUpObservable.add(() => setOpen(!drawer.isVisible));
  close.onPointerUpObservable.add(() => setOpen(false));

  return { adt, drawer, toggle };
}

ui = createDrawerUI();
updateAnchorUI();

function isPointerOverDrawerUI(evt) {
  // Simple screen-space hit test to avoid breaking selection.
  // Ignores clicks on the ☰ toggle (top-left) and the drawer pane when open (top-right).
  if (!evt) return false;

  const w = engine.getRenderWidth(true);

  const x = evt.clientX;
  const y = evt.clientY;

  // Toggle button area (top-left)
  const toggleLeft = 10, toggleTop = 10, toggleSize = 44;
  const overToggle = (x >= toggleLeft && x <= toggleLeft + toggleSize && y >= toggleTop && y <= toggleTop + toggleSize);

  // Drawer area (top-right) when visible
  let overDrawer = false;
  try {
    const drawer = ui?.drawer;
    if (drawer && drawer.isVisible) {
      const drawerWidth = 340;
      const drawerHeight = 420;
      const margin = 10;
      const drawerLeft = w - (drawerWidth + margin);
      const drawerTop = margin;
      overDrawer = (x >= drawerLeft && x <= w - margin && y >= drawerTop && y <= drawerTop + drawerHeight);
    }
  } catch (_) {}

  return overToggle || overDrawer;
}


function setUIStatus(s) {
  if (statusEl) statusEl.textContent = s;
  if (uiStatusText) uiStatusText.text = s;
}

function setUICounts(users, cubes, deleted) {
  if (uiCountsText) uiCountsText.text = `Users: ${users} | Cubes: ${cubes} | Deleted: ${deleted}`;
}

function updateAnchorUI() {
  const inputs = window.__anchorInputs;
  if (inputs?.anchorLatInput) inputs.anchorLatInput.text = String(sharedAnchor.lat ?? 0);
  if (inputs?.anchorLonInput) inputs.anchorLonInput.text = String(sharedAnchor.lon ?? 0);
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

// --- Selection / interaction ---
const SELECT_DELETE_RANGE_M = 8; // meters; must be within this to delete a dropped cube

let selectedMesh = null;
let selectedLabel = "none";
let selectedX = null;
let selectedZ = null;
let selectedKind = null;
let selectedId = null;
let selectedAnchor = null;

// Simple visual highlight
let highlight = null;
try {
  highlight = new BABYLON.HighlightLayer("hl", scene);
} catch (_) {
  highlight = null;
}

function clearSelection() {
  if (highlight && selectedMesh) {
    try { highlight.removeMesh(selectedMesh); } catch (_) {}
  }
  selectedMesh = null;
  selectedLabel = "none";
  selectedX = null;
  selectedZ = null;
  selectedKind = null;
  selectedId = null;
  selectedAnchor = null;
  setUISelected("Selected: none", false);
}

function setSelection(mesh) {
  if (!mesh) return clearSelection();

  // Only select meshes that opt in via metadata
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
  selectedId = md.blockId ?? md.socketId ?? null;

  selectedX = (typeof md.relX === "number") ? md.relX : null;
  selectedZ = (typeof md.relZ === "number") ? md.relZ : null;
  selectedAnchor = md.anchor ? { lat: md.anchor.lat, lon: md.anchor.lon } : null;

  if (selectedKind === "droppedCube") selectedLabel = `Cube #${selectedId}`;
  else if (selectedKind === "playerCube" || selectedKind === "playerSphere") selectedLabel = `Player ${shortId(String(selectedId || ""))}`;
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

    const meRel = getCurrentRelativePosition();
  if (meRel && isNumber(selectedX) && isNumber(selectedZ) && selectedAnchor && sameAnchor(sharedAnchor, selectedAnchor)) {
    const d = relativeDistMeters(meRel, { x: selectedX, z: selectedZ });
    distTxt = `distance: ${d.toFixed(1)}m`;

    if (selectedKind === "droppedCube" && d <= SELECT_DELETE_RANGE_M) {
      canDelete = true;
    }
  }

  if (selectedAnchor && !sameAnchor(sharedAnchor, selectedAnchor)) {
    distTxt = 'distance: anchor mismatch';
    canDelete = false;
  }

  setUISelected(`Selected: ${selectedLabel} | ${distTxt}`, canDelete);
}

function attemptDeleteSelected() {
  if (!selectedMesh) return;

  if (selectedKind !== "droppedCube" || selectedId == null) return;

    const meRel = getCurrentRelativePosition();
  if (!meRel || !isNumber(selectedX) || !isNumber(selectedZ) || !selectedAnchor || !sameAnchor(sharedAnchor, selectedAnchor)) return;

  const d = relativeDistMeters(meRel, { x: selectedX, z: selectedZ });
  if (d > SELECT_DELETE_RANGE_M) return;

  socket.emit("deleteCube", { blockId: selectedId });
  emitTelemetry("ui", { action: "deleteCube", blockId: selectedId, distM: d });

  // Optimistically clear selection; reconcile will dispose the cube after server confirms
  clearSelection();
}

// Pointer selection (tap / click on canvas)
scene.onPointerObservable.add((pi) => {
  if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;


  // Ignore clicks on HUD/buttons
  // Ignore taps on the in-canvas drawer UI regions
  if (isPointerOverDrawerUI(pi.event)) return;

  const target = pi.event && pi.event.target;
  if (target && target.id && (target.id.startsWith("btn") || target.id === "hud" || target.id === "buttons" || target.id === "status" || target.id === "selection")) {
    return;
  }

  const pick = scene.pick(scene.pointerX, scene.pointerY);
  if (pick && pick.hit && pick.pickedMesh) {
    setSelection(pick.pickedMesh);
  } else {
    clearSelection();
  }
});

// Delete via button / keyboard
if (btnDelete) {
  btnDelete.addEventListener("click", attemptDeleteSelected);
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Delete" || e.key === "Backspace") {
    attemptDeleteSelected();
  }
});


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
const PLAYER_CUBE_Y  = -5;   // below camera
const DROPPED_CUBE_Y = -1;   // "ground-ish"
const PLAYER_POINTER_Y_OFFSET = 1.6; // raise player pointer above dropped cubes
const REMOTE_SPHERE_Y_OFFSET = 10;

const GPS_ALPHA = 0.12;      // smoothing strength (0..1). Higher = more responsive, more jitter.
const DEAD_BAND_M = 1.8;     // ignore smaller movements (meters)
const SEND_MIN_MS = 350;     // throttle outgoing gps updates

const YAW_ALPHA = 0.08;      // heading smoothing if Lock North is enabled

// Telemetry throttling
const TELEMETRY_MIN_MS = 500;

// --- State ---
sharedAnchor = loadAnchor(); // {lat, lon}; default 0,0 and editable in Field Kit

let rawLat = null, rawLon = null;
let filtLat = null, filtLon = null;
let lastSentLat = null, lastSentLon = null;
let lastSentAt = 0;
let lastSentRelX = null, lastSentRelZ = null;

// Lock North
let lockNorth = false;
let yawZero = 0;
let yawSmoothed = 0;

let lastYawSent = null;
let lastYawSentAt = 0;
const YAW_SEND_MIN_MS = 120;
const YAW_SEND_MIN_DELTA = 0.03; // ~1.7 degrees

// Telemetry timing
let lastTelemAt = 0;

// Entities
const playerPointers = {}; // socketId -> pointer mesh (pyramid)
const droppedCubes = {};  // blockId -> cube mesh

// --- Helpers ---
function shortId(id){ return (id||'').slice(-4); }

function isNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function normalizeCoord(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function sameAnchor(a, b) {
  return !!a && !!b && Number(a.lat) === Number(b.lat) && Number(a.lon) === Number(b.lon);
}

function loadAnchor() {
  try {
    const raw = localStorage.getItem('fieldKitAnchor');
    if (raw) {
      const parsed = JSON.parse(raw);
      return { lat: normalizeCoord(parsed.lat, 0), lon: normalizeCoord(parsed.lon, 0) };
    }
  } catch (_) {}
  return { lat: 0, lon: 0 };
}

function saveAnchor(anchor) {
  try {
    localStorage.setItem('fieldKitAnchor', JSON.stringify({ lat: anchor.lat, lon: anchor.lon }));
  } catch (_) {}
}

function setSharedAnchor(lat, lon, { resetSendBaseline = true } = {}) {
  sharedAnchor = { lat: normalizeCoord(lat, 0), lon: normalizeCoord(lon, 0) };
  saveAnchor(sharedAnchor);
  updateAnchorUI();
  updateSelectionHUD();

  if (resetSendBaseline) {
    lastSentLat = null;
    lastSentLon = null;
    lastSentRelX = null;
    lastSentRelZ = null;
    lastSentAt = 0;
  }

  emitTelemetry('anchor', { anchor: sharedAnchor });
}

function metersPerDegLonAt(lat) {
  return 111320 * Math.cos(lat * Math.PI / 180);
}

function latLonToRelativeXZ(lat, lon, anchor = sharedAnchor) {
  const dLat = (lat - anchor.lat);
  const dLon = (lon - anchor.lon);
  const x = dLon * metersPerDegLonAt(anchor.lat);
  const z = dLat * 111320;
  return { x, z };
}

function relativeDistMeters(a, b) {
  if (!a || !b) return Infinity;
  if (!isNumber(a.x) || !isNumber(a.z) || !isNumber(b.x) || !isNumber(b.z)) return Infinity;
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function distMeters(lat1, lon1, lat2, lon2, anchor = sharedAnchor) {
  const a = latLonToRelativeXZ(lat1, lon1, anchor);
  const b = latLonToRelativeXZ(lat2, lon2, anchor);
  return relativeDistMeters(a, b);
}

function getCurrentRelativePosition() {
  const fix = currentLatLon();
  if (!fix) return null;
  return latLonToRelativeXZ(fix.lat, fix.lon, sharedAnchor);
}


function ensurePlayerPointer(id, color) {
  if (playerPointers[id]) return playerPointers[id];

  // A pyramid-like marker (4-sided cone) that indicates facing direction.
  const p = BABYLON.MeshBuilder.CreateCylinder(
    `playerPointer_${id}`,
    { diameterTop: 0, diameterBottom: 0.9, height: 1.6, tessellation: 4 },
    scene
  );

  const mat = new BABYLON.StandardMaterial(`playerPointerMat_${id}`, scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(color || "#FFCC00");
  mat.emissiveColor = BABYLON.Color3.FromHexString("#1f2937");
  mat.specularColor = BABYLON.Color3.Black();
  p.material = mat;

  p.parent = worldRoot;
  p.isPickable = true;

  // Point forward along +Z (cone axis is Y)
  p.rotation.x = Math.PI / 2;

  playerPointers[id] = p;
  return p;
}

function ensureDroppedCube(blockId, color) {
  if (!droppedCubes[blockId]) {
    const cube = initBox(scene, color);
    cube.name = `droppedCube_${blockId}`;
    cube.parent = worldRoot;
      cube.isPickable = true;
  cube.metadata = { kind: "droppedCube", blockId: blockId };
droppedCubes[blockId] = cube;
  }
  return droppedCubes[blockId];
}

// Extract yaw from camera quaternion (radians)
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
  if (!socket || !socket.connected) return;
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

// --- Telemetry emit (best effort) ---
function emitTelemetry(kind, extra = {}) {
  const now = Date.now();
  if (kind === "gps" && now - lastTelemAt < TELEMETRY_MIN_MS) return;
  if (kind === "state" && now - lastTelemAt < TELEMETRY_MIN_MS) return;

  lastTelemAt = now;

  let proj = null;
  try {
    if (isNumber(filtLat) && isNumber(filtLon)) proj = latLonToRelativeXZ(filtLat, filtLon, sharedAnchor);
  } catch (_) {}

  const payload = {
    kind,
    lockNorth,
    sharedAnchor,
    raw: isNumber(rawLat) && isNumber(rawLon) ? { lat: rawLat, lon: rawLon } : null,
    filt: isNumber(filtLat) && isNumber(filtLon) ? { lat: filtLat, lon: filtLon } : null,
    proj: proj ? { x: proj.x, z: proj.z } : null,
    yaw: getCameraYawRad(),
    extra
  };

  socket.emit("telemetry", payload);
}

// --- UI wiring ---
ensureFollowButton();
ensureSelectionUI();
if (btnDelete && !btnDelete.__wired) { btnDelete.__wired = true; btnDelete.addEventListener("click", attemptDeleteSelected); }
if (btnPerm) {
  btnPerm.addEventListener("click", async () => {
    const ok = await requestDevicePermissions();
    btnPerm.textContent = ok ? "Motion Enabled" : "Motion Blocked";
    emitTelemetry("ui", { action: "perm", ok });
  });
}

if (btnNorth) {
  btnNorth.addEventListener("click", () => {
    lockNorth = !lockNorth;
    yawSmoothed = getCameraYawRad();
    yawZero = yawSmoothed;

    btnNorth.textContent = lockNorth ? "Lock North: On" : "Lock North: Off";
    emitTelemetry("ui", { action: "lockNorth", lockNorth });
  });
}

if (btnColor) {
  btnColor.addEventListener("click", () => {
    socket.emit("toggleColor");
    emitTelemetry("ui", { action: "toggleColor" });
  });
}

if (btnDrop) {
  btnDrop.addEventListener("click", () => {
    const rel = getCurrentRelativePosition();
    if (!rel) return;

    socket.emit("dropCube", { anchorLat: sharedAnchor.lat, anchorLon: sharedAnchor.lon, relX: rel.x, relZ: rel.z });
    emitTelemetry("drop", { anchor: sharedAnchor, rel });
  });
}

// --- GPS ---
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

  // Emit telemetry with sensor metadata (accuracy/speed/heading)
  if (coords) {
    emitTelemetry("gps", {
      accuracy: coords.accuracy,
      altitude: coords.altitude,
      altitudeAccuracy: coords.altitudeAccuracy,
      heading: coords.heading,
      speed: coords.speed
    });
  } else {
    emitTelemetry("gps");
  }

  const rel = latLonToRelativeXZ(filtLat, filtLon, sharedAnchor);
  const now = Date.now();
  if (lastSentLat === null || lastSentLon === null || lastSentRelX === null || lastSentRelZ === null) {
    lastSentLat = filtLat;
    lastSentLon = filtLon;
    lastSentRelX = rel.x;
    lastSentRelZ = rel.z;
    lastSentAt = now;
    socket.emit("gpsUpdate", { anchorLat: sharedAnchor.lat, anchorLon: sharedAnchor.lon, relX: rel.x, relZ: rel.z });
    return;
  }

  if (now - lastSentAt < SEND_MIN_MS) return;

  const moved = relativeDistMeters({ x: lastSentRelX, z: lastSentRelZ }, rel);
  if (moved < DEAD_BAND_M) return;

  lastSentLat = filtLat;
  lastSentLon = filtLon;
  lastSentRelX = rel.x;
  lastSentRelZ = rel.z;
  lastSentAt = now;
  socket.emit("gpsUpdate", { anchorLat: sharedAnchor.lat, anchorLon: sharedAnchor.lon, relX: rel.x, relZ: rel.z });
}

// Start watchPosition
if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      if (isNumber(lat) && isNumber(lon)) onGeo(lat, lon, pos.coords);
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
let lastWorldState = null;
let myDeletedCount = 0;
function reconcileWorld(state) {
  lastWorldState = state;

  const clientIds = Object.keys(state.clients || {});
  const blockCount = (state.droppedBlocks || []).length;

  setUIStatus(`Connected (${shortId(socket.id)})`);
  setUICounts(clientIds.length, blockCount, myDeletedCount);

  // Players (pointers only; no cubes/spheres)
  for (const [id, c] of Object.entries(state.clients || {})) {
    const ptr = ensurePlayerPointer(id, c.color);

    if (isNumber(c.relX) && isNumber(c.relZ) && sameAnchor(sharedAnchor, { lat: c.anchorLat, lon: c.anchorLon })) {
      ptr.position.set(c.relX, DROPPED_CUBE_Y + PLAYER_POINTER_Y_OFFSET, c.relZ);
      ptr.setEnabled(true);
      ptr.metadata = { ...(ptr.metadata || {}), relX: c.relX, relZ: c.relZ, anchor: { lat: c.anchorLat, lon: c.anchorLon }, kind: "playerPointer", socketId: id };
    } else {
      ptr.setEnabled(false);
    }

    // Rotate to match that player's heading (yaw) in world coordinates.
    // Since ptr is parented to worldRoot, convert world yaw into local yaw by subtracting worldRoot rotation.
    if (isNumber(c.yaw)) {
      ptr.rotation.y = c.yaw - worldRoot.rotation.y;
    }
  }

  // Remove disconnected players

  for (const id of Object.keys(playerPointers)) {
    if (!state.clients || !state.clients[id]) {
      playerPointers[id].dispose();
      delete playerPointers[id];
    }
  }

  // Follow mode: translate the world so the local player's cube stays centered under the camera.
  if (followMe && socket.id && playerPointers[socket.id]) {
    const me = playerPointers[socket.id];
    worldRoot.position.x = -me.position.x;
    worldRoot.position.z = -me.position.z;
  }

  // Dropped cubes (create/update)
  const presentBlocks = new Set();
  for (const b of (state.droppedBlocks || [])) {
    if (!isNumber(b.id) || !isNumber(b.relX) || !isNumber(b.relZ)) continue;
    if (!sameAnchor(sharedAnchor, { lat: b.anchorLat, lon: b.anchorLon })) continue;
    presentBlocks.add(String(b.id));

    const cube = ensureDroppedCube(b.id, b.color);
    cube.position.set(b.relX, DROPPED_CUBE_Y, b.relZ);
    cube.metadata = { ...(cube.metadata || {}), relX: b.relX, relZ: b.relZ, anchor: { lat: b.anchorLat, lon: b.anchorLon }, kind: "droppedCube", blockId: b.id };
  }

  // Remove deleted dropped cubes (works even when droppedBlocks is empty)
  for (const id of Object.keys(droppedCubes)) {
    if (!presentBlocks.has(String(id))) {
      if (selectedKind === "droppedCube" && String(selectedId) === String(id)) {
        clearSelection();
      }
      droppedCubes[id].dispose();
      delete droppedCubes[id];
    }
  }

  // If the selected mesh was disposed for any reason, clear it
  if (selectedMesh && selectedMesh.isDisposed && selectedMesh.isDisposed()) {
    clearSelection();
  }

  // Update selection HUD (distance may change as GPS updates)
  updateSelectionHUD();
}


socket.on("myCounters", (c) => {
  if (!c || typeof c !== "object") return;
  if (typeof c.deletedCubes === "number" && Number.isFinite(c.deletedCubes)) {
    myDeletedCount = c.deletedCubes;
    // Update counts immediately if we have last state
    const users = Object.keys(lastWorldState?.clients || {}).length;
    const cubes = (lastWorldState?.droppedBlocks || []).length;
    setUICounts(users, cubes, myDeletedCount);
  }
});

socket.on("deleteResult", (r) => {
  // Quick feedback so you can tell if the server accepted the delete
  if (!r || typeof r !== "object") return;
  if (r.ok) {
    setUIStatus(`Connected (${shortId(socket.id)}) | Deleted cube #${r.blockId}`);
    if (r.actionCounters && lastWorldState) {
      setUICounts(Object.keys(lastWorldState.clients || {}).length, (lastWorldState.droppedBlocks || []).length, r.actionCounters.deletedCubes || 0);
    }
  } else {
    const reason = r.reason || "rejected";
    setUIStatus(`Connected (${shortId(socket.id)}) | Delete failed: ${reason}`);
    if (r.actionCounters && lastWorldState) {
      setUICounts(Object.keys(lastWorldState.clients || {}).length, (lastWorldState.droppedBlocks || []).length, r.actionCounters.deletedCubes || 0);
    }
  }
});

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

// --- Render loop ---
engine.runRenderLoop(() => {
  applyHeadingStabilization();
  maybeSendOrientationUpdate();
  updateSelectionHUD();
  scene.render();
});

window.addEventListener("resize", () => engine.resize());
