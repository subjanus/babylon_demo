export let engine, scene, canvas;

export function initScene() {
  canvas = document.getElementById('renderCanvas');
  engine = new BABYLON.Engine(canvas, true);
  scene  = new BABYLON.Scene(engine);
  const cam = new BABYLON.DeviceOrientationCamera('cam', new BABYLON.Vector3(0,0,-10), scene);
  cam.setTarget(BABYLON.Vector3.Zero());
  cam.attachControl(canvas, true);
  new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0,1,0), scene).intensity = 0.7;
}

export function startRenderLoop() {
  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());
}

