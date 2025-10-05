export function initScene(canvas, log) {
  const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.03, 0.05, 0.08, 1.0);

  const arc = new BABYLON.ArcRotateCamera('arc', Math.PI/2, Math.PI/3, 12, new BABYLON.Vector3(0, 1, 0), scene);
  arc.attachControl(canvas, true);
  arc.wheelPrecision = 50;

  const dev = new BABYLON.DeviceOrientationCamera('dev', new BABYLON.Vector3(0, 1, 0), scene);
  dev.detachControl();
  dev.angularSensibility = 10;

  let active = arc;
  scene.activeCamera = active;

  const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), scene);
  light.intensity = 0.9;

  const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 50, height: 50, subdivisions: 4 }, scene);
  const matG = new BABYLON.StandardMaterial('grid', scene);
  matG.wireframe = true;
  matG.diffuseColor = new BABYLON.Color3(0.2, 0.35, 0.5);
  ground.material = matG;

  const peers = new Map();
  const shapes = new Map();

  function spawnPeer(id) {
    if (peers.has(id)) return peers.get(id);
    const mesh = BABYLON.MeshBuilder.CreateSphere('peer_'+id, { diameter: 0.6 }, scene);
    mesh.position.y = 0.3;
    const mat = new BABYLON.StandardMaterial('mat_'+id, scene);
    mat.diffuseColor = new BABYLON.Color3(1.0, 0.6, 0.2);
    mesh.material = mat;
    peers.set(id, mesh);
    return mesh;
  }

  function movePeer(id, x, z) {
    const m = peers.get(id);
    if (m) { m.position.x = x * 0.1; m.position.z = z * 0.1; }
  }

  function despawnPeer(id) {
    const m = peers.get(id);
    if (m) { m.dispose(); peers.delete(id); }
  }

  function spawnShape(id, kind='box', pos=[0,0.5,0], color=[0.3,0.8,1]) {
    if (shapes.has(id)) return shapes.get(id);
    let mesh;
    if (kind === 'sphere') mesh = BABYLON.MeshBuilder.CreateSphere(id, { diameter: 1.0 }, scene);
    else mesh = BABYLON.MeshBuilder.CreateBox(id, { size: 1.0 }, scene);
    mesh.position = new BABYLON.Vector3(pos[0], pos[1], pos[2]);
    const m = new BABYLON.StandardMaterial('mat_'+id, scene);
    m.diffuseColor = new BABYLON.Color3(color[0], color[1], color[2]);
    mesh.material = m;
    shapes.set(id, mesh);
    return mesh;
  }

  function toggleCamera() {
    if (active === arc) {
      active.detachControl();
      active = dev;
      scene.activeCamera = dev;
      dev.attachControl(canvas, true);
      log('Camera: DeviceOrientation');
    } else {
      active.detachControl();
      active = arc;
      scene.activeCamera = arc;
      arc.attachControl(canvas, true);
      log('Camera: ArcRotate');
    }
  }

  engine.runRenderLoop(() => scene.render());
  addEventListener('resize', () => engine.resize());

  return { scene, engine, api: { spawnPeer, movePeer, despawnPeer, spawnShape, toggleCamera } };
}