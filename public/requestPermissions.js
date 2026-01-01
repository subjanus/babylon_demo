// iOS Safari requires an explicit user gesture to grant motion/orientation access.
// This helper attempts both DeviceMotionEvent and DeviceOrientationEvent permissions when supported.
export async function requestDevicePermissions() {
  let ok = true;

  // Motion
  try {
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      const r = await DeviceMotionEvent.requestPermission();
      ok = ok && (r === "granted");
    }
  } catch (e) { ok = false; }

  // Orientation
  try {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      const r = await DeviceOrientationEvent.requestPermission();
      ok = ok && (r === "granted");
    }
  } catch (e) { ok = false; }

  return ok;
}
