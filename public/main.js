import { initScene } from "./initScene.js";
import { initCamera } from "./initCamera.js";
import { requestDevicePermissions } from "./requestPermissions.js";
import { createGestureLab } from "./gestureLab.js";
import { createMotionLab } from "./motionLab.js";

const canvas = document.getElementById("renderCanvas");
const statusEl = document.getElementById("status");

const { engine, scene } = initScene(canvas);
// Recovery Calibration v1: full device quaternion for pitch + compass yaw + roll ignored.
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
horizonRing.isPickable = false;
horizonRing.parent = horizonRoot;

// Four compact cardinal markers: shape + color are both unique.
const cardinalRadius = 9.25;
function cardinalMat(name, hex) {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.emissiveColor = BABYLON.Color3.FromHexString(hex);
  m.alpha = 0.92;
  m.disableLighting = true;
  return m;
}
const northTick = BABYLON.MeshBuilder.CreateCylinder("northTick", { height: 0.68, diameterTop: 0, diameterBottom: 0.34, tessellation: 12 }, scene);
northTick.material = cardinalMat("northMat", "#FF5A36"); northTick.position.set(0,0,-cardinalRadius); northTick.parent=horizonRoot; northTick.isPickable=false;
const eastTick = BABYLON.MeshBuilder.CreateBox("eastTick", { width:0.16, height:0.18, depth:0.72 }, scene);
eastTick.material = cardinalMat("eastMat", "#27D3FF"); eastTick.position.set(cardinalRadius,0,0); eastTick.parent=horizonRoot; eastTick.isPickable=false;
const southTick = BABYLON.MeshBuilder.CreateSphere("southTick", { diameter:0.38, segments:12 }, scene);
southTick.material = cardinalMat("southMat", "#58E36D"); southTick.position.set(0,0,cardinalRadius); southTick.parent=horizonRoot; southTick.isPickable=false;
const westTick = BABYLON.MeshBuilder.CreateCylinder("westTick", { height:0.46, diameter:0.44, tessellation:4 }, scene);
westTick.material = cardinalMat("westMat", "#C084FC"); westTick.rotation.y=Math.PI/4; westTick.position.set(-cardinalRadius,0,0); westTick.parent=horizonRoot; westTick.isPickable=false;

// SYMBOLIC CALIBRATION v1 ---------------------------------------------------
// These two objects deliberately do NOT depend on GPS/worldRoot. They stay
// directly above and below the camera in world-Y so we can tell the difference
// between "the camera failed to pitch" and "there was simply nothing there".
const symbolicRoot = new BABYLON.TransformNode("symbolicRoot", scene);

const symbolicUp = BABYLON.MeshBuilder.CreateSphere(
  "symbolicUpGold",
  { diameter: 1.5, segments: 24 },
  scene
);
const symbolicUpMat = new BABYLON.StandardMaterial("symbolicUpGoldMat", scene);
symbolicUpMat.diffuseColor = BABYLON.Color3.FromHexString("#FFD54A");
symbolicUpMat.emissiveColor = BABYLON.Color3.FromHexString("#FFB300").scale(0.9);
symbolicUpMat.specularColor = BABYLON.Color3.Black();
symbolicUp.material = symbolicUpMat;
symbolicUp.parent = symbolicRoot;
symbolicUp.position.set(0, 6.0, 0);
symbolicUp.isPickable = false;

// Exact opposite of the gold sphere: an unmistakable cyan sphere below the
// camera.  This avoids any ambiguity about whether a flat ground marker is
// edge-on, occluded, or simply outside the frustum.
const symbolicDownSphere = BABYLON.MeshBuilder.CreateSphere(
  "symbolicDownCyan",
  { diameter: 1.5, segments: 24 },
  scene
);
const symbolicDownSphereMat = new BABYLON.StandardMaterial("symbolicDownCyanMat", scene);
symbolicDownSphereMat.diffuseColor = BABYLON.Color3.FromHexString("#22D3EE");
symbolicDownSphereMat.emissiveColor = BABYLON.Color3.FromHexString("#0891B2").scale(0.95);
symbolicDownSphereMat.specularColor = BABYLON.Color3.Black();
symbolicDownSphere.material = symbolicDownSphereMat;
symbolicDownSphere.parent = symbolicRoot;
symbolicDownSphere.position.set(0, -6.0, 0);
symbolicDownSphere.isPickable = false;

// A bright ring + triangular center directly below the camera. This is a local
// "ME / DOWN" diagnostic, independent of the network player mesh.
const symbolicDownRing = BABYLON.MeshBuilder.CreateTorus(
  "symbolicDownRing",
  { diameter: 2.4, thickness: 0.16, tessellation: 64 },
  scene
);
const symbolicDownMat = new BABYLON.StandardMaterial("symbolicDownMat", scene);
symbolicDownMat.diffuseColor = BABYLON.Color3.FromHexString("#22D3EE");
symbolicDownMat.emissiveColor = BABYLON.Color3.FromHexString("#22D3EE").scale(0.95);
symbolicDownMat.specularColor = BABYLON.Color3.Black();
symbolicDownMat.disableLighting = true;
symbolicDownRing.material = symbolicDownMat;
symbolicDownRing.parent = symbolicRoot;
symbolicDownRing.position.set(0, -2.05, 0);
symbolicDownRing.isPickable = false;

