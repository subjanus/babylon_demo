function initCamera(scene) {
  const camera = new BABYLON.FollowCamera("FollowCam", new BABYLON.Vector3(0, 8, -18), scene);
  camera.radius = 18;
  camera.heightOffset = 8;
  camera.rotationOffset = 0; // facing target
  camera.attachControl(scene.getEngine().getRenderingCanvas(), true);
  return camera;
}
