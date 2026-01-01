// public/initBox.js
// Player representation logic:
// - ALL players: cube below user (logic + visible to others)
// - OTHER players: sphere above their cube
// - LOCAL player: NO sphere (camera is the view)

export function initBox(scene, color = "#00A3FF") {
  const cube = BABYLON.MeshBuilder.CreateBox(
    "playerCube",
    { size: 2 },
    scene
  );

  const cubeMat = new BABYLON.StandardMaterial("cubeMat", scene);
  cubeMat.diffuseColor = BABYLON.Color3.FromHexString(color);
  cube.material = cubeMat;

  cube.parent = null;
  cube.position.set(0, -130, 0);
  cube.isPickable = false;

  return cube;
}

export function createRemoteSphere(scene, color = "#FFAA00") {
  const sphere = BABYLON.MeshBuilder.CreateSphere(
    "playerSphere",
    { diameter: 2, segments: 16 },
    scene
  );

  const mat = new BABYLON.StandardMaterial("sphereMat", scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(color);
  mat.specularColor = BABYLON.Color3.Black();
  sphere.material = mat;

  sphere.parent = null;
  sphere.isPickable = false;

  return sphere;
}