const symbolicDownTri = BABYLON.MeshBuilder.CreateDisc(
  "symbolicDownTriangle",
  { radius: 0.82, tessellation: 3, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
  scene
);
symbolicDownTri.material = symbolicDownMat;
symbolicDownTri.parent = symbolicRoot;
symbolicDownTri.rotation.x = Math.PI / 2;
symbolicDownTri.position.set(0, -2.02, 0);
symbolicDownTri.isPickable = false;

function updateSymbolicCalibration() {
  // Follow camera translation only. Never inherit camera rotation.
  symbolicRoot.position.copyFrom(camera.position);
  symbolicRoot.rotationQuaternion = null;
  symbolicRoot.rotation.set(0, 0, 0);
}

let followMe = true;
let lockNorth = false;
let yawZero = 0;
let yawSmoothed = 0;
let motionEnabled = false;
let localYawRad = 0;
let localPitchRad = 0;
let localRollRad = 0;

// Motion Engine v3 keeps the browser VIEW orientation separate from the
// PHYSICAL holding posture.  This matters on iPhone when iOS orientation lock
// keeps Safari portrait while the user physically rotates the phone sideways.
let physicalPosture = "unknown";
let physicalPostureConfidence = 0;
let postureCandidate = "unknown";
let postureCandidateSince = 0;
let postureBase = "unknown";
let postureAutoNormalize = false;
let postureBaseChangedAt = 0;
let lastOrientationEventAt = 0;
let motionInputStatus = "waiting";
let motionYawSource = "none";
let pitchZeroDeg = null;
let lastBetaDeg = null;
const POSTURE_DWELL_MS = 850;

let lastGeoHeadingRad = null;
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
const DEAD_BAND_M = 0.35;
const TELEMETRY_MIN_MS = 500;
const SELECT_DELETE_RANGE_M = 8;
const DROPPED_CUBE_Y = -1;
const PLAYER_POINTER_Y = 0.6;
const ANCHOR_KEY = "fieldkit.anchor.v1";
const SESSION_ORIGIN_KEY = "fieldkit.sessionOrigin.v1";

let anchorLat = 0;
let anchorLon = 0;
let anchorKey = "0.000000,0.000000";
let rawLat = null, rawLon = null;
let filtLat = null, filtLon = null;
let sessionOriginLat = null, sessionOriginLon = null;
let sessionOriginPending = false;
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
  const lat = isNumber(rawLat) ? rawLat : filtLat;
  const lon = isNumber(rawLon) ? rawLon : filtLon;
  if (!isNumber(lat) || !isNumber(lon)) return null;
  if (!isNumber(sessionOriginLat) || !isNumber(sessionOriginLon)) return null;
  return latLonToRel(lat, lon, sessionOriginLat, sessionOriginLon);
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
function saveSessionOrigin() {
  if (isNumber(sessionOriginLat) && isNumber(sessionOriginLon)) {
    localStorage.setItem(SESSION_ORIGIN_KEY, JSON.stringify({ lat: sessionOriginLat, lon: sessionOriginLon, anchorKey }));
  } else {
    localStorage.removeItem(SESSION_ORIGIN_KEY);
  }
}
function loadAnchor() {
  try {
    const raw = JSON.parse(localStorage.getItem(ANCHOR_KEY) || "null");
    if (raw && Number.isFinite(Number(raw.lat)) && Number.isFinite(Number(raw.lon))) {
      const n = normAnchor(raw.lat, raw.lon);
      anchorLat = n.lat; anchorLon = n.lon; anchorKey = n.key;
    }
  } catch (_) {}
  try {
    const rawOrigin = JSON.parse(localStorage.getItem(SESSION_ORIGIN_KEY) || "null");
    if (rawOrigin && rawOrigin.anchorKey === anchorKey && Number.isFinite(Number(rawOrigin.lat)) && Number.isFinite(Number(rawOrigin.lon))) {
      sessionOriginLat = Number(rawOrigin.lat);
      sessionOriginLon = Number(rawOrigin.lon);
      sessionOriginPending = false;
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
function updateAnchorSummary() {
  if (!anchorSummaryText) return;
  let suffix = " | Session origin: waiting";
  if (isNumber(sessionOriginLat) && isNumber(sessionOriginLon)) suffix = " | Session origin: captured";
  else if (sessionOriginPending) suffix = " | Session origin: awaiting GPS";
  anchorSummaryText.text = `Anchor: ${anchorLat.toFixed(6)}, ${anchorLon.toFixed(6)}${suffix}`;
}
function calibrateSessionOrigin(lat = rawLat, lon = rawLon) {
  if (!isNumber(lat) || !isNumber(lon)) return false;
  sessionOriginLat = Number(lat);
  sessionOriginLon = Number(lon);
  sessionOriginPending = false;
  lastSentRelX = null;
  lastSentRelZ = null;
  lastSentAt = 0;
  saveSessionOrigin();
  updateAnchorSummary();
  return true;
}
function applyAnchor(lat, lon) {
  const n = normAnchor(lat, lon);
  anchorLat = n.lat; anchorLon = n.lon; anchorKey = n.key;
  if (anchorInput) anchorInput.text = formatAnchorText(anchorLat, anchorLon);
  sessionOriginLat = null;
  sessionOriginLon = null;
  sessionOriginPending = true;
  if (isNumber(rawLat) && isNumber(rawLon)) calibrateSessionOrigin(rawLat, rawLon);
  updateAnchorSummary();
  saveAnchor();
  saveSessionOrigin();
  sendGpsNow();
}

function getCameraYawRad() {
  return Number.isFinite(localYawRad) ? localYawRad : (camera.rotation?.y || 0);
}
function normalizeAngleRad(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function normalizeAngleDeg(a) {
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
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
  horizonRoot.position.set(camera.position.x, camera.position.y, camera.position.z);
  // True eye-level horizon guide: keep the ring centered at camera height.
  // The old version placed it 2.15 m below the camera, which made a level view
  // visibly dip below center. The camera quaternion alone now determines where
  // the horizon appears on screen.
  horizonRoot.rotationQuaternion = null;
  horizonRoot.rotation.set(0, 0, 0);
}

function qAxis(x, y, z, angle) {
  const h = angle * 0.5, s = Math.sin(h);
  return new BABYLON.Quaternion(x * s, y * s, z * s, Math.cos(h));
}
function qMul(a, b) {
  return new BABYLON.Quaternion(
    a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
    a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
    a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
    a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z
  );
}
function qRotateVector(q, v) {
  // Rotate v by quaternion directly.  Do not depend on Matrix.FromQuaternion,
  // which is not present in every Babylon.js build/API surface.
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const vx = v.x, vy = v.y, vz = v.z;

  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);

  // v' = v + qw*t + cross(q.xyz, t)
  return new BABYLON.Vector3(
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx)
  );
}
function yawFromQuaternion(q) {
  const f = qRotateVector(q, new BABYLON.Vector3(0, 0, 1));
  return normalizeAngleRad(Math.atan2(f.x, f.z));
}
function pitchFromQuaternion(q) {
  const f = qRotateVector(q, new BABYLON.Vector3(0, 0, 1));
  return Math.asin(BABYLON.Scalar.Clamp(f.y, -1, 1));
}
function rollFromQuaternion(q) {
  // Measure camera up against the no-roll up vector at the same yaw/pitch.
  const f = qRotateVector(q, new BABYLON.Vector3(0, 0, 1)).normalize();
  const u = qRotateVector(q, new BABYLON.Vector3(0, 1, 0)).normalize();
  const worldUp = new BABYLON.Vector3(0, 1, 0);
  let right = BABYLON.Vector3.Cross(worldUp, f);
  if (right.lengthSquared() < 1e-8) return 0;
  right.normalize();
  const noRollUp = BABYLON.Vector3.Cross(f, right).normalize();
  return Math.atan2(BABYLON.Vector3.Dot(u, right), BABYLON.Vector3.Dot(u, noRollUp));
}

function classifyPhysicalPosture(betaDeg, gammaDeg) {
  if (!Number.isFinite(betaDeg) || !Number.isFinite(gammaDeg)) {
    return { posture: physicalPosture, confidence: 0 };
  }
  const b = BABYLON.Angle.FromDegrees(betaDeg).radians();
  const g = BABYLON.Angle.FromDegrees(gammaDeg).radians();
  // For a normally-held portrait phone beta sits near +/-90 and gamma near 0.
  // For a sideways phone beta moves toward 0 while |gamma| approaches 90.
  const portraitStrength = Math.abs(Math.sin(b));
  const landscapeStrength = Math.abs(Math.sin(g));
  const confidence = Math.min(1, Math.abs(portraitStrength - landscapeStrength));

  if (portraitStrength >= landscapeStrength) {
    return { posture: betaDeg >= 0 ? "portrait" : "portrait-inverted", confidence };
  }
  return { posture: gammaDeg >= 0 ? "landscape-gamma+" : "landscape-gamma-", confidence };
}

function postureBaseRollRad(posture) {
  if (posture === "landscape-gamma+") return Math.PI / 2;
  if (posture === "landscape-gamma-") return -Math.PI / 2;
  if (posture === "portrait-inverted") return Math.PI;
  return 0;
}

function updatePhysicalPosture(betaDeg, gammaDeg, now = Date.now()) {
  const classified = classifyPhysicalPosture(betaDeg, gammaDeg);
  physicalPosture = classified.posture;
  physicalPostureConfidence = classified.confidence;

  // Do not chase noisy classifications.  A candidate must be reasonably clear
  // and remain stable for a short dwell before Auto Basis adopts it.
  if (classified.confidence < 0.35 || classified.posture === "unknown") return;
  if (postureCandidate !== classified.posture) {
    postureCandidate = classified.posture;
    postureCandidateSince = now;
  }
  if (postureBase === "unknown") {
    postureBase = classified.posture;
    postureBaseChangedAt = now;
    return;
  }
  if (postureAutoNormalize && postureBase !== postureCandidate && now - postureCandidateSince >= POSTURE_DWELL_MS) {
    postureBase = postureCandidate;
    postureBaseChangedAt = now;
  }
}

function adoptCurrentPhysicalPosture() {
  if (physicalPosture && physicalPosture !== "unknown") {
    postureBase = physicalPosture;
    postureCandidate = physicalPosture;
    postureCandidateSince = Date.now();
    postureBaseChangedAt = Date.now();
    return true;
  }
  return false;
}

function setPostureAutoNormalize(on) {
  postureAutoNormalize = !!on;
  return postureAutoNormalize;
}

function getViewFrameInfo() {
  const so = screen.orientation;
  const angle = (typeof window.orientation === "number") ? window.orientation : (so?.angle || 0);
  const viewport = window.innerWidth >= window.innerHeight ? "landscape" : "portrait";
  return { viewport, width: window.innerWidth, height: window.innerHeight, type: so?.type || "unknown", angle };
}

function applyDeviceOrientation(alphaDeg, betaDeg, gammaDeg, compassHeadingDeg = null) {
  if (!Number.isFinite(alphaDeg) || !Number.isFinite(betaDeg) || !Number.isFinite(gammaDeg)) return;

  const now = Date.now();
  lastOrientationEventAt = now;
  lastBetaDeg = betaDeg;

  // Keep posture classification for diagnostics only.  It does NOT gate or
  // remap the camera in this recovery build.
  const classified = classifyPhysicalPosture(betaDeg, gammaDeg);
  physicalPosture = classified.posture;
  physicalPostureConfidence = classified.confidence;
  motionInputStatus = "full quaternion pitch";

  const screenAngleDeg = (typeof window.orientation === "number")
    ? window.orientation
    : (screen.orientation?.angle || 0);
  const alpha = BABYLON.Angle.FromDegrees(alphaDeg).radians();
  const beta = BABYLON.Angle.FromDegrees(betaDeg).radians();
  const gamma = BABYLON.Angle.FromDegrees(gammaDeg).radians();
  const screen = BABYLON.Angle.FromDegrees(screenAngleDeg || 0).radians();

  // Reconstruct the physical phone attitude first.  This is the pre-v3 basis
  // that behaved well before physical-posture auto-normalization was added.
  // DeviceOrientation order: alpha(Z-ish world heading), beta(X), gamma(Y),
  // followed by the phone-camera correction and current browser screen angle.
  let sensorQ = qMul(qAxis(0,1,0,alpha), qAxis(1,0,0,beta));
  sensorQ = qMul(sensorQ, qAxis(0,0,1,-gamma));
  sensorQ = qMul(sensorQ, qAxis(1,0,0,-Math.PI / 2));
  sensorQ = qMul(sensorQ, qAxis(0,0,1,-screen));
  sensorQ.normalize();

  // Derive PITCH from the complete quaternion/forward vector, not directly
  // from beta. This survives DeviceOrientation Euler branch changes. The
  // project convention needs the sign mirrored: top edge toward user => UP,
  // top edge away => DOWN.
  const measuredPitch = pitchFromQuaternion(sensorQ);
  const limit = Math.PI / 2 - BABYLON.Angle.FromDegrees(1.5).radians();
  const pitch = BABYLON.Scalar.Clamp(-measuredPitch, -limit, limit);

  // YAW is anchored to iPhone compass heading when available.  Roll is
  // intentionally zero in this recovery build so false gamma/Euler roll cannot
  // tilt the horizon while we validate up/down.
  let headingDeg;
  if (Number.isFinite(compassHeadingDeg)) {
    headingDeg = compassHeadingDeg - (screenAngleDeg || 0);
    motionYawSource = "compass";
  } else {
    headingDeg = alphaDeg - (screenAngleDeg || 0);
    motionYawSource = "alpha";
  }
  const yaw = normalizeAngleRad(BABYLON.Angle.FromDegrees(headingDeg).radians());
  const roll = 0;

  let cameraQ = qMul(qAxis(0,1,0,yaw), qAxis(1,0,0,-pitch));
  cameraQ.normalize();
  camera.rotationQuaternion = cameraQ;

  localYawRad = yaw;
  localPitchRad = pitch;
  localRollRad = roll;
}

function handleDeviceOrientation(ev) {
  if (!motionEnabled) return;
  const compassHeadingDeg = Number.isFinite(ev.webkitCompassHeading) ? ev.webkitCompassHeading : null;
  applyDeviceOrientation(ev.alpha, ev.beta, ev.gamma, compassHeadingDeg);
}
// Use ONE orientation stream. iOS exposes compass heading on deviceorientation;
// listening to deviceorientationabsolute as well caused competing updates.
window.addEventListener("deviceorientation", handleDeviceOrientation, true);

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

let uiAudioCtx = null;
function ensureUiAudio() {
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    if (!uiAudioCtx) uiAudioCtx = new C();
    if (uiAudioCtx.state === "suspended") uiAudioCtx.resume().catch(()=>{});
    return uiAudioCtx;
  } catch (_) { return null; }
}
function playSelectionSound() {
  const ctx = ensureUiAudio(); if (!ctx) return;
  const now = ctx.currentTime;
  try {
    const g=ctx.createGain(); g.gain.setValueAtTime(.0001,now); g.gain.exponentialRampToValueAtTime(.11,now+.008); g.gain.exponentialRampToValueAtTime(.0001,now+.09); g.connect(ctx.destination);
    const o=ctx.createOscillator(); o.type="sine"; o.frequency.setValueAtTime(560,now); o.frequency.exponentialRampToValueAtTime(920,now+.07); o.connect(g); o.start(now); o.stop(now+.095);
  } catch (_) {}
}
canvas.addEventListener("pointerdown", () => ensureUiAudio(), { passive:true });

// Local-only AR camera background. Camera pixels never leave this browser.
let arStream = null;
let arVideo = null;
let arTexture = null;
let arLayer = null;
let arEnabled = false;
async function setArCameraEnabled(on) {
  if (!on) {
    arEnabled = false;
    if (arLayer) arLayer.isEnabled = false;
    if (arStream) { for (const t of arStream.getTracks()) t.stop(); arStream = null; }
    if (arVideo) { try { arVideo.pause(); arVideo.srcObject = null; } catch (_) {} }
    setStatus("AR camera off");
    return false;
  }
  if (!navigator.mediaDevices?.getUserMedia) { setStatus("Camera API unavailable"); return false; }
  try {
    if (!arVideo) {
      arVideo = document.createElement("video");
      arVideo.autoplay = true; arVideo.muted = true; arVideo.playsInline = true;
    }
    arStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:"environment" } }, audio:false });
    arVideo.srcObject = arStream;
    await arVideo.play();
    if (arTexture) { try { arTexture.dispose(); } catch (_) {} }
    arTexture = new BABYLON.VideoTexture("arCameraTexture", arVideo, scene, false, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE);
    arTexture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE; arTexture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    if (!arLayer) arLayer = new BABYLON.Layer("arCameraLayer", null, scene, true);
    arLayer.texture = arTexture; arLayer.isEnabled = true;
    arEnabled = true;
    setStatus("AR camera on | live video stays on this device");
    return true;
  } catch (err) {
    arEnabled = false;
    setStatus(`Camera blocked: ${err?.name || "permission denied"}`);
    return false;
  }
}

