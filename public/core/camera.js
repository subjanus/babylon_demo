export function createFollowCamera(scene, canvas) {
  const cam = new BABYLON.FollowCamera("FollowCam", new BABYLON.Vector3(0, 8, -18), scene);
  cam.radius = 18;
  cam.heightOffset = 8;
  cam.rotationOffset = 0;
  cam.attachControl(canvas, true);
  return cam;
}
