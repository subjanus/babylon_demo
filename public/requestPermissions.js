export async function requestDevicePermissions() {
  try {
    // iOS 13+ requires a user gesture for these.
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== "granted") return false;
    }
  } catch (e) { return false; }

  try {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      const r2 = await DeviceOrientationEvent.requestPermission();
      if (r2 !== "granted") return false;
    }
  } catch (e) { return false; }

  return true;
}
