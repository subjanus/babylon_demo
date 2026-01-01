// public/geo.js
// ADD the marked lines to your existing GPS update logic
// (do not replace your full file)

function updateUserMeshFromGPS(me, x, z, scene) {
  if (!me || !scene || !scene.activeCamera) return;

  // Existing logic likely sets x/z already
  me.position.x = x;
  me.position.z = z;

  // 🔼 Keep the sphere ABOVE the camera
  me.position.y = scene.activeCamera.position.y + 10;
}