let gestureLab = null;
let motionLab = null;

function initMotionLabOnce() {
  if (motionLab) return motionLab;
  motionLab = createMotionLab({
    camera,
    getComputedState: () => ({
      localYawRad, localPitchRad, localRollRad, motionEnabled,
      physicalPosture, physicalPostureConfidence, postureCandidate, postureCandidateSince,
      postureBase, postureAutoNormalize, postureBaseChangedAt, lastOrientationEventAt,
      motionInputStatus, motionYawSource, pitchZeroDeg: null, lastBetaDeg, simpleMotionMode: false, recoveryQuaternionPitch: true,
      cameraControlMode: motionEnabled ? "motion" : ((gestureLab && gestureLab.isEnabled && gestureLab.isEnabled()) ? "gesture" : "pointer"),
      baseRollRad: 0, view: getViewFrameInfo()
    }),
    setAutoNormalize: setPostureAutoNormalize,
    adoptCurrentPosture: adoptCurrentPhysicalPosture,
    onStatus: (msg) => setStatus(msg)
  });
  window.__motionLab = motionLab;
  return motionLab;
}

function initGestureLabOnce() {
  if (gestureLab) return gestureLab;
  gestureLab = createGestureLab({
    canvas, camera, scene,
    onStatus: (msg) => setStatus(msg),
    onGestureComplete: (g) => {
      if (!g || g.cancelled || (g.sessionMaxFingers || 1) > 1) return;
      if (g.type === "swipe" || g.type === "flick") selectObjectInFront();
      else if (g.type === "tap") selectObjectAtClientPoint(g.endX, g.endY);
    }
  });
  return gestureLab;
}

