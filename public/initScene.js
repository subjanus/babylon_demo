function createScene(canvas) {
  const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.02, 0.02, 0.05, 1);

  // lights
  const light = new BABYLON.HemisphericLight("hlight", new BABYLON.Vector3(0, 1, 0), scene);
  light.intensity = 0.9;

  // ground (visual reference)
  const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 500, height: 500, subdivisions: 2 }, scene);
  const gmat = new BABYLON.StandardMaterial("gmat", scene);
  gmat.diffuseColor = new BABYLON.Color3(0.08, 0.1, 0.12);
  gmat.specularColor = new BABYLON.Color3(0,0,0);
  ground.material = gmat;

  return { engine, scene };
}
