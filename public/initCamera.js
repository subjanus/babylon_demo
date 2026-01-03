export function initCamera(scene, canvas) {
  // Drag-look camera for both desktop and mobile.
  // We avoid DeviceOrientationCamera to eliminate compass/gyro instability.
  const camera = new BABYLON.UniversalCamera("cam", new BABYLON.Vector3(0, 1.8, 0), scene);

  // Reduce near clipping plane to avoid slicing meshes when pitching up/down
  camera.minZ = 0.01;

  // GPS moves the world; camera should not translate via WASD/touch.
  camera.speed = 0;

  // Sensible feel for drag look
  camera.angularSensibility = 4000;
  camera.inertia = 0.2;

  // Attach controls (mouse + touch). Make sure your canvas CSS has touch-action:none.
  camera.attachControl(canvas, true);

  // Remove inputs that cause unwanted movement/zoom
  try {
    if (camera.inputs?.attached?.keyboard) camera.inputs.remove(camera.inputs.attached.keyboard);
    if (camera.inputs?.attached?.mousewheel) camera.inputs.remove(camera.inputs.attached.mousewheel);
  } catch (_) {}

  // On iPhone, FreeCameraTouchInput tends to interpret 1-finger drags as movement.
  // We want 1-finger drag to rotate (yaw + pitch), so use Pointers input and remove Touch input.
  try {
    // Ensure pointers input exists and tune for both axes
    if (!camera.inputs?.attached?.pointers) {
      camera.inputs.add(new BABYLON.FreeCameraPointersInput());
    }
    if (camera.inputs?.attached?.pointers) {
      camera.inputs.attached.pointers.angularSensibilityX = 5000; // left/right
      camera.inputs.attached.pointers.angularSensibilityY = 5000; // up/down
    }

    // Remove touch translation input entirely
    if (camera.inputs?.attached?.touch) {
      camera.inputs.remove(camera.inputs.attached.touch);
    }
  } catch (_) {}

  return camera;
}
