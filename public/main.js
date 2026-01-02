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
    const lat = isNumber(filtLat) ? filtLat : rawLat;
    const lon = isNumber(filtLon) ? filtLon : rawLon;
    if (!isNumber(lat) || !isNumber(lon)) return;
    socket.emit("dropCube", { lat, lon });
    emitTelemetry("drop", { lat, lon });
  });

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
let selectedLat = null;
let selectedLon = null;
let selectedKind = null;
let selectedId = null;

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
  selectedLat = null;
  selectedLon = null;
  selectedKind = null;
  selectedId = null;
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

  selectedLat = (typeof md.lat === "number") ? md.lat : null;
  selectedLon = (typeof md.lon === "number") ? md.lon : null;

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
  if (!selectionEl) return;

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

    if (selectedKind === "droppedCube" && d <= SELECT_DELETE_RANGE_M) {
      canDelete = true;
    }
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


// --- Atmosphere (Swamp Noir) ---
// Goal: thicker green-gray fog, darker ground, moody light beams, soft shadows, limited visibility.
// Goal: cool mist hugging the ground, warm angled sun, soft shadows, and distance haze.

// Sky fill (soft ambient lift)
const skyFill = new BABYLON.HemisphericLight("skyFill", new BABYLON.Vector3(0, 1, 0), scene);
skyFill.intensity = 0.38;
skyFill.diffuse = new BABYLON.Color3(0.42, 0.50, 0.52);
skyFill.groundColor = new BABYLON.Color3(0.06, 0.08, 0.07);
skyFill.specular = new BABYLON.Color3(0, 0, 0);

// Sun (warm, angled)
const sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-0.55, -1.0, 0.35), scene);
sun.position = new BABYLON.Vector3(140, 260, -180);
sun.intensity = 0.92;
sun.diffuse = new BABYLON.Color3(0.98, 0.82, 0.58);
sun.specular = new BABYLON.Color3(0.10, 0.10, 0.10);

// Soft shadows
const shadowGen = new BABYLON.ShadowGenerator(2048, sun);
shadowGen.useBlurExponentialShadowMap = true;
shadowGen.blurKernel = 16;
shadowGen.bias = 0.0015;
shadowGen.normalBias = 0.02;

function castShadow(mesh) {
  if (!mesh) return;
  try { shadowGen.addShadowCaster(mesh, true); } catch (_) {}
}

// Ground plane (slightly below dropped cubes so it never z-fights)
const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 4000, height: 4000 }, scene);
ground.parent = worldRoot;
ground.position.y = DROPPED_CUBE_Y - 1.05;
ground.isPickable = false;
ground.receiveShadows = true;

const groundMat = new BABYLON.StandardMaterial("groundMat", scene);
groundMat.diffuseColor = new BABYLON.Color3(0.14, 0.16, 0.14); // swampy base
groundMat.emissiveColor = new BABYLON.Color3(0.01, 0.015, 0.012); // barely lifted
groundMat.specularColor = BABYLON.Color3.Black();
groundMat.alpha = 0.98; // denser, less airy
ground.material = groundMat;

// Distance haze
scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
scene.fogDensity = 0.030;
scene.fogColor = new BABYLON.Color3(0.34, 0.40, 0.36);
scene.clearColor = new BABYLON.Color4(0.08, 0.10, 0.10, 1.0);

// Film-ish grading (subtle)
scene.imageProcessingConfiguration.toneMappingEnabled = true;
scene.imageProcessingConfiguration.exposure = 0.92;
scene.imageProcessingConfiguration.contrast = 1.22;

// Subtle noir polish: faint bloom + vignette (guarded for performance)
try {
  const pipeline = new BABYLON.DefaultRenderingPipeline("noirPipeline", true, scene, [camera]);
  pipeline.fxaaEnabled = true;

  pipeline.bloomEnabled = true;
  pipeline.bloomWeight = 0.15;
  pipeline.bloomKernel = 32;
  pipeline.bloomThreshold = 0.88;
  pipeline.bloomScale = 0.5;

  pipeline.vignetteEnabled = true;
  pipeline.vignetteWeight = 1.3;
  pipeline.vignetteStretch = 0.2;
  pipeline.vignetteColor = new BABYLON.Color4(0.02, 0.03, 0.03, 1);
} catch (e) {
  console.warn("Noir pipeline unavailable:", e);
}

// Ground mist (particles that follow the camera so it feels infinite)
function makeMistTexture() {
  const tex = new BABYLON.DynamicTexture("mistTex", { width: 64, height: 64 }, scene, true);
  const ctx = tex.getContext();
  const w = 64, h = 64;
  const g = ctx.createRadialGradient(w/2, h/2, 4, w/2, h/2, w/2);
  g.addColorStop(0.0, "rgba(255,255,255,0.45)");
  g.addColorStop(0.35, "rgba(255,255,255,0.22)");
  g.addColorStop(1.0, "rgba(255,255,255,0.0)");
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = g;
  ctx.fillRect(0,0,w,h);
  tex.update();
  return tex;
}

const mistSystem = new BABYLON.ParticleSystem("groundMist", 2200, scene);
mistSystem.particleTexture = makeMistTexture();
mistSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;

mistSystem.minSize = 2.0;
mistSystem.maxSize = 6.0;
mistSystem.minLifeTime = 3.0;
mistSystem.maxLifeTime = 6.0;

mistSystem.emitRate = 170;
mistSystem.minEmitPower = 0.05;
mistSystem.maxEmitPower = 0.12;

mistSystem.color1 = new BABYLON.Color4(0.62, 0.70, 0.66, 0.12);
mistSystem.color2 = new BABYLON.Color4(0.52, 0.60, 0.56, 0.08);
mistSystem.colorDead = new BABYLON.Color4(0.52, 0.60, 0.56, 0.0);

