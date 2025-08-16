const meshes = {};
let order = [];

export function updateClients(clients, clientOrder) {
  order = clientOrder.slice();
  // handle creation/removal per clients object…
}

export function updatePosition(id, lat, lon, converter) {
  if (id === mySocketId) return;
  const pos = converter(lat, lon);
  if (meshes[id]) {
    meshes[id].position = pos;
  } else {
    // create blinking via emissive animation…
  }
}

