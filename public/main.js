import { initScene } from './initScene.js';
import { initCamera } from './initCamera.js';
import { requestDevicePermissions } from './requestPermissions.js';
import { initBox } from './initBox.js';
import { latLonToLocal } from './geo.js';

const canvas = document.getElementById('renderCanvas');
const statusEl = document.getElementById('status');

const { engine, scene } = initScene(canvas);
const camera = initCamera(scene, canvas);
const worldRoot = new BABYLON.TransformNode('worldRoot', scene);
const socket = io({
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  auth: { role: 'player', label: 'field-client' }
});

const state = {
  myId: null,
  followMe: true,
  worldState: null,
  rawLat: null,
  rawLon: null,
  filtLat: null,
  filtLon: null,
  lastSentAt: 0,
  lastSentPos: null,
  anchor: loadAnchor(),
  selectedObjectId: null,
  lastTriggerAt: 0
};

const SEND_MIN_MS = 350;
const POS_DEADBAND_M = 1.5;
const GPS_ALPHA = 0.12;

const peerMeshes = {};
const objectMeshes = {};

function isNumber(n) { return typeof n === 'number' && Number.isFinite(n); }
function shortId(id) { return id ? `${String(id).slice(0, 4)}…${String(id).slice(-3)}` : 'none'; }
function dist2(a, b) { return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.z || 0) - (b?.z || 0)); }
function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
  if (ui.status) ui.status.text = text;
}

function loadAnchor() {
  try {
    const raw = localStorage.getItem('gpsGame.privateAnchor');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (isNumber(parsed?.lat) && isNumber(parsed?.lon)) return parsed;
  } catch (_err) {}
  return null;
}

function saveAnchor(anchor) {
  state.anchor = anchor;
  localStorage.setItem('gpsGame.privateAnchor', JSON.stringify(anchor));
  renderAnchorSummary();
}

function ensureAnchor() {
  if (state.anchor) return true;
  const lat = Number(window.prompt('Private anchor latitude (stays on this device):', '36.0014'));
  const lon = Number(window.prompt('Private anchor longitude (stays on this device):', '-78.9382'));
  if (!isNumber(lat) || !isNumber(lon)) return false;
  saveAnchor({ lat, lon, mode: 'manual' });
  return true;
}

function maybeAutoAnchor(lat, lon) {
  if (state.anchor) return;
  saveAnchor({ lat, lon, mode: 'auto-first-fix' });
}

function geoToLocal(lat, lon) {
  if (!state.anchor) return { x: 0, z: 0 };
  return latLonToLocal(lat, lon, state.anchor.lat, state.anchor.lon);
}

function currentLocalPosition() {
  if (isNumber(state.filtLat) && isNumber(state.filtLon)) return geoToLocal(state.filtLat, state.filtLon);
  return null;
}

function renderAnchorSummary() {
  const a = state.anchor;
  const text = a ? `Anchor: ${a.mode || 'manual'} @ ${a.lat.toFixed(5)}, ${a.lon.toFixed(5)} (private)` : 'Anchor: not set';
  if (ui.anchor) ui.anchor.text = text;
}

function emitPosition() {
  const pos = currentLocalPosition();
  if (!pos) return;
  const now = Date.now();
  if (state.lastSentPos && now - state.lastSentAt < SEND_MIN_MS && dist2(pos, state.lastSentPos) < POS_DEADBAND_M) return;

  state.lastSentAt = now;
  state.lastSentPos = { ...pos };
  socket.emit('positionUpdate', {
    x: pos.x,
    y: -5,
    z: pos.z,
    yaw: getCameraYawRad(),
    source: 'private_anchor_projection'
  });
}

function emitTelemetry(kind, extra = {}) {
  socket.emit('telemetry', {
    kind,
    anchorMode: state.anchor?.mode || null,
    localPos: currentLocalPosition(),
    extra
  });
}

