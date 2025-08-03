export function initCamera(scene, canvas) {
    const camera = new BABYLON.DeviceOrientationCamera('DevOrCam', new BABYLON.Vector3(0, 0, -10), scene);
    camera.setTarget(BABYLON.Vector3.Zero());
    camera.attachControl(canvas, true, true);
    return camera;
}