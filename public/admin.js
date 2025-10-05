const sessionId = new Date().toISOString();
document.getElementById('session').textContent = sessionId;
const socket = io({ query: { role: 'admin' } });
const tbody = document.getElementById('tbody');

function render(peers) {
  tbody.innerHTML = '';
  peers.forEach(p => {
    const tr = document.createElement('tr');
    const gps = p.gps ? `${p.gps.lat?.toFixed(5)}, ${p.gps.lon?.toFixed(5)} ±${(p.gps.acc||0).toFixed(0)}m` : '—';
    const orient = p.orient ? `α:${(p.orient.alpha||0).toFixed(0)} β:${(p.orient.beta||0).toFixed(0)} γ:${(p.orient.gamma||0).toFixed(0)}` : '—';
    const last = p.lastSeen ? new Date(p.lastSeen).toLocaleTimeString() : '—';
    tr.innerHTML = `<td>${p.id.slice(0,8)}</td><td>${p.name||'—'}</td><td>${p.role||'client'}</td><td>${p.sessionId||'—'}</td><td>${gps}</td><td>${orient}</td><td>${last}</td>`;
    tbody.appendChild(tr);
  });
}

socket.on('connect', () => socket.emit('admin:peek'));
socket.on('server:peers', (arr) => render(arr));
socket.on('peer:join', () => socket.emit('admin:peek'));
socket.on('peer:leave', () => socket.emit('admin:peek'));
document.getElementById('refresh').onclick = () => socket.emit('admin:peek');