// public/initCamera.js
// Camera initialization with corrected near clipping plane
// Fixes geometry clipping when using device orientation / gyro

export function initCamera(scene, canvas) {
  const camera = new BABYLON.DeviceOrientationCamera(
    "camera",
    new BABYLON.Vector3(0, 1.6, 0),
    scene
  );

  // 🔧 CRITICAL FIX: prevent near-plane slicing during extreme pitch
  camera.minZ = 0.01;

  camera.attachControl(canvas, true);

  return camera;
}
