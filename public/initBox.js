// public/initBox.js
export function initBox(scene, { name = "box", size = 1, color = "#ffffff", y = 0 } = {}) {
  const mesh = BABYLON.MeshBuilder.CreateBox(name, { size }, scene);
  mesh.position.y = y;

  const mat = new BABYLON.StandardMaterial(name + "_mat", scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(color);
  mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  mesh.material = mat;

  return mesh;
}

export function initPyramid(scene, { name = "pyramid", height = 2, base = 1.2, color = "#ffffff", y = 0 } = {}) {
  // 4-sided pyramid via low-tessellation cylinder
  const mesh = BABYLON.MeshBuilder.CreateCylinder(
    name,
    { height, diameterTop: 0.0, diameterBottom: base, tessellation: 4 },
    scene
  );
  mesh.position.y = y;

  const mat = new BABYLON.StandardMaterial(name + "_mat", scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(color);
  mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  mesh.material = mat;

  // Make "forward" visually obvious by slightly skewing: add a small fin
  const fin = BABYLON.MeshBuilder.CreateBox(name + "_fin", { width: 0.15, height: 0.6, depth: 0.4 }, scene);
  fin.parent = mesh;
  fin.position.y = 0.15;
  fin.position.z = base * 0.35;
  fin.isPickable = false;
  const fmat = new BABYLON.StandardMaterial(name + "_fin_mat", scene);
  fmat.diffuseColor = BABYLON.Color3.FromHexString(color);
  fmat.specularColor = new BABYLON.Color3(0, 0, 0);
  fin.material = fmat;

  return mesh;
}