// A wide, low box emitter — we keep it centered on camera each frame
mistSystem.minEmitBox = new BABYLON.Vector3(-24, 0, -24);
mistSystem.maxEmitBox = new BABYLON.Vector3(24, 0.4, 24);

// Mostly horizontal drift
mistSystem.direction1 = new BABYLON.Vector3(-0.08, 0.01, -0.08);
mistSystem.direction2 = new BABYLON.Vector3(0.08, 0.02, 0.08);

mistSystem.gravity = new BABYLON.Vector3(0, -0.003, 0);
mistSystem.updateSpeed = 0.015;
mistSystem.start();

// God rays (subtle) — guarded so it won't crash if unsupported
let sunBillboard = null;
let godrays = null;

try {
  sunBillboard = BABYLON.MeshBuilder.CreatePlane("sunBillboard", { size: 18 }, scene);
  sunBillboard.isPickable = false;
  sunBillboard.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

  const sunMat = new BABYLON.StandardMaterial("sunBillboardMat", scene);
  sunMat.emissiveColor = new BABYLON.Color3(0.90, 0.72, 0.48);
  sunMat.disableLighting = true;
  sunMat.alpha = 0.65;
  sunBillboard.material = sunMat;

  godrays = new BABYLON.VolumetricLightScatteringPostProcess(
    "godrays",
    0.6,
    camera,
    sunBillboard,
    80,
    BABYLON.Texture.BILINEAR_SAMPLINGMODE,
    engine,
    false
  );
  godrays.exposure = 0.14;
  godrays.decay = 0.96;
  godrays.weight = 0.48;
  godrays.density = 0.78;
} catch (e) {
  console.warn("God rays unavailable:", e);
}

// Keep mist + sun billboard positioned relative to the active camera
function updateAtmosphere() {
  const camPos = scene.activeCamera?.globalPosition || scene.activeCamera?.position;
  if (camPos) {
    // Mist: centered on camera, hugging ground
    mistSystem.emitter = new BABYLON.Vector3(camPos.x, DROPPED_CUBE_Y + 0.2, camPos.z);

    // "Breathing" mist
    const t = performance.now() * 0.001;
    mistSystem.emitRate = 150 + Math.sin(t * 0.55) * 55;

    // Sun billboard far in the sky opposite the light direction
    if (sunBillboard) {
      const sunDir = sun.direction.normalize();
      const sunPosDir = sunDir.scale(-1);
      const target = new BABYLON.Vector3(camPos.x, camPos.y, camPos.z).add(sunPosDir.scale(500));
      sunBillboard.position.copyFrom(target);
    }
  }
}

const GPS_ALPHA = 0.12;      // smoothing strength (0..1). Higher = more responsive, more jitter.
const DEAD_BAND_M = 1.8;     // ignore smaller movements (meters)
const SEND_MIN_MS = 350;     // throttle outgoing gps updates

const YAW_ALPHA = 0.08;      // heading smoothing if Lock North is enabled

// Telemetry throttling
const TELEMETRY_MIN_MS = 500;

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
  return Math.hypot(a.x - b.x, a.z - b.z);
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

  castShadow(p);

  playerPointers[id] = p;
  return p;
}

function ensureDroppedCube(blockId, color) {
  if (!droppedCubes[blockId]) {
    const cube = initBox(scene, color);
    cube.name = `droppedCube_${blockId}`;
    cube.parent = worldRoot;
    cube.isPickable = true;
    cube.metadata = { kind: "droppedCube", blockId };

    castShadow(cube);

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
    if (isNumber(filtLat) && isNumber(filtLon)) proj = latLonToXZ(filtLat, filtLon);
  } catch (_) {}

  const payload = {
    kind,
    lockNorth,
    worldOrigin,
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
    const lat = isNumber(filtLat) ? filtLat : rawLat;
    const lon = isNumber(filtLon) ? filtLon : rawLon;
    if (!isNumber(lat) || !isNumber(lon)) return;

    socket.emit("dropCube", { lat, lon });
    emitTelemetry("drop", { lat, lon });
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
  if (state.worldOrigin && (!worldOrigin || state.worldOrigin.lat !== worldOrigin.lat || state.worldOrigin.lon !== worldOrigin.lon)) {
    setupProjection(state.worldOrigin);
  }

  const clientIds = Object.keys(state.clients || {});
  const blockCount = (state.droppedBlocks || []).length;

  setUIStatus(`Connected (${shortId(socket.id)})`);
  setUICounts(clientIds.length, blockCount, myDeletedCount);

  // Players (pointers only; no cubes/spheres)
  for (const [id, c] of Object.entries(state.clients || {})) {
    const ptr = ensurePlayerPointer(id, c.color);

    if (isNumber(c.lat) && isNumber(c.lon)) {
      const { x, z } = latLonToXZ(c.lat, c.lon);
      ptr.position.set(x, DROPPED_CUBE_Y + PLAYER_POINTER_Y_OFFSET, z);
      ptr.metadata = { ...(ptr.metadata || {}), lat: c.lat, lon: c.lon, kind: "playerPointer", socketId: id };
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
    if (!isNumber(b.id) || !isNumber(b.lat) || !isNumber(b.lon)) continue;
    presentBlocks.add(String(b.id));

    const cube = ensureDroppedCube(b.id, b.color);
    const { x, z } = latLonToXZ(b.lat, b.lon);
    cube.position.set(x, DROPPED_CUBE_Y, z);
    cube.metadata = { ...(cube.metadata || {}), lat: b.lat, lon: b.lon, kind: "droppedCube", blockId: b.id };
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
  updateAtmosphere();
  updateSelectionHUD();
  scene.render();
});

window.addEventListener("resize", () => engine.resize());
