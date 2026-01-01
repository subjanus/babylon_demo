// public/initBox.js

export function initBox(scene, hex = "#00A3FF") {
  const box = BABYLON.MeshBuilder.CreateBox("me", { size: 2 }, scene);

  const mat = new BABYLON.StandardMaterial("meMat", scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(hex);
  box.material = mat;

  // 🔽 DROP THE CUBE WELL BELOW CAMERA LEVEL
  box.position.x = 0;
  box.position.y = -10;   // <<<<< THIS IS THE KEY LINE
  box.position.z = 0;

  return box;
}