const hud = document.getElementById('hud');

export function showClients(clients) {
  hud.innerHTML = Object.entries(clients)
    .map(([id,p]) => `${id.slice(0,6)} ▶ ${p.lat}, ${p.lon}`)
    .join('<br>');
  setTimeout(()=>hud.innerHTML='',5000);
}

