import * as net      from './network.js';
import { startGps }  from './gpsTracker.js';
import * as scene    from './sceneManager.js';
import * as players  from './playerManager.js';
import * as drops    from './dropManager.js';
import * as ui       from './uiManager.js';

// init
scene.initScene();
scene.startRenderLoop();

// network handlers
net.onClientList(({clients, clientOrder}) => {
  players.updateClients(clients, clientOrder);
  ui.showClients(clients);
});
net.onGpsUpdate(data => players.updatePosition(data.id, data.lat, data.lon, latLonToBabylon));
net.onDroppedCube(data => drops.drop(data.lat, data.lon, latLonToBabylon));

// gps tracking
startGps((lat,lon) => {
  currentLat = lat; currentLon = lon;
  net.emitGps(lat, lon);
  // update camera pos…
});

// drop on click
canvas.addEventListener('pointerdown', () => {
  if (currentLat && currentLon) net.emitDrop(currentLat, currentLon);
});

