export function initBox(scene, hex = "#00A3FF") {
  const box = BABYLON.MeshBuilder.CreateBox("me", { size: 2 }, scene);
  const mat = new BABYLON.StandardMaterial("meMat", scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(hex);
  mat.specularColor = BABYLON.Color3.Black();
  box.material = mat;

  box.parent = null;
  box.position.set(0, -130, 0);

  return box;
}
