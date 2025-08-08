import { createEngine } from './core/engine.js';
import { createScene } from './core/scene.js';
import { createFollowCamera } from './core/camera.js';
import { createGround } from './world/ground.js';
import { createBox } from './world/box.js';

// ===== CONFIG / PROJECTION =====
const SCALE = 100; // world units per degree (simple equirectangular). Tune as needed.
function latLonToWorld(lat, lon) { return { x: lon * SCALE, y: 0, z: -lat * SCALE }; }
function worldToLatLon(x, z) { return { lon: x / SCALE, lat: -z / SCALE }; }

// ===== SOCKET =====
const socket = io();

// ===== BABYLON SETUP =====
const canvas = document.getElementById('renderCanvas');
const engine = createEngine(canvas);
const scene  = createScene(engine);
const camera = createFollowCamera(scene, canvas);
createGround(scene);

// Local player mesh
const playerMesh = createBox(scene, { name: 'playerCube', color: 'purple', size: 1.5 });

// Map of other clients
const otherClients = new Map(); // id -> mesh

// Ground-click → drop a block
scene.onPointerObservable.add((pointerInfo) => {
  if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
  const pick = scene.pick(scene.pointerX, scene.pointerY);
  if (!pick?.pickedPoint) return;
  const { lon, lat } = worldToLatLon(pick.pickedPoint.x, pick.pickedPoint.z);
  socket.emit('dropCube', { lat, lon });
});

// ===== GEOLOCATION =====
(async function ensurePermissions(){
  try { 
    if (navigator.permissions) { 
      const st = await navigator.permissions.query({ name: 'geolocation' }); 
      if (st.state === 'denied') alert('Location permission denied. Enable it to proceed.');
    }
  } catch {}
})();

navigator.geolocation.watchPosition(
  (pos) => {
    const { latitude: lat, longitude: lon } = pos.coords;
    const p = latLonToWorld(lat, lon);
    playerMesh.position.set(p.x, p.y, p.z);

    // Camera follow
    camera.lockedTarget = playerMesh;

    // Network
    socket.emit('gpsUpdate', { lat, lon });
  },
  (err) => console.warn('GPS error', err),
  { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
);

// ===== SOCKET EVENTS =====
socket.on('updateClientPosition', ({ id, lat, lon }) => {
  let mesh = otherClients.get(id);
  if (!mesh) {
    mesh = createBox(scene, { name: `client_${id.slice(0,4)}`, color: 'cyan', size: 1.2 });
    otherClients.set(id, mesh);
  }
  const p = latLonToWorld(lat, lon);
  mesh.position.set(p.x, p.y, p.z);
});

socket.on('removeClient', (id) => {
  const mesh = otherClients.get(id);
  if (mesh) { mesh.dispose(); otherClients.delete(id); }
});

socket.on('clientListUpdate', (clients) => {
  const el = document.getElementById('clientList');
  el.textContent = JSON.stringify(clients, null, 2);
});

socket.on('initialBlocks', (blocks) => {
  blocks?.forEach(({lat, lon}) => {
    const p = latLonToWorld(lat, lon);
    const b = createBox(scene, { name:`block_${lat.toFixed(3)}_${lon.toFixed(3)}`, color:'green', size:1 });
    b.position.set(p.x, p.y, p.z);
  });
});
socket.on('createBlock', ({ lat, lon }) => {
  const p = latLonToWorld(lat, lon);
  const b = createBox(scene, { name:`block_${lat.toFixed(3)}_${lon.toFixed(3)}`, color:'green', size:1 });
  b.position.set(p.x, p.y, p.z);
});

// ===== RENDER LOOP =====
engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
