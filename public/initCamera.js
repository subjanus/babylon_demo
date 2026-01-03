export function initCamera(scene, canvas) {
  // Drag-look camera (works on desktop + mobile, no gyro/compass instability)
  const camera = new BABYLON.UniversalCamera("cam", new BABYLON.Vector3(0, 1.8, 0), scene);

  // IMPORTANT for iOS/Android:
  // Prevent the page from consuming vertical swipes (scroll / pull-to-refresh)
  // so touch-drag can control pitch as well as yaw.
  if (canvas) {
    canvas.style.touchAction = "none";

    // iOS Safari is picky: make touchmove non-passive so we can preventDefault.
    const prevent = (e) => e.preventDefault();
    canvas.addEventListener("touchmove", prevent, { passive: false });
    canvas.addEventListener("gesturestart", prevent, { passive: false });
    canvas.addEventListener("gesturechange", prevent, { passive: false });
  }

  // Prevent clipping when looking down/up near meshes
  camera.minZ = 0.01;

  // Disable translation movement (we only want look/rotate)
  camera.speed = 0;
  camera.inertia = 0.85;

  // Use Euler rotation for predictable yaw/pitch from drag
  camera.rotationQuaternion = null;
  camera.rotation = new BABYLON.Vector3(0.35, 0, 0); // slight downward tilt so you can "see your feet" sooner

  // Clear default inputs and add only look controls
  camera.inputs.clear();

  // Mouse look (desktop)
  const mouse = new BABYLON.FreeCameraMouseInput();
  mouse.angularSensibility = 1800; // higher = slower/less twitchy
  mouse.buttons = [0, 1, 2];
  camera.inputs.add(mouse);

  // Touch look (mobile)
  const touch = new BABYLON.FreeCameraTouchInput();
  touch.touchAngularSensibility = 9000; // higher = slower/less twitchy
  touch.touchMoveSensibility = 250000;  // effectively disables touch translation
  camera.inputs.add(touch);

  // Clamp pitch so you can look down at your feet but not flip
  const PITCH_MIN = -Math.PI / 2 + 0.05;
  const PITCH_MAX =  Math.PI / 2 - 0.05;
  scene.onBeforeRenderObservable.add(() => {
    if (!camera.rotation) return;
    if (camera.rotation.x < PITCH_MIN) camera.rotation.x = PITCH_MIN;
    if (camera.rotation.x > PITCH_MAX) camera.rotation.x = PITCH_MAX;
  });

  camera.attachControl(canvas, true);
  return camera;
}