function getCameraYawRad() {
  const q = camera.rotationQuaternion;
  if (!q) return camera.rotation?.y || 0;
  const ysqr = q.y * q.y;
  const t3 = 2.0 * (q.w * q.y + q.x * q.z);
  const t4 = 1.0 - 2.0 * (ysqr + q.z * q.z);
  return Math.atan2(t3, t4);
}

const ui = createDrawerUI();
renderAnchorSummary();

function createDrawerUI() {
  const out = { status: null, anchor: null, selected: null, counts: null, triggerLog: null };
  if (!BABYLON.GUI) return out;

  const adt = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('ui', true, scene);
  const toggle = BABYLON.GUI.Button.CreateSimpleButton('toggle', '☰');
  toggle.width = '44px';
  toggle.height = '44px';
  toggle.color = '#e6edf3';
  toggle.background = '#111827';
  toggle.cornerRadius = 12;
  toggle.thickness = 1;
  toggle.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  toggle.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
  toggle.left = '10px';
  toggle.top = '10px';
  adt.addControl(toggle);

  const drawer = new BABYLON.GUI.Rectangle('drawer');
  drawer.width = '360px';
  drawer.height = '470px';
  drawer.cornerRadius = 16;
  drawer.color = '#374151';
  drawer.background = '#0d1117';
  drawer.thickness = 1;
  drawer.alpha = 0.95;
  drawer.isVisible = false;
  drawer.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
  drawer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
  drawer.left = '-10px';
  drawer.top = '10px';
  adt.addControl(drawer);

  const stack = new BABYLON.GUI.StackPanel();
  stack.paddingTop = '10px';
  stack.paddingLeft = '12px';
  stack.paddingRight = '12px';
  drawer.addControl(stack);

  function text(name, value, height = '36px', color = '#e6edf3') {
    const tb = new BABYLON.GUI.TextBlock(name, value);
    tb.height = height;
    tb.color = color;
    tb.fontSize = 12;
    tb.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    tb.textWrapping = true;
    stack.addControl(tb);
    return tb;
  }

  function button(name, label, handler) {
    const b = BABYLON.GUI.Button.CreateSimpleButton(name, label);
    b.width = '100%';
    b.height = '40px';
    b.color = '#e6edf3';
    b.background = '#111827';
    b.cornerRadius = 12;
    b.thickness = 1;
    b.paddingTop = '6px';
    b.onPointerUpObservable.add(() => handler(b));
    stack.addControl(b);
    return b;
  }

  text('title', 'Field Kit', '28px');
  out.status = text('status', 'Connecting…');
  out.anchor = text('anchor', 'Anchor: not set', '48px', '#cbd5e1');
  out.counts = text('counts', 'Peers: 0 | Objects: 0', '26px', '#cbd5e1');
  out.selected = text('selected', 'Selected: none', '40px', '#cbd5e1');
  out.triggerLog = text('trigger', 'Last trigger: none', '60px', '#94a3b8');

  button('btnAnchor', 'Set Private Anchor', () => ensureAnchor());
  button('btnPerm', 'Enable Motion', async (b) => {
    const ok = await requestDevicePermissions();
    b.textBlock.text = ok ? 'Motion Enabled' : 'Motion Blocked';
  });
  button('btnColor', 'Toggle Color', () => socket.emit('toggleColor'));
  button('btnDrop', 'Drop Cube', () => {
    const pos = currentLocalPosition();
    if (!pos) return;
    socket.emit('dropCube', { x: pos.x, z: pos.z });
  });
  button('btnBeacon', 'Create Trigger Beacon', () => {
    const pos = currentLocalPosition();
    if (!pos) return;
    socket.emit('createObject', {
      kind: 'sphere',
      color: '#22D3EE',
      position: { x: pos.x + 4, y: 1, z: pos.z },
      scale: { x: 1.8, y: 1.8, z: 1.8 },
      label: 'Beacon',
      trigger: { id: 'beacon.ping', mode: 'tap' },
      props: { note: 'server-driven trigger object' }
    });
  });
  button('btnFollow', 'Follow: On', (b) => {
    state.followMe = !state.followMe;
    b.textBlock.text = state.followMe ? 'Follow: On' : 'Follow: Off';
    if (!state.followMe) {
      worldRoot.position.x = 0;
      worldRoot.position.z = 0;
    }
  });

  toggle.onPointerUpObservable.add(() => { drawer.isVisible = !drawer.isVisible; });
  return out;
}

