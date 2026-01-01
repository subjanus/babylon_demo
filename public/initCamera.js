export function initCamera(scene, canvas) {
  const camera = new BABYLON.DeviceOrientationCamera("cam", new BABYLON.Vector3(0, 1.8, 0), scene);
  camera.attachControl(canvas, true);
  return camera;
}
