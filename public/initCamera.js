// public/initCamera.js
// Mobile: DeviceOrientationCamera (gyro)
// Desktop: ArcRotateCamera (mouse drag)

export function initCamera(scene, canvas) {
  const isTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
  const hasDeviceOri = typeof window.DeviceOrientationEvent !== "undefined";

  let camera;

  if (isTouch && hasDeviceOri) {
    camera = new BABYLON.DeviceOrientationCamera(
      "cam",
      new BABYLON.Vector3(0, 6, -12),
      scene
    );
    camera.fov = 0.9;
    camera.minZ = 0.05;
    camera.maxZ = 5000;
    camera.attachControl(canvas, true);
    camera.setTarget(BABYLON.Vector3.Zero());
  } else {
    camera = new BABYLON.ArcRotateCamera(
      "cam",
      -Math.PI / 2,
      Math.PI / 3,
      18,
      new BABYLON.Vector3(0, 0, 0),
      scene
    );
    camera.lowerRadiusLimit = 3;
    camera.upperRadiusLimit = 120;
    camera.wheelPrecision = 50;
    camera.panningSensibility = 0;
    camera.minZ = 0.05;
    camera.maxZ = 5000;
    camera.attachControl(canvas, true);
  }

  return camera;
}
