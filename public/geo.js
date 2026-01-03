// public/geo.js
// Tiny helpers; the main watchPosition loop lives in main.js.
export function isNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

// Fast-ish planar approximation, good for small distances.
// Uses latitude to scale longitude.
export function approxDistMeters(lat1, lon1, lat2, lon2, lat0 = lat1) {
  const kLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  const dx = (lon2 - lon1) * kLon;
  const dz = (lat2 - lat1) * 111320;
  return Math.hypot(dx, dz);
}