function ensurePeerMesh(id, color) {
  if (peerMeshes[id]) return peerMeshes[id];
  const mesh = BABYLON.MeshBuilder.CreateCylinder(`peer_${id}`, {
    diameterTop: 0,
    diameterBottom: 0.9,
    height: 1.6,
    tessellation: 4
  }, scene);
  const mat = new BABYLON.StandardMaterial(`peerMat_${id}`, scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(color || '#FFCC00');
  mat.specularColor = BABYLON.Color3.Black();
  mesh.material = mat;
  mesh.parent = worldRoot;
  mesh.rotation.x = Math.PI / 2;
  mesh.isPickable = true;
  peerMeshes[id] = mesh;
  return mesh;
}

function createMeshForObject(obj) {
  let mesh;
  switch (obj.kind) {
    case 'sphere':
      mesh = BABYLON.MeshBuilder.CreateSphere(`obj_${obj.id}`, { diameter: 2 }, scene);
      break;
    case 'plane':
    case 'billboard':
      mesh = BABYLON.MeshBuilder.CreatePlane(`obj_${obj.id}`, { size: 3 }, scene);
      break;
    case 'box':
    default:
      mesh = initBox(scene, obj.color || '#ffffff');
      mesh.name = `obj_${obj.id}`;
      break;
  }
  mesh.parent = worldRoot;
  mesh.isPickable = true;
  objectMeshes[obj.id] = mesh;
  return mesh;
}

function applyObjectStyle(mesh, obj) {
  if (!mesh.material) {
    const mat = new BABYLON.StandardMaterial(`mat_${obj.id}`, scene);
    mesh.material = mat;
  }
  if (mesh.material.diffuseColor) mesh.material.diffuseColor = BABYLON.Color3.FromHexString(obj.color || '#ffffff');
  if (obj.textureUrl) {
    mesh.material.diffuseTexture = new BABYLON.Texture(obj.textureUrl, scene, true, false);
  }
  mesh.billboardMode = obj.billboard || obj.kind === 'billboard' ? BABYLON.Mesh.BILLBOARDMODE_ALL : BABYLON.Mesh.BILLBOARDMODE_NONE;
}

function ensureObjectMesh(obj) {
  const mesh = objectMeshes[obj.id] || createMeshForObject(obj);
  applyObjectStyle(mesh, obj);
  mesh.position.set(obj.position?.x || 0, obj.position?.y || 0, obj.position?.z || 0);
  mesh.rotation.set(obj.rotation?.x || 0, obj.rotation?.y || 0, obj.rotation?.z || 0);
  mesh.scaling.set(obj.scale?.x || 1, obj.scale?.y || 1, obj.scale?.z || 1);
  mesh.metadata = { kind: 'worldObject', objectId: obj.id, label: obj.label, trigger: obj.trigger, props: obj.props };
  return mesh;
}

function reconcileWorld(worldState) {
  state.worldState = worldState;
  const peers = worldState?.peers || {};
  const worldObjects = worldState?.worldObjects || {};
  const peerIds = Object.keys(peers);
  const objectIds = Object.keys(worldObjects);

  if (ui.counts) ui.counts.text = `Peers: ${peerIds.length} | Objects: ${objectIds.length}`;

  for (const [id, peer] of Object.entries(peers)) {
    const mesh = ensurePeerMesh(id, peer.color);
    mesh.position.set(peer.x || 0, (peer.y || -5) + 1.6, peer.z || 0);
    mesh.rotation.y = peer.yaw || 0;
    mesh.metadata = { kind: 'peer', peerId: id, label: peer.label || peer.role || 'peer' };
  }
  for (const id of Object.keys(peerMeshes)) {
    if (!peers[id]) {
      peerMeshes[id].dispose();
      delete peerMeshes[id];
    }
  }

  for (const obj of Object.values(worldObjects)) ensureObjectMesh(obj);
  for (const id of Object.keys(objectMeshes)) {
    if (!worldObjects[id]) {
      objectMeshes[id].dispose();
      delete objectMeshes[id];
    }
  }

  const me = state.myId && peers[state.myId] ? peers[state.myId] : null;
  if (state.followMe && me) {
    worldRoot.position.x = -(me.x || 0);
    worldRoot.position.z = -(me.z || 0);
  }

  const lastTrigger = Array.isArray(worldState?.triggerLog) && worldState.triggerLog.length
    ? worldState.triggerLog[worldState.triggerLog.length - 1]
    : null;
  if (ui.triggerLog) {
    ui.triggerLog.text = lastTrigger
      ? `Last trigger: ${lastTrigger.triggerId || 'none'} from ${shortId(lastTrigger.sourcePeerId)} on object ${lastTrigger.objectId}`
      : 'Last trigger: none';
  }

  setStatus(`Connected (${shortId(state.myId)})`);
}

scene.onPointerObservable.add((info) => {
  if (info.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
  const pick = scene.pick(scene.pointerX, scene.pointerY);
  if (!pick?.hit || !pick.pickedMesh) {
    state.selectedObjectId = null;
    if (ui.selected) ui.selected.text = 'Selected: none';
    return;
  }

  const md = pick.pickedMesh.metadata || {};
  if (md.kind === 'worldObject' && md.objectId) {
    state.selectedObjectId = md.objectId;
    if (ui.selected) ui.selected.text = `Selected: ${md.label || md.objectId}`;
    const now = Date.now();
    if (now - state.lastTriggerAt > 800 && md.trigger) {
      state.lastTriggerAt = now;
      socket.emit('interactObject', { objectId: md.objectId, triggerId: md.trigger.id || null, payload: { action: 'tap' } });
    }
  } else if (md.kind === 'peer') {
    if (ui.selected) ui.selected.text = `Selected peer: ${md.label || shortId(md.peerId)}`;
  }
});

function onGeo(pos) {
  const lat = pos.coords.latitude;
  const lon = pos.coords.longitude;
  if (!isNumber(lat) || !isNumber(lon)) return;

  state.rawLat = lat;
  state.rawLon = lon;
  maybeAutoAnchor(lat, lon);

  if (state.filtLat === null || state.filtLon === null) {
    state.filtLat = lat;
    state.filtLon = lon;
  } else {
    state.filtLat = state.filtLat + (lat - state.filtLat) * GPS_ALPHA;
    state.filtLon = state.filtLon + (lon - state.filtLon) * GPS_ALPHA;
  }

  emitPosition();
}

if ('geolocation' in navigator) {
  navigator.geolocation.watchPosition(onGeo, () => {}, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 20000
  });
}

socket.on('welcome', (msg) => {
  state.myId = msg?.id || null;
  setStatus(`Connected (${shortId(state.myId)})`);
});

socket.on('worldState', (worldState) => {
  reconcileWorld(worldState);
});

socket.on('triggerEvent', (event) => {
  if (ui.triggerLog) ui.triggerLog.text = `Last trigger: ${event.triggerId || 'none'} from ${shortId(event.sourcePeerId)} on object ${event.objectId}`;
});

socket.on('connect', () => {
  setStatus('Connected');
  emitTelemetry('connect');
  if (!state.anchor) ensureAnchor();
});

engine.runRenderLoop(() => {
  socket.emit('orientationUpdate', { yaw: getCameraYawRad() });
  scene.render();
});
window.addEventListener('resize', () => engine.resize());
