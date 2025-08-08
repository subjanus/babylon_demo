// ===== CONFIG / PROJECTION =====
const SCALE = 100; // world units per degree (simple equirectangular). Tune as needed.
function latLonToWorld(lat, lon) { return { x: lon * SCALE, y: 0, z: -lat * SCALE }; }

// ===== SOCKET =====
const socket = io();
window.socket = socket;

// ===== BABYLON SETUP =====
const canvas = document.getElementById('renderCanvas');
const { engine, scene } = createScene(canvas);
window.scene = scene;

const camera = initCamera(scene);
window.camera = camera;

// Local player mesh
const playerMesh = initBox(scene, { name: 'playerCube', color: 'purple', size: 1.5 });
window.playerMesh = playerMesh;

// Map of other clients
const otherClients = new Map(); // id -> mesh

// Ground-click → drop a block (kept from your previous behavior)
scene.onPointerObservable.add((pointerInfo) => {
  if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
  const pick = scene.pick(scene.pointerX, scene.pointerY);
  if (!pick?.pickedPoint) return;
  // Convert world X/Z back to lat/lon approximation (inverse of our simple projection)
  const lon = pick.pickedPoint.x / SCALE;
  const lat = -pick.pickedPoint.z / SCALE;
  socket.emit('dropCube', { lat, lon });
});

// Debug markers: projected vs actual mesh pos (green vs red)
const dbg = (() => {
  const projMat = new BABYLON.StandardMaterial("projMat", scene);
  projMat.emissiveColor = new BABYLON.Color3(0, 1, 0);
  const meshMat = new BABYLON.StandardMaterial("meshMat", scene);
  meshMat.emissiveColor = new BABYLON.Color3(1, 0, 0);
  const projDot = BABYLON.MeshBuilder.CreateSphere("projDot", { diameter: 0.6 }, scene);
  projDot.material = projMat;
  const meshDot = BABYLON.MeshBuilder.CreateSphere("meshDot", { diameter: 0.6 }, scene);
  meshDot.material = meshMat;
  return { projDot, meshDot };
})();

