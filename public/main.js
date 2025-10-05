import { initScene } from './scene.js';

const sessionId = new Date().toISOString();
const socket = io({ query: { role: 'client' } });

const peersEl = document.getElementById('peers');
const sessionEl = document.getElementById('session');
sessionEl.textContent = 'session ' + sessionId;

const canvas = document.getElementById('canvas');
const out = document.getElementById('out');
const code = document.getElementById('code');

function println(s){ out.textContent += s + "\n"; out.scrollTop = out.scrollHeight; }

const { scene, engine, api } = initScene(canvas, println);
const myName = 'client-' + Math.random().toString(36).slice(2,7);

socket.emit('client:hello', { name: myName, sessionId });
socket.emit('request:peers');

const peers = new Map();
let origin = null;

function gpsToLocal(gps) {
  if (!origin) return { x: 0, z: 0 };
  const R = 6371000;
  const dLat = (gps.lat - origin.lat) * Math.PI/180;
  const dLon = (gps.lon - origin.lon) * Math.PI/180;
  const x = dLon * Math.cos((gps.lat+origin.lat)*Math.PI/360) * R;
  const z = dLat * R;
  return { x, z };
}

function updatePeerList() {
  peersEl.innerHTML = '';
  peers.forEach((p, id) => {
    const div = document.createElement('div');
    const gpsTxt = p.gps ? `${p.gps.lat?.toFixed(5)}, ${p.gps.lon?.toFixed(5)} ±${(p.gps.acc||0).toFixed(0)}m` : '—';
    div.textContent = `${id.slice(0,6)} gps: ${gpsTxt}`;
    peersEl.appendChild(div);
  });
}

socket.on('server:peers', (arr) => {
  arr.forEach((info) => {
    if (info.id === socket.id) return;
    if (!peers.has(info.id)) {
      peers.set(info.id, { id: info.id, name: info.name, gps: info.gps, orient: info.orient, mesh: api.spawnPeer(info.id) });
    } else {
      const p = peers.get(info.id);
      p.gps = info.gps || p.gps;
      p.orient = info.orient || p.orient;
    }
  });
  updatePeerList();
});

socket.on('peer:join', ({ id }) => {
  if (id === socket.id) return;
  if (!peers.has(id)) {
    peers.set(id, { id, mesh: api.spawnPeer(id) });
    updatePeerList();
  }
});

socket.on('peer:leave', ({ id }) => {
  const p = peers.get(id);
  if (p) {
    api.despawnPeer(id);
    peers.delete(id);
    updatePeerList();
  }
});

socket.on('peer:update', ({ id, gps, orient }) => {
  const p = peers.get(id); if (!p) return;
  if (gps) p.gps = gps;
  if (orient) p.orient = orient;
  if (p.mesh && p.gps) {
    if (!origin) origin = p.gps;
    const { x, z } = gpsToLocal(p.gps);
    api.movePeer(id, x, z);
  }
  updatePeerList();
});

socket.on('shape:spawn', ({ id, kind, pos, color }) => {
  api.spawnShape(id, kind, pos, color || [0.8,0.6,0.2]);
});

let geoWatchId = null, orientOn = true;
function startGPS(){
  if (!('geolocation' in navigator)) { println('Geolocation not supported'); return; }
  if (geoWatchId !== null) return;
  geoWatchId = navigator.geolocation.watchPosition((pos)=>{
    const { latitude:lat, longitude:lon, accuracy:acc } = pos.coords;
    socket.emit('client:update', { gps: {lat, lon, acc} });
  }, (err)=>{ println('GPS error: ' + err.message); }, { enableHighAccuracy:true, maximumAge:1000, timeout:5000 });
  println('GPS started');
}
function stopGPS(){ if (geoWatchId !== null){ navigator.geolocation.clearWatch(geoWatchId); geoWatchId=null; println('GPS stopped'); } }
function onOrient(ev){ if (!orientOn) return; socket.emit('client:update', { orient: { alpha: ev.alpha, beta: ev.beta, gamma: ev.gamma } }); }
addEventListener('deviceorientation', onOrient, true);

document.getElementById('btnCamera').onclick = () => api.toggleCamera();
document.getElementById('btnGeo').onclick = () => { if (geoWatchId===null) startGPS(); else stopGPS(); };
document.getElementById('btnOrient').onclick = () => { orientOn = !orientOn; println('Orientation ' + (orientOn?'On':'Off')); };
document.getElementById('btnTest').onclick = () => {
  const id = 'box-' + Math.random().toString(36).slice(2,8);
  api.spawnShape(id, 'box', [Math.random()*2-1, 0.5, Math.random()*2-1], [0.3,0.8,1]);
  socket.emit('shape:spawn', { id, kind:'box', pos:[0,0.5,0], color:[0.3,0.8,1] });
};

// ---------- Pyodide console ----------
const worker = new Worker('./py_worker.js', { type: 'module' });
worker.onerror = (e) => println('[worker error] ' + e.message);
worker.onmessageerror = (e) => println('[worker msg error]'); // classic worker so importScripts works
let consoleReady = false;

worker.onmessage = (e) => {
  const { type, data } = e.data || {};
  if (type === 'ready'){ consoleReady = true; println('[py] ready'); }
  if (type === 'stdout'){ println(data); }
  if (type === 'stderr'){ println('[err] ' + data); }
  if (type === 'spawn'){
    const { id, kind='box', pos=[0,0.5,0], color=[0.3,0.8,1] } = data;
    api.spawnShape(id, kind, pos, color);
    socket.emit('shape:spawn', { id, kind, pos, color });
  }
};

function runCodeSnippet(snippet){
  if (!consoleReady){ println('Pyodide not ready'); return; }
  worker.postMessage({ type:'exec', code: snippet });
}

code.addEventListener('keydown', (e)=>{
  if (e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    const snippet = code.value.trim();
    if (snippet) runCodeSnippet(snippet);
    code.value = '';
  }
});

startGPS();