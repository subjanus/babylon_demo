export async function requestDevicePermissions() {
  try {
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      const r = await DeviceMotionEvent.requestPermission();
      return r === "granted";
    }
  } catch (e) { /* noop */ }
  return true;
}
