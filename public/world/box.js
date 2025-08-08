export function createBox(scene, { name = 'box', size = 1.5, color = 'purple' } = {}) {
  const mesh = BABYLON.MeshBuilder.CreateBox(name, { size }, scene);
  const mat = new BABYLON.StandardMaterial(`${name}_mat`, scene);
  const colors = {
    purple: new BABYLON.Color3(0.6, 0.2, 0.8),
    cyan:   new BABYLON.Color3(0.2, 0.9, 0.9),
    green:  new BABYLON.Color3(0.3, 0.9, 0.4),
    red:    new BABYLON.Color3(0.95, 0.25, 0.2),
  };
  mat.diffuseColor = colors[color] || colors.purple;
  mat.emissiveColor = mat.diffuseColor.scale(0.2);
  mesh.material = mat;
  mesh.position.y = size / 2;
  return mesh;
}
