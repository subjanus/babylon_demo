// public/initBox.js
// Creates the local player cube as a pure world-space mesh.
// Intentionally NOT parented to the camera or any transform node.

export function initBox(scene, hex = "#00A3FF") {
  if (!scene || !window.BABYLON) {
    console.error("initBox: BABYLON or scene not available");
    return null;
  }

  const box = BABYLON.MeshBuilder.CreateBox(
    "me",
    { size: 2 },
    scene
  );

  const mat = new BABYLON.StandardMaterial("meMat", scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(hex);
  mat.specularColor = BABYLON.Color3.Black();
  box.material = mat;

  // 🔒 Ensure absolute world-space behavior
  box.parent = null;

  // 🔽 Place well below camera / horizon
  box.position.x = 0;
  box.position.y = -130;
  box.position.z = 0;

  // Optional safety / debugging flags
  box.isPickable = false;
  box.alwaysSelectAsActiveMesh = true;
  box.checkCollisions = false;

  return box;
}