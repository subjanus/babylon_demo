export function initCamera(scene, canvas) {
  // Drag-look camera for both desktop and mobile.
  // (We intentionally avoid DeviceOrientationCamera here to eliminate compass/gyro instability.)
  const camera = new BABYLON.UniversalCamera("cam", new BABYLON.Vector3(0, 1.8, 0), scene);

  // Reduce near clipping plane to avoid slicing meshes when pitching up/down
  camera.minZ = 0.01;

  // We don't want WASD translation for this experience; GPS moves the world.
  camera.speed = 0;

  // Sensible feel for drag look
  camera.angularSensibility = 4000;
  camera.inertia = 0.2;

  // Attach controls (mouse + touch). Canvas already has touch-action:none in CSS.
  camera.attachControl(canvas, true);

  // Remove inputs that cause unwanted movement/zoom
  try {
    if (camera.inputs?.attached?.keyboard) camera.inputs.remove(camera.inputs.attached.keyboard);
    if (camera.inputs?.attached?.mousewheel) camera.inputs.remove(camera.inputs.attached.mousewheel);
    if (camera.inputs?.attached?.touch) {
      // Prevent touch from translating camera; keep rotation only.
      camera.inputs.attached.touch.touchMoveSensibility = 1000000;
      camera.inputs.attached.touch.touchAngularSensibility = 6000;
    }
  } catch (_) {}

  return camera;
}
