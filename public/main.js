const out = document.getElementById('out');
const code = document.getElementById('code');
const runBtn = document.getElementById('run');
const statusEl = document.getElementById('status');
const workerMode = document.getElementById('workerMode');
const echo = document.getElementById('echo');

function println(s){ out.textContent += s + "\n"; out.scrollTop = out.scrollHeight; }

const socket = io();
socket.on('code:ack', (msg)=> println(`[ack] code length=${msg.len} at ${new Date(msg.at).toLocaleTimeString()}`));
socket.on('code:notice', (msg)=> println(`[notice from peer] code length=${msg.len} at ${new Date(msg.at).toLocaleTimeString()}`));

let worker, ready = false;

function bootWorker(mode='cdn'){
  if (worker) { worker.terminate(); worker = null; }
  ready = false;
  runBtn.disabled = true;
  code.disabled = true;
  statusEl.textContent = 'loading…';

  const url = mode === 'local' ? './py_worker_local.js' : './py_worker_cdn.js';
  worker = new Worker(url, { type: 'module' });
  worker.onerror = e => println('[worker error] ' + (e.message ?? '(no message)'));
  worker.onmessageerror = () => println('[worker msg error]');
  worker.onmessage = (e) => {
    const { type, data } = e.data || {};
    if (type === 'ready'){ ready = true; runBtn.disabled = false; statusEl.textContent = 'ready'; }
    if (type === 'stdout'){ println(data); }
    if (type === 'stderr'){ println('[err] ' + data); }
    if (type === 'hello'){ code.disabled = false; code.focus(); println('[info] interpreter online.'); }
  };
}

bootWorker(workerMode.value);
workerMode.addEventListener('change', ()=> bootWorker(workerMode.value));

function runSnippet(snippet){
  if (!ready) { println('Pyodide not ready'); return; }
  worker.postMessage({ type:'exec', code: snippet });
  if (echo.checked) socket.emit('code:run', { snippet });
}

runBtn.onclick = () => {
  const s = code.value.trim();
  if (s) runSnippet(s);
  code.value='';
};
code.addEventListener('keydown', (e)=>{
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    runBtn.click();
  }
});