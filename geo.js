// Private client-side geo helpers.
// Raw GPS stays on the client; only normalized local-world coordinates are sent.

export const toRad = d => d * Math.PI / 180;
export const toFix5 = n => Number(n.toFixed(5));

// X = east (m), Z = south (m) relative to a private client anchor.
export function latLonToLocal(lat, lon, refLat, refLon) {
  const φ = toRad(refLat);
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * φ) + 1.175 * Math.cos(4 * φ);
  const mPerDegLon = 111412.84 * Math.cos(φ) - 93.5 * Math.cos(3 * φ);
  const dx = (lon - refLon) * mPerDegLon;
  const dz = (refLat - lat) * mPerDegLat;
  return { x: dx, z: dz };
}

export function distanceXZ(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot((b.x || 0) - (a.x || 0), (b.z || 0) - (a.z || 0));
}

export function sanitizeAnchorId(value) {
  return String(value || "private-anchor")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "private-anchor";
}

export function parseAnchorInput(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const parts = raw.split(",").map(s => s.trim());
  if (parts.length < 2) return null;

  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  const anchorId = sanitizeAnchorId(parts[2] || "private-anchor");

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, anchorId };
}


// Convert local X/Z meters back into an approximate lat/lon around a reference point.
export function localToLatLon(x, z, refLat, refLon) {
  const φ = toRad(refLat);
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * φ) + 1.175 * Math.cos(4 * φ);
  const mPerDegLon = 111412.84 * Math.cos(φ) - 93.5 * Math.cos(3 * φ);
  return {
    lat: refLat - (z / mPerDegLat),
    lon: refLon + (x / mPerDegLon)
  };
}

// Reproject a local point from one shared reference point into another.
export function rebaseLocalPoint(point, fromRefLat, fromRefLon, toRefLat, toRefLon) {
  if (!point) return { x: 0, z: 0 };
  if (![fromRefLat, fromRefLon, toRefLat, toRefLon].every(Number.isFinite)) {
    return { x: Number(point.x) || 0, z: Number(point.z) || 0 };
  }
  const world = localToLatLon(Number(point.x) || 0, Number(point.z) || 0, fromRefLat, fromRefLon);
  return latLonToLocal(world.lat, world.lon, toRefLat, toRefLon);
}
