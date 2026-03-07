export function initCamera(scene, canvas) {
  const camera = new BABYLON.DeviceOrientationCamera("cam", new BABYLON.Vector3(0, 1.8, 0), scene);

  // Critical: reduce near clipping plane to avoid slicing meshes when pitching up/down
  camera.minZ = 0.01;

  camera.attachControl(canvas, true);
  return camera;
}
