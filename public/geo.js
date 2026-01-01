// public/geo.js
// NOTE: Only the Y-pinning line is functionally new.
// Everything else should match your existing GPS logic.

export function updatePositionFromGeo(box, gpsX, gpsZ) {
  if (!box) return;

  box.position.x = gpsX;
  box.position.z = gpsZ;

  // 🔒 HARD PIN Y so camera motion never drags the cube
  box.position.y = -130;
}
