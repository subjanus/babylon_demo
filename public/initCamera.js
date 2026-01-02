export function initCamera(scene, canvas) {
  // Drag/touch-look camera (stable; no device compass/gyro required)
  const camera = new BABYLON.UniversalCamera("cam", new BABYLON.Vector3(0, 1.8, 0), scene);

  // Avoid slicing meshes when pitching up/down
  camera.minZ = 0.01;

  // Prevent accidental movement; we only want look/rotate
  camera.speed = 0;

  // Attach input controls
  camera.attachControl(canvas, true);

  // Ensure we use Euler rotation for yaw (more predictable across inputs)
  camera.rotationQuaternion = null;

  // Tune pointer/touch look sensitivity
  // Desktop mouse look:
  if (camera.inputs.attached.mouse) {
    camera.inputs.attached.mouse.angularSensibility = 3000;
  }

  // Mobile touch look:
  // UniversalCamera includes touch input in most builds; add if missing.
  if (!camera.inputs.attached.touch) {
    try { camera.inputs.addTouch(); } catch (e) {}
  }
  if (camera.inputs.attached.touch) {
    camera.inputs.attached.touch.touchAngularSensibility = 8000; // higher = slower
    camera.inputs.attached.touch.touchMoveSensibility = 0; // disable touch translate
  }

  // Remove keyboard movement and mouse wheel zoom/pan if present
  try { camera.inputs.removeByType("FreeCameraKeyboardMoveInput"); } catch (e) {}
  try { camera.inputs.removeByType("FreeCameraMouseWheelInput"); } catch (e) {}
  return camera;
}
