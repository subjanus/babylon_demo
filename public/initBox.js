// public/initBox.js
export function initBox(scene, hex = "#00A3FF") {
  const box = BABYLON.MeshBuilder.CreateBox("me", { size: 2 }, scene);

  const mat = new BABYLON.StandardMaterial("meMat", scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(hex);
  box.material = mat;

  // Ensure box is NOT parented to camera or any transform
  box.parent = null;

  // Force absolute world position well below camera
  box.position.set(0, -130, 0);

  box.isPickable = false;
  box.alwaysSelectAsActiveMesh = true;

  return box;
}
