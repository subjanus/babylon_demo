// Local tangent plane (ENU-ish) conversion for short ranges.
// Produces X (east, meters) and Z (north, meters) relative to a reference lat/lon.
export function latLonToLocal(lat, lon, refLat, refLon) {
const φ = toRad(refLat);
const mPerDegLat = 111132.92 - 559.82 * Math.cos(2*φ) + 1.175 * Math.cos(4*φ);
const mPerDegLon = 111412.84 * Math.cos(φ) - 93.5 * Math.cos(3*φ);
const dx = (lon - refLon) * mPerDegLon; // east-west
const dz = (lat - refLat) * mPerDegLat; // north-south
return { x: dx, z: dz };
}


export const toRad = d => d * Math.PI / 180;
export const toFix5 = n => Number(n.toFixed(5));
