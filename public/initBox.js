// public/initBox.js
// User representation as a sphere positioned ABOVE the camera.

export function initBox(scene, hex = "#00A3FF") {
  const sphere = BABYLON.MeshBuilder.CreateSphere(
    "me",
    { diameter: 2, segments: 16 },
    scene
  );

  const mat = new BABYLON.StandardMaterial("meMat", scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(hex);
  mat.specularColor = BABYLON.Color3.Black();
  sphere.material = mat;

  // Ensure world-space, not parented
  sphere.parent = null;

  // Start above the camera
  sphere.position.set(0, 10, 0);

  sphere.isPickable = false;
  sphere.alwaysSelectAsActiveMesh = true;

  return sphere;
}
