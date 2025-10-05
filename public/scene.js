export function initScene(canvas, log) {
  const engine = new BABYLON.Engine(canvas, true);
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.05,0.07,0.1,1.0);

  const cam = new BABYLON.ArcRotateCamera('cam', Math.PI/2, Math.PI/3, 6, new BABYLON.Vector3(0,1,0), scene);
  cam.attachControl(canvas, true);

  const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0,1,0), scene);

  engine.runRenderLoop(()=>scene.render());
  addEventListener('resize', ()=>engine.resize());

  function spawnShape(id, kind='box', pos=[0,0.5,0], color=[0.3,0.8,1]) {
    let mesh = kind==='sphere' ? BABYLON.MeshBuilder.CreateSphere(id,{diameter:1},scene) :
      BABYLON.MeshBuilder.CreateBox(id,{size:1},scene);
    mesh.position = new BABYLON.Vector3(pos[0], pos[1], pos[2]);
    const mat = new BABYLON.StandardMaterial('m'+id, scene);
    mat.diffuseColor = new BABYLON.Color3(color[0],color[1],color[2]);
    mesh.material = mat;
    return mesh;
  }

  return { scene, engine, api: { spawnShape } };
}