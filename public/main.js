import { createEngine } from './core/engine.js';
import { createScene } from './core/scene.js';
import { createFollowCamera } from './core/camera.js';
import { createGround } from './world/ground.js';
import { createBox } from './world/box.js';
import { latLonToWorld } from './geo/projection.js';
import { createSocket } from './net/socketClient.js';
import { Events } from './net/messages.js';
import { createClientListHUD } from './ui/hud.js';
import { createDiagnostics } from './ui/diagnostics.js';
import { enableGroundClick } from './ui/input.js';

// ===== Engine/Scene/Camera =====
const canvas = document.getElementById('renderCanvas');
const engine = createEngine(canvas);
const scene  = createScene(engine);
const camera = createFollowCamera(scene, canvas);
createGround(scene);

// ===== World Entities =====
const playerMesh = createBox(scene, { name: 'playerCube', color: 'purple', size: 1.5 });
const otherClients = new Map(); // id -> mesh

// ===== Networking =====
const socket = createSocket({ on: {
  [Events.updateClientPosition]: ({ id, lat, lon }) => {
    let mesh = otherClients.get(id);
    if (!mesh) {
      mesh = createBox(scene, { name: `client_${id.slice(0,4)}`, color: 'cyan', size: 1.2 });
      otherClients.set(id, mesh);
    }
    const p = latLonToWorld({ lat, lon });
    mesh.position.set(p.x, p.y, p.z);
  },
  [Events.removeClient]: (id) => {
    const mesh = otherClients.get(id);
    if (mesh) { mesh.dispose(); otherClients.delete(id); }
  },
  [Events.clientListUpdate]: (clients) => clientHUD.set(clients),
  [Events.initialBlocks]: (blocks) => {
    blocks?.forEach(({lat, lon}) => {
      const p = latLonToWorld({ lat, lon });
      const b = createBox(scene, { name:`block_${lat.toFixed(3)}_${lon.toFixed(3)}`, color:'green', size:1 });
      b.position.set(p.x, p.y, p.z);
    });
  },
  [Events.createBlock]: ({ lat, lon }) => {
    const p = latLonToWorld({ lat, lon });
    const b = createBox(scene, { name:`block_${lat.toFixed(3)}_${lon.toFixed(3)}`, color:'green', size:1 });
    b.position.set(p.x, p.y, p.z);
  }
}});

// ===== HUD =====
const clientHUD = createClientListHUD();

// ===== Debug Diagnostics (opt-in via ?debug=1) =====
const diagnostics = createDiagnostics(scene, {
  projectFn: (lat, lon) => latLonToWorld({ lat, lon }),
  getMesh: () => playerMesh
});

// ===== Interaction: click to drop =====
enableGroundClick(scene, { onDrop: ({ lat, lon }) => socket.emitDrop({ lat, lon }) });

// ===== Geolocation =====
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
    const p = latLonToWorld({ lat, lon });
    playerMesh.position.set(p.x, p.y, p.z);

    // Follow target
    camera.lockedTarget = playerMesh;

    // Network broadcast
    socket.emitGps({ lat, lon });

    // Diagnostics
    diagnostics.log?.({ lat, lon });
  },
  (err) => console.warn('GPS error', err),
  { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
);

// ===== Render loop =====
engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
