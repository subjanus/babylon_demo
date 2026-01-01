// public/geo.js
// GPS update logic shared by local + remote players

export function updatePlayerPosition(player, x, z) {
  if (!player) return;
  player.position.x = x;
  player.position.z = z;
  player.position.y = -130; // always below user
}

export function updateRemoteSphere(sphere, cube, scene) {
  if (!sphere || !cube || !scene || !scene.activeCamera) return;
  sphere.position.x = cube.position.x;
  sphere.position.z = cube.position.z;
  sphere.position.y = scene.activeCamera.position.y + 10;
}
