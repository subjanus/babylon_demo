// public/initScene.js
export function initScene(canvas) {
  const engine = new BABYLON.Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true
  });

  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.04, 0.06, 0.08, 1.0);

  // Subtle light
  const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.85;

  // Soft ground grid for depth
  const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 400, height: 400 }, scene);
  ground.isPickable = false;
  ground.position.y = -1;

  const gmat = new BABYLON.StandardMaterial("gmat", scene);
  gmat.diffuseColor = new BABYLON.Color3(0.08, 0.1, 0.13);
  gmat.specularColor = new BABYLON.Color3(0, 0, 0);
  ground.material = gmat;

  const axes = new BABYLON.AxesViewer(scene, 2);
  axes.xAxis.parent = null; // keep as world helper
  axes.yAxis.parent = null;
  axes.zAxis.parent = null;
  axes.xAxis.isPickable = false;
  axes.yAxis.isPickable = false;
  axes.zAxis.isPickable = false;

  return { engine, scene };
}
