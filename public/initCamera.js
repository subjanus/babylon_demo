export function initCamera(scene, canvas) {
  // Prefer device orientation camera when available, but keep a sensible fallback.
  let camera = null;

  if (BABYLON.DeviceOrientationCamera) {
    camera = new BABYLON.DeviceOrientationCamera("cam", new BABYLON.Vector3(0, 1.8, 0), scene);
    camera.angularSensibility = 5;
  } else {
    camera = new BABYLON.UniversalCamera("cam", new BABYLON.Vector3(0, 1.8, -6), scene);
    camera.setTarget(new BABYLON.Vector3(0, 1.2, 0));
  }

  camera.attachControl(canvas, true);
  return camera;
}
