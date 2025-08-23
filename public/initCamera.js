export function initCamera(scene, canvas) {
const camera = new BABYLON.DeviceOrientationCamera("cam", new BABYLON.Vector3(0, 2, -6), scene);
camera.setTarget(BABYLON.Vector3.Zero());
camera.attachControl(canvas, true);
return camera;
}