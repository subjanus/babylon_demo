const drops = [];

export function drop(lat, lon, converter) {
  const pos = converter(lat, lon);
  const cube = BABYLON.MeshBuilder.CreateBox(`drop-${Date.now()}`, { size:0.5 }, scene);
  // purple material…
  cube.position = pos;
  drops.push(cube);
}

