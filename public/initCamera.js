// public/initCamera.js
// Camera with corrected near clipping plane

export function initCamera(scene, canvas) {
  const camera = new BABYLON.DeviceOrientationCamera(
    "camera",
    new BABYLON.Vector3(0, 1.6, 0),
    scene
  );

  // Prevent near-plane clipping during extreme pitch
  camera.minZ = 0.01;

  camera.attachControl(canvas, true);
  return camera;
}
