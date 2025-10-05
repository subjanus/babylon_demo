import { initScene } from './scene.js';

const canvas = document.getElementById('canvas');
const out = document.getElementById('out');
const code = document.getElementById('code');
function println(s){ out.textContent += s+"\n"; out.scrollTop=out.scrollHeight; }

const { api } = initScene(canvas, println);
const socket = io();

// Worker for Pyodide
const worker = new Worker('./py_worker.js', { type: 'module' });
let ready=false;
worker.onerror = e => println('[worker error] '+(e.message??'(no msg)'));
worker.onmessage = e => {
  const { type, data } = e.data||{};
  if(type==='ready'){ ready=true; code.disabled=false; println('[py] ready'); }
  if(type==='stdout'){ println(data); }
  if(type==='stderr'){ println('[err] '+data); }
  if(type==='spawn'){
    const {id,kind,pos,color} = data;
    api.spawnShape(id,kind,pos,color);
    socket.emit('shape:spawn',{id,kind,pos,color});
  }
};
socket.on('shape:spawn', payload=>api.spawnShape(payload.id,payload.kind,payload.pos,payload.color));

function run(snippet){ if(ready) worker.postMessage({type:'exec',code:snippet}); else println('Pyodide not ready'); }
code.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); const s=code.value.trim(); if(s) run(s); code.value=''; } });