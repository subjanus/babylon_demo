// public/initCamera.js
// Drag-look camera that works on iPhone (yaw + pitch via single-finger drag).
// Keeps GPS/world movement logic separate from camera movement.

export function initCamera(scene, canvas) {
  // Use UniversalCamera for reliable touch/drag look across devices.
  const camera = new BABYLON.UniversalCamera(
    "cam",
    new BABYLON.Vector3(0, 1.8, 0),
    scene
  );

  // Avoid near-plane clipping when looking around close to meshes
  camera.minZ = 0.01;

  // GPS moves the world; camera should not translate by input
  camera.speed = 0;

  // Make drag look feel sane (higher = slower)
  camera.angularSensibility = 5000;
  camera.inertia = 0.2;

  // Ensure canvas is not interpreting touch as scroll/zoom
  try { canvas.style.touchAction = "none"; } catch (_) {}

  // Attach controls
  camera.attachControl(canvas, true);

  // Remove inputs that cause unwanted movement/zoom
  try {
    // Keyboard movement
    if (camera.inputs?.attached?.keyboard) camera.inputs.remove(camera.inputs.attached.keyboard);
    // Mouse wheel zoom
    if (camera.inputs?.attached?.mousewheel) camera.inputs.remove(camera.inputs.attached.mousewheel);
  } catch (_) {}

  // iOS: remove touch-translation input; keep pointers input for rotation (yaw + pitch)
  try {
    // Guarantee pointers input exists
    if (!camera.inputs?.attached?.pointers) {
      camera.inputs.add(new BABYLON.FreeCameraPointersInput());
    }
    if (camera.inputs?.attached?.pointers) {
      camera.inputs.attached.pointers.angularSensibilityX = 5000;
      camera.inputs.attached.pointers.angularSensibilityY = 5000;
    }
    // Remove touch (translation) input if present
    if (camera.inputs?.attached?.touch) {
      camera.inputs.remove(camera.inputs.attached.touch);
    }
  } catch (e) {
    // If anything about inputs fails, we still return a working camera.
    console.warn("initCamera: input tuning failed:", e);
  }

  // Constrain pitch so you can look up/down without flipping
  try {
    camera.lowerBetaLimit = 0.1;
    camera.upperBetaLimit = Math.PI - 0.1;
  } catch (_) {}

  return camera;
}