// ===== DRIFT DIAGNOSTICS HUD + CSV LOGGER =====
class DataLogger {
  constructor({ projectFn, getMeshFn, socket, deviceLabel }) {
    this.rows = [];
    this.projectFn = projectFn;
    this.getMeshFn = getMeshFn;
    this.socket = socket;
    this.device = deviceLabel || (/(iPhone|iPad|iPod)/i.test(navigator.userAgent) ? "iphone" : "laptop");
    this._buildHUD();
  }
  _buildHUD() {
    const hud = document.createElement('div');
    hud.id = 'debugHUD';
    hud.style.cssText = `
      position:fixed; left:10px; bottom:10px; z-index:9999;
      background:rgba(0,0,0,.7); color:#fff; font:12px/1.3 ui-monospace,Menlo,Consolas,monospace;
      padding:10px; border-radius:8px; max-width:360px; white-space:nowrap; backdrop-filter: blur(2px);
    `;
    hud.innerHTML = `
      <div style="margin-bottom:4px;"><b>Drift Diagnostics</b></div>
      <div><b>Device:</b> <span id="dhDev">-</span></div>
      <div><b>GPS:</b> lat=<span id="dhLat">-</span>, lon=<span id="dhLon">-</span>, acc=<span id="dhAcc">-</span>m</div>
      <div><b>World (proj):</b> x=<span id="dhPX">-</span> y=<span id="dhPY">-</span> z=<span id="dhPZ">-</span></div>
      <div><b>Mesh:</b> x=<span id="dhMX">-</span> y=<span id="dhMY">-</span> z=<span id="dhMZ">-</span></div>
      <div><b>Δ (mesh−proj):</b> dx=<span id="dhDX">-</span> dy=<span id="dhDY">-</span> dz=<span id="dhDZ">-</span></div>
      <div style="margin-top:6px; display:flex; gap:6px;">
        <button id="dbgStart">Start Log</button>
        <button id="dbgStop" disabled>Stop</button>
        <button id="dbgExport" disabled>Export CSV</button>
      </div>`;
    document.body.appendChild(hud);
    this.ui = {
      dev: hud.querySelector('#dhDev'),
      lat: hud.querySelector('#dhLat'),
      lon: hud.querySelector('#dhLon'),
      acc: hud.querySelector('#dhAcc'),
      px: hud.querySelector('#dhPX'),
      py: hud.querySelector('#dhPY'),
      pz: hud.querySelector('#dhPZ'),
      mx: hud.querySelector('#dhMX'),
      my: hud.querySelector('#dhMY'),
      mz: hud.querySelector('#dhMZ'),
      dx: hud.querySelector('#dhDX'),
      dy: hud.querySelector('#dhDY'),
      dz: hud.querySelector('#dhDZ'),
      start: hud.querySelector('#dbgStart'),
      stop: hud.querySelector('#dbgStop'),
      export: hud.querySelector('#dbgExport'),
    };
    this.ui.dev.textContent = this.device;
    this.ui.start.onclick = () => this._start();
    this.ui.stop.onclick = () => this._stop();
    this.ui.export.onclick = () => this._export();
  }
  _start(){ this.rows = []; this._logging = true; this.ui.start.disabled = true; this.ui.stop.disabled = false; this.ui.export.disabled = true; }
  _stop(){ this._logging = false; this.ui.start.disabled = false; this.ui.stop.disabled = true; this.ui.export.disabled = this.rows.length === 0; }
  _export(){
    const header = ["timestamp","device","lat","lon","accuracy_m","proj_x","proj_y","proj_z","mesh_x","mesh_y","mesh_z","dx","dy","dz"];
    const csv = [header.join(",")]
      .concat(this.rows.map(r => header.map(k => r[k]).join(","))).join("\n");
    const blob = new Blob([csv], {type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gps_drift_${this.device}_${Date.now()}.csv`;
    a.click();
  }
  logSample({lat, lon, accuracy}){
    const proj = this.projectFn(lat, lon);
    const mesh = this.getMeshFn()?.position ?? {x:NaN,y:NaN,z:NaN};
    const dx = (mesh.x - proj.x), dy = (mesh.y - proj.y), dz = (mesh.z - proj.z);

    // Move debug markers
    dbg.projDot.position.set(proj.x, proj.y ?? 0, proj.z);
    dbg.meshDot.position.copyFrom(mesh);

    // HUD
    this.ui.lat.textContent = lat?.toFixed(6);
    this.ui.lon.textContent = lon?.toFixed(6);
    this.ui.acc.textContent = (accuracy ?? "").toString();
    this.ui.px.textContent = proj.x?.toFixed(2);
    this.ui.py.textContent = (proj.y ?? 0).toFixed(2);
    this.ui.pz.textContent = proj.z?.toFixed(2);
    this.ui.mx.textContent = mesh.x?.toFixed(2);
    this.ui.my.textContent = mesh.y?.toFixed(2);
    this.ui.mz.textContent = mesh.z?.toFixed(2);
    this.ui.dx.textContent = dx?.toFixed(2);
    this.ui.dy.textContent = dy?.toFixed(2);
    this.ui.dz.textContent = dz?.toFixed(2);

    // Buffer sample
    if (this._logging) {
      this.rows.push({
        timestamp: new Date().toISOString(),
        device: this.device, lat, lon, accuracy_m: accuracy ?? "",
        proj_x: proj.x, proj_y: proj.y ?? 0, proj_z: proj.z,
        mesh_x: mesh.x, mesh_y: mesh.y, mesh_z: mesh.z,
        dx, dy, dz
      });
    }

    // Send to server for cross-device diagnostics
    this.socket?.emit("diagSample", {
      t: Date.now(), device: this.device, lat, lon, accuracy,
      proj, mesh: { x: mesh.x, y: mesh.y, z: mesh.z }
    });
  }
}

// ===== INIT LOGGER =====
const deviceLabel = new URLSearchParams(location.search).get('device') || undefined;
const logger = new DataLogger({
  projectFn: latLonToWorld,
  getMeshFn: () => playerMesh,
  socket,
  deviceLabel
});

// ===== GEOLOCATION =====
requestGeoPermissions().then(() => {
  navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lon, accuracy } = pos.coords;

      // Update local mesh
      const p = latLonToWorld(lat, lon);
      playerMesh.position.set(p.x, p.y, p.z);

      // Camera follows player
      if (camera && camera.lockedTarget !== playerMesh) camera.lockedTarget = playerMesh;

      // Network + diagnostics
      socket.emit('gpsUpdate', { lat, lon });
      logger.logSample({ lat, lon, accuracy });
    },
    (err) => console.warn("GPS error", err),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
});

// ===== SOCKET EVENTS =====
socket.on('updateClientPosition', ({ id, lat, lon }) => {
  let mesh = otherClients.get(id);
  if (!mesh) {
    mesh = initBox(scene, { name: `client_${id.slice(0,4)}`, color: 'cyan', size: 1.2 });
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

// Existing blocks + new blocks
socket.on('initialBlocks', (blocks) => {
  blocks?.forEach(({lat, lon}) => {
    const p = latLonToWorld(lat, lon);
    const b = initBox(scene, { name:`block_${lat.toFixed(3)}_${lon.toFixed(3)}`, color:'green', size:1 });
    b.position.set(p.x, p.y, p.z);
  });
});
socket.on('createBlock', ({ lat, lon }) => {
  const p = latLonToWorld(lat, lon);
  const b = initBox(scene, { name:`block_${lat.toFixed(3)}_${lon.toFixed(3)}`, color:'green', size:1 });
  b.position.set(p.x, p.y, p.z);
});

// Diagnostics broadcast from server (pairwise deltas)
socket.on('diagnostics', (d) => {
  console.log(`[DIAG] ${new Date(d.ts).toLocaleTimeString()} ${d.pair.join(' vs ')} | `
    + `GPS dLat=${d.gps.dLat?.toFixed(6)} dLon=${d.gps.dLon?.toFixed(6)} | `
    + `PROJ d=(${d.proj.dPX?.toFixed(2)},${d.proj.dPY?.toFixed(2)},${d.proj.dPZ?.toFixed(2)}) | `
    + `MESH d=(${d.mesh.dMX?.toFixed(2)},${d.mesh.dMY?.toFixed(2)},${d.mesh.dMZ?.toFixed(2)})`);
});

// ===== RENDER LOOP =====
engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
