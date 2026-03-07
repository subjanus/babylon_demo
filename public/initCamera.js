export function initCamera(scene, canvas) {
  const camera = new BABYLON.FreeCamera("cam", new BABYLON.Vector3(0, 1.8, 0), scene);
  camera.minZ = 0.01;
  camera.rotationQuaternion = BABYLON.Quaternion.Identity();
  return camera;
}
