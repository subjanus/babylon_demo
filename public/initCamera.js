export function initCamera(scene, canvas) {
  // Replace DeviceOrientationCamera with a drag/touch controlled camera.
  // This avoids compass/device-orientation jitter and makes mapping tests much more stable.
  const camera = new BABYLON.UniversalCamera("cam", new BABYLON.Vector3(0, 1.8, 0), scene);

  // Look forward (Babylon forward is +Z by default for this setup)
  camera.setTarget(new BABYLON.Vector3(0, 1.8, 1));

  // Reduce near clipping plane to avoid slicing meshes when pitching up/down
  camera.minZ = 0.01;

  // Attach pointer/touch look controls
  camera.attachControl(canvas, true);

  // Prevent keyboard/touch movement from translating the camera (we only want look).
  try {
    camera.inputs.removeByType("FreeCameraKeyboardMoveInput");
  } catch (_) {}
  try {
    camera.inputs.removeByType("FreeCameraTouchInput");
  } catch (_) {}

  // Make drag feel less twitchy
  camera.angularSensibility = 4000;

  return camera;
}
