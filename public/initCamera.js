// Uses useCapture = true so iOS Safari
// grabs deviceorientation events properly
export function initCamera(scene, canvas) {
  const camera = new BABYLON.DeviceOrientationCamera(
    "DevOrCam",
    new BABYLON.Vector3(0, 0, -10),
    scene
  );
  camera.setTarget(BABYLON.Vector3.Zero());
  // noPreventDefault = true, useCapture = true
  camera.attachControl(canvas, true, true);
  return camera;
}