// Camera input arbitration: Babylon FreeCamera pointer controls and the
// device-orientation engine must not both write camera attitude.  Gesture Lab
// also owns the touch surface while enabled.
function syncCameraControlMode() {
  const gestureOwnsTouch = !!(gestureLab && gestureLab.isEnabled && gestureLab.isEnabled());
  const sensorOwnsCamera = !!motionEnabled;
  const detach = sensorOwnsCamera || gestureOwnsTouch;
  try {
    if (detach) camera.detachControl(canvas);
    else camera.attachControl(canvas, true);
  } catch (_) {}
  return detach ? (sensorOwnsCamera ? 'motion' : 'gesture') : 'pointer';
}

function disableMotionCamera() {
  motionEnabled = false;
  pitchZeroDeg = null;
  // Preserve the current visual attitude when handing control back to Babylon's
  // pointer camera.  FreeCamera pointer inputs work naturally with Euler rotation.
  try {
    if (camera.rotationQuaternion) {
      const e = camera.rotationQuaternion.toEulerAngles();
      camera.rotationQuaternion = null;
      camera.rotation.copyFrom(e);
    }
  } catch (_) {}
  syncCameraControlMode();
}

function createDrawerUI() {
  const adt = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("ui", true, scene);
  function toggleButton(name,label,side){
    const b=BABYLON.GUI.Button.CreateSimpleButton(name,label); b.width="44px"; b.height="44px"; b.color="#e6edf3"; b.background="#111827"; b.cornerRadius=12; b.thickness=1; b.top="10px"; b.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    if(side==="left"){b.left="10px";b.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT}else{b.left="-10px";b.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT} adt.addControl(b); return b;
  }
  function drawerPanel(name,titleText,side,height){
    const d=new BABYLON.GUI.Rectangle(name); d.width="340px";d.height=`${height}px`;d.thickness=1;d.cornerRadius=16;d.color="#334155";d.background="#0b1220ee";d.top="10px";d.verticalAlignment=BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    if(side==="left"){d.left="10px";d.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT}else{d.left="-10px";d.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT} adt.addControl(d);
    const root=new BABYLON.GUI.StackPanel(name+"Root");root.width=.94;root.paddingTop="10px";root.paddingLeft="10px";root.paddingRight="10px";d.addControl(root);
    const row=new BABYLON.GUI.StackPanel(name+"Header");row.isVertical=false;row.height="34px";root.addControl(row);
    const title=new BABYLON.GUI.TextBlock(name+"Title",titleText);title.color="#e6edf3";title.fontSize=18;title.height="34px";title.resizeToFit=true;title.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;row.addControl(title);
    const close=BABYLON.GUI.Button.CreateSimpleButton(name+"Close","×");close.width="34px";close.height="34px";close.color="#e6edf3";close.background="#111827";close.thickness=1;close.cornerRadius=10;close.horizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;row.addControl(close);
    return {drawer:d,root,close,height};
  }
  const leftToggle=toggleButton("navDrawerToggle","☰","left");
  const rightToggle=toggleButton("toolsDrawerToggle","⚙","right");
  const nav=drawerPanel("navDrawer","Navigation","left",550);
  const tools=drawerPanel("toolsDrawer","World / AR Tools","right",500);
  nav.drawer.isVisible=true; tools.drawer.isVisible=false;

  uiStatusText=new BABYLON.GUI.TextBlock("uiStatus","Connecting…");uiStatusText.color="#e6edf3";uiStatusText.fontSize=12;uiStatusText.height="34px";uiStatusText.textWrapping=true;uiStatusText.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;nav.root.addControl(uiStatusText);
  uiCountsText=new BABYLON.GUI.TextBlock("uiCounts","Users: 0 | Objects: 0 | Deleted: 0");uiCountsText.color="#cbd5e1";uiCountsText.fontSize=12;uiCountsText.height="28px";uiCountsText.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;nav.root.addControl(uiCountsText);
  uiSelectedText=new BABYLON.GUI.TextBlock("uiSelected","Selected: none");uiSelectedText.color="#cbd5e1";uiSelectedText.fontSize=12;uiSelectedText.height="40px";uiSelectedText.textWrapping=true;uiSelectedText.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;nav.root.addControl(uiSelectedText);
  const sep=new BABYLON.GUI.Rectangle("navSep");sep.height="1px";sep.thickness=0;sep.background="#1f2937";nav.root.addControl(sep);
  anchorSummaryText=new BABYLON.GUI.TextBlock("anchorSummary","Anchor: 0.000000, 0.000000");anchorSummaryText.color="#93c5fd";anchorSummaryText.fontSize=12;anchorSummaryText.height="24px";anchorSummaryText.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;nav.root.addControl(anchorSummaryText);
  anchorInput=mkInput(nav.root,"anchorInput","Anchor Lat,Lon",formatAnchorText(anchorLat,anchorLon));
  mkButton(nav.root,"uiSetAnchor","Set Anchor",()=>{const parsed=parseAnchorText(anchorInput?.text);if(!parsed){setStatus("Anchor format: lat,lon");return}applyAnchor(parsed.lat,parsed.lon)});
  mkButton(nav.root,"uiPasteAnchor","Paste Anchor",async()=>{try{const text=await navigator.clipboard.readText();const parsed=parseAnchorText(text);if(!parsed){setStatus("Clipboard needs: lat,lon");return}applyAnchor(parsed.lat,parsed.lon)}catch(_){setStatus("Clipboard paste blocked")}});
  mkButton(nav.root,"uiUseGpsAnchor","Use My GPS as Anchor",()=>{if(isNumber(rawLat)&&isNumber(rawLon))applyAnchor(rawLat,rawLon)});
  bFollow=mkButton(nav.root,"uiFollow","Follow: On",()=>{followMe=!followMe;bFollow.textBlock.text=followMe?"Follow: On":"Follow: Off";if(!followMe){worldRoot.position.x=0;worldRoot.position.z=0}});
  bNorth=mkButton(nav.root,"uiNorth","Lock North: Off",()=>{lockNorth=!lockNorth;yawSmoothed=getCameraYawRad();yawZero=yawSmoothed;bNorth.textBlock.text=lockNorth?"Lock North: On":"Lock North: Off"});
  mkButton(nav.root,"uiPerm","Enable Motion",async(btn)=>{if(motionEnabled){disableMotionCamera();btn.textBlock.text="Enable Motion";setStatus("Motion disabled | finger camera restored");return}const ok=await requestDevicePermissions();motionEnabled=!!ok;pitchZeroDeg=null;btn.textBlock.text=ok?"Motion Enabled (tap to disable)":"Motion Blocked";if(!ok)return;syncCameraControlMode();camera.rotationQuaternion=camera.rotationQuaternion||BABYLON.Quaternion.Identity();setStatus("Motion enabled | phone owns camera")});

  mkButton(tools.root,"uiColor","Toggle Color",()=>socket.emit("toggleColor"));
  mkButton(tools.root,"uiDrop","Drop Cube",()=>{const rel=currentRel();if(!rel)return;socket.emit("dropCube",{anchorLat,anchorLon,relX:rel.x,relY:0,relZ:rel.z})});
  uiDeleteBtn=mkButton(tools.root,"uiDelete","Delete Selected",attemptDeleteSelected);uiDeleteBtn.isEnabled=false;uiDeleteBtn.alpha=.5;
  const bAr=mkButton(tools.root,"uiARCamera","AR Camera: Off",async(btn)=>{const on=await setArCameraEnabled(!arEnabled);btn.textBlock.text=on?"AR Camera: On":"AR Camera: Off"});
  const bGesture=mkButton(tools.root,"uiGestureLab","Gesture Lab: Off",(btn)=>{const lab=initGestureLabOnce();const on=lab.setEnabled(!lab.isEnabled());syncCameraControlMode();btn.textBlock.text=on?"Gesture Lab: On":"Gesture Lab: Off"});
  mkButton(tools.root,"uiMotionLab","Motion Lab: Off",(btn)=>{const lab=initMotionLabOnce();const on=lab.setEnabled(!lab.isEnabled());btn.textBlock.text=on?"Motion Lab: On":"Motion Lab: Off"});
  const help=new BABYLON.GUI.TextBlock("helpText","AR Camera is local-only. Swipe/Flick (Gesture Lab) selects the object centered in front of the camera. Hosted object textures can now use visual.imageUrl.");help.height="90px";help.textWrapping=true;help.fontSize=11;help.color="#94a3b8";help.textHorizontalAlignment=BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;tools.root.addControl(help);

  function narrow(){return window.innerWidth<760} function openNav(on){nav.drawer.isVisible=on;if(on&&narrow())tools.drawer.isVisible=false} function openTools(on){tools.drawer.isVisible=on;if(on&&narrow())nav.drawer.isVisible=false}
  leftToggle.onPointerUpObservable.add(()=>openNav(!nav.drawer.isVisible));rightToggle.onPointerUpObservable.add(()=>openTools(!tools.drawer.isVisible));nav.close.onPointerUpObservable.add(()=>openNav(false));tools.close.onPointerUpObservable.add(()=>openTools(false));
  return {leftDrawer:nav.drawer,rightDrawer:tools.drawer,leftDrawerHeight:nav.height,rightDrawerHeight:tools.height,leftToggle,rightToggle};
}

