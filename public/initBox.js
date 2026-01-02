// public/initBox.js
// Small helper to create a colored cube (position is set by the caller).

export function initBox(scene, hex = "#00A3FF") {
  const box = BABYLON.MeshBuilder.CreateBox("box", { size: 2 }, scene);

  const mat = new BABYLON.StandardMaterial("boxMat", scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(hex);
  mat.specularColor = BABYLON.Color3.Black();
  box.material = mat;

  // Caller sets parent + position
  return box;
}
