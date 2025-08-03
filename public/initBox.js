export function initBox(scene) {
  const box = BABYLON.MeshBuilder.CreateBox("box", { size: 2 }, scene);
  const mat = new BABYLON.StandardMaterial("mat", scene);
  box.material = mat;
  return box;
}