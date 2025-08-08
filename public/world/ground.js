export function createGround(scene) {
  const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 500, height: 500, subdivisions: 2 }, scene);
  const gmat = new BABYLON.StandardMaterial("gmat", scene);
  gmat.diffuseColor = new BABYLON.Color3(0.08, 0.1, 0.12);
  gmat.specularColor = new BABYLON.Color3(0,0,0);
  ground.material = gmat;
  return ground;
}