const ui = createDrawerUI();
loadAnchor();
if (anchorInput) anchorInput.text = formatAnchorText(anchorLat, anchorLon);
updateAnchorSummary();

function isPointerOverDrawerUI(evt) {
  if (!evt) return false;
  const w=window.innerWidth,x=evt.clientX,y=evt.clientY,margin=10,toggleSize=44,drawerWidth=340;
  const leftToggle=x>=margin&&x<=margin+toggleSize&&y>=margin&&y<=margin+toggleSize;
  const rightToggle=x>=w-margin-toggleSize&&x<=w-margin&&y>=margin&&y<=margin+toggleSize;
  let left=false,right=false;
  try{if(ui?.leftDrawer?.isVisible)left=x>=margin&&x<=margin+drawerWidth&&y>=margin&&y<=margin+(ui.leftDrawerHeight||550);if(ui?.rightDrawer?.isVisible)right=x>=w-margin-drawerWidth&&x<=w-margin&&y>=margin&&y<=margin+(ui.rightDrawerHeight||500)}catch(_){}
  return leftToggle||rightToggle||left||right;
}

function ensurePlayerPointer(id, color) {
  if (playerPointers[id]) return playerPointers[id];

  // A flat, double-sided triangle is much easier to reacquire when the player
  // looks down at their own position than the old cone laid on its side.
  const p = BABYLON.MeshBuilder.CreateDisc(
    `playerPointer_${id}`,
    { radius: 0.72, tessellation: 3, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
    scene
  );
  const mat = new BABYLON.StandardMaterial(`playerPointerMat_${id}`, scene);
  const c = BABYLON.Color3.FromHexString(color || "#FFCC00");
  mat.diffuseColor = c;
  mat.emissiveColor = c.scale(0.45);
  mat.specularColor = BABYLON.Color3.Black();
  mat.backFaceCulling = false;
  p.material = mat;
  p.parent = worldRoot;
  p.isPickable = true;

  // CreateDisc is vertical by default; lay it flat on the world X/Z plane.
  // A small elevation prevents z-fighting with future ground geometry.
  p.rotation.x = Math.PI / 2;
  p.position.y = PLAYER_POINTER_Y;
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
  const baseColor = BABYLON.Color3.FromHexString(obj.visual?.color || "#00A3FF");
  mat.diffuseColor = baseColor;
  mat.emissiveColor = kind === "triggerZone" ? baseColor.scale(0.4) : BABYLON.Color3.Black();
  mat.specularColor = BABYLON.Color3.Black();
  mat.alpha = typeof obj.visual?.opacity === "number" ? obj.visual.opacity : 1;
  mat.wireframe = !!obj.visual?.wireframe;
  mat.backFaceCulling = false;
  if (obj.visual?.imageUrl) {
    const tex = new BABYLON.Texture(obj.visual.imageUrl, scene, true, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    tex.hasAlpha = true;
    mat.diffuseTexture = tex;
    mat.opacityTexture = tex;
    mat.emissiveTexture = tex;
    mat.emissiveColor = BABYLON.Color3.White();
    mat.useAlphaFromDiffuseTexture = true;
  }
  mesh.material = mat;
  mesh.parent = worldRoot;
  mesh.isPickable = obj.metadata?.selectable !== false;
  if (obj.kind === "billboard" || obj.visual?.billboard) mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
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
  playSelectionSound();
  maybeEmitTapTrigger(selectedObjectId);
}

function isSelectableMesh(mesh) { return !!mesh?.metadata?.kind && mesh.isPickable !== false; }
function selectObjectAtClientPoint(clientX, clientY) {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return clearSelection();
  const rect=canvas.getBoundingClientRect();
  const pick=scene.pick(clientX-rect.left,clientY-rect.top,(mesh)=>isSelectableMesh(mesh));
  if (pick?.hit&&pick.pickedMesh) setSelection(pick.pickedMesh); else clearSelection();
}
function selectObjectInFront() {
  let pick=null;
  try{pick=scene.pickWithRay(camera.getForwardRay(250),(mesh)=>isSelectableMesh(mesh))}catch(_){}
  if(pick?.hit&&pick.pickedMesh){setSelection(pick.pickedMesh);setStatus(`Swipe selected ${selectedLabel}`);return pick.pickedMesh}
  clearSelection();setStatus("Swipe: nothing directly ahead");return null;
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
  const gestureOwnsTouch=!!(gestureLab&&gestureLab.isEnabled&&gestureLab.isEnabled());
  if(gestureOwnsTouch&&pi.event?.pointerType!=="mouse") return;
  const pick=scene.pick(scene.pointerX,scene.pointerY,(mesh)=>isSelectableMesh(mesh));
  if(pick&&pick.hit&&pick.pickedMesh)setSelection(pick.pickedMesh);else clearSelection();
});

function onGeo(lat, lon, coords) {
  rawLat = lat; rawLon = lon;
  if (sessionOriginPending && !isNumber(sessionOriginLat) && !isNumber(sessionOriginLon)) {
    calibrateSessionOrigin(lat, lon);
  }
  if (Number.isFinite(coords?.heading)) {
    lastGeoHeadingRad = normalizeAngleRad(-BABYLON.Angle.FromDegrees(coords.heading).radians());
    if (!motionEnabled) {
      localYawRad = lastGeoHeadingRad;
      camera.rotation.y = localYawRad;
    }
  }
  if (filtLat === null || filtLon === null) {
    filtLat = lat; filtLon = lon;
  } else {
    filtLat = filtLat + (lat - filtLat) * GPS_ALPHA;
    filtLon = filtLon + (lon - filtLon) * GPS_ALPHA;
  }
  emitTelemetry("gps", {
    accuracy: coords?.accuracy,
    heading: coords?.heading,
    speed: coords?.speed,
    sessionOrigin: isNumber(sessionOriginLat) && isNumber(sessionOriginLon) ? { lat: sessionOriginLat, lon: sessionOriginLon } : null,
    sessionOriginPending
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
  if (!rel) {
    if (sessionOriginPending) updateAnchorSummary();
    return;
  }
  const now = Date.now();
  if (lastSentRelX === null || lastSentRelZ === null) {
    lastSentRelX = rel.x; lastSentRelZ = rel.z; lastSentAt = now; sendGpsNow(); return;
  }
  if (now - lastSentAt < SEND_MIN_MS) return;
  const moved = Math.hypot(rel.x - lastSentRelX, rel.z - lastSentRelZ);
  const heartbeat = now - lastSentAt >= 1200;
  if (!heartbeat && moved < DEAD_BAND_M) return;
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

function updateLocalPlayerPointer() {
  const ptr = playerPointers[socket.id];
  const me = currentRel();
  if (!ptr || !me) return;
  ptr.setEnabled(true);
  ptr.position.set(me.x, PLAYER_POINTER_Y, me.z);
  ptr.rotation.y = getCameraYawRad() - worldRoot.rotation.y;
  ptr.metadata = { kind: "playerPointer", socketId: socket.id, rel: { x: me.x, z: me.z } };
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
    if (id === socket.id) ptr.rotation.y = getCameraYawRad() - worldRoot.rotation.y;
    else if (isNumber(c.yaw)) ptr.rotation.y = c.yaw - worldRoot.rotation.y;
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

    const actorSpace = obj.metadata?.space === "actor";
    if (actorSpace) {
      const actorId = String(obj.metadata?.actorId || "");
      const actor = clients[actorId];
      if (!actor || actor.anchorKey !== anchorKey || !isNumber(actor.relX) || !isNumber(actor.relZ)) {
        mesh.setEnabled(false);
        continue;
      }
      const att = obj.metadata?.attachment || {};
      const off = att.offset || {};
      let x = actor.relX + Number(off.x || 0);
      let z = actor.relZ + Number(off.z || 0);
      let y = Number(off.y ?? 2.8);

      // A charm attached to *this* phone would otherwise be directly above the
      // camera and mostly invisible. For self-view, place it a few meters in
      // front while keeping it logically actor-bound.
      if (actorId === socket.id && Number.isFinite(Number(att.selfForward))) {
        const yaw = getCameraYawRad() - worldRoot.rotation.y;
        const f = Number(att.selfForward);
        x += Math.sin(yaw) * f;
        z += Math.cos(yaw) * f;
        y = camera.position.y + Number(att.selfUp ?? 0.25);
      }
      mesh.position.set(x, y, z);
      mesh.metadata = { kind:"worldObject", objectId:obj.id, rel:{x:actor.relX,z:actor.relZ}, actorId };
    } else {
      mesh.position.set(obj.position?.x || 0, (obj.position?.y || 0) + (obj.subtype === "droppedCube" ? DROPPED_CUBE_Y : 0), obj.position?.z || 0);
      mesh.metadata = { kind:"worldObject", objectId:obj.id, rel:{x:obj.position?.x || 0,z:obj.position?.z || 0} };
    }
    mesh.rotation.set(obj.rotation?.x || 0, obj.rotation?.y || 0, obj.rotation?.z || 0);
    mesh.scaling.set(obj.scale?.x || 1, obj.scale?.y || 1, obj.scale?.z || 1);
    mesh.metadata.baseScale = { x: obj.scale?.x || 1, y: obj.scale?.y || 1, z: obj.scale?.z || 1 };
    mesh.metadata.pulse = !!obj.metadata?.pulse;
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

function updateLocalFollow() {
  if (!followMe) return;
  const meLocal = currentRel();
  if (meLocal && isNumber(meLocal.x) && isNumber(meLocal.z)) {
    worldRoot.position.x = -meLocal.x;
    worldRoot.position.z = -meLocal.z;
    return;
  }
  const me = lastWorldState?.clients?.[socket.id];
  if (me && me.anchorKey === anchorKey && isNumber(me.relX) && isNumber(me.relZ)) {
    worldRoot.position.x = -me.relX;
    worldRoot.position.z = -me.relZ;
  }
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
  setStatus(sessionOriginPending ? "Connected | Waiting for GPS calibration" : "Connected");
  emitTelemetry("connect", { id: socket.id });
  sendGpsNow();
});

socket.on("worldState", (state) => {
  reconcileWorld(state);
  emitTelemetry("state", { users: Object.keys(state.clients || {}).length, objects: (state.worldObjects || []).length });
});

engine.runRenderLoop(() => {
  applyHeadingStabilization();
  updateLocalFollow();
  updateLocalPlayerPointer();
  maybeSendOrientationUpdate();
  updateLocalHorizon();
  updateSymbolicCalibration();
  // Cheap client-side charm animation: one server object, no animation traffic.
  const pulse = 1 + Math.sin(performance.now() * 0.004) * 0.045;
  for (const mesh of Object.values(objectMeshes)) {
    if (!mesh?.metadata?.pulse || !mesh.metadata.baseScale) continue;
    const b = mesh.metadata.baseScale;
    mesh.scaling.set(b.x * pulse, b.y * pulse, b.z * pulse);
  }
  updateSelectionHUD();
  scene.render();
});
window.addEventListener("resize", () => engine.resize());
window.__scene = scene;
