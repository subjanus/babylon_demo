// public/requestPermissions.js
// iOS requires explicit permission for motion/orientation sensors.
export async function requestDevicePermissions() {
  const results = { motion: null, orientation: null };

  // DeviceMotion
  if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
    try {
      results.motion = await DeviceMotionEvent.requestPermission();
    } catch (e) {
      results.motion = "error";
    }
  }

  // DeviceOrientation
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      results.orientation = await DeviceOrientationEvent.requestPermission();
    } catch (e) {
      results.orientation = "error";
    }
  }

  return results;
}
