export const config = { SCALE: 100 }; // degrees -> scene units (placeholder)
export function latLonToWorld({lat, lon}) {
  const s = config.SCALE;
  return { x: lon * s, y: 0, z: -lat * s };
}
export function worldToLatLon({x, z}) {
  const s = config.SCALE;
  return { lon: x / s, lat: -z / s };
}
