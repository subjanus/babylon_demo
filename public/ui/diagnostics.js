// Minimal diagnostics: toggled by ?debug=1; renders two dots (proj vs mesh) and logs deltas
export function createDiagnostics(scene, { projectFn, getMesh }) {
  const params = new URLSearchParams(location.search);
  const enabled = params.get('debug') === '1';
  if (!enabled) {
    return { enabled, log: () => {} };
  }
  const projMat = new BABYLON.StandardMaterial("projMat", scene);
  projMat.emissiveColor = new BABYLON.Color3(0,1,0);
  const meshMat = new BABYLON.StandardMaterial("meshMat", scene);
  meshMat.emissiveColor = new BABYLON.Color3(1,0,0);
  const projDot = BABYLON.MeshBuilder.CreateSphere("projDot", { diameter: 0.6 }, scene);
  projDot.material = projMat;
  const meshDot = BABYLON.MeshBuilder.CreateSphere("meshDot", { diameter: 0.6 }, scene);
  meshDot.material = meshMat;

  return {
    enabled,
    log({lat, lon}) {
      const proj = projectFn(lat, lon);
      const mesh = getMesh().position;
      projDot.position.set(proj.x, proj.y ?? 0, proj.z);
      meshDot.position.copyFrom(mesh);
      const dx = (mesh.x - proj.x).toFixed(2);
      const dy = (mesh.y - (proj.y ?? 0)).toFixed(2);
      const dz = (mesh.z - proj.z).toFixed(2);
      console.log(`[DIAG] Δ(mesh−proj): (${dx}, ${dy}, ${dz})`);
    }
  };
}
