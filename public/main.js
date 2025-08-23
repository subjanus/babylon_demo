import { initScene } from "./initScene.js";
import { initCamera } from "./initCamera.js";
import { requestDevicePermissions } from "./requestPermissions.js";
import { initBox } from "./initBox.js";

document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("renderCanvas");
  const hud    = document.getElementById("hud");
  const socket = io();

  // Scene, camera, and client cube setup
  const { engine, scene } = initScene(canvas);
  const camera            = initCamera(scene, canvas);
  const box               = initBox(scene);

  // iOS motion permission
  window.addEventListener("click", requestDevicePermissions, { once: true });

  // Color-toggle (unchanged)
  socket.on("colorUpdate", newColor => {
    box.material.diffuseColor = BABYLON.Color3.FromHexString(newColor);
  });
  scene.onPointerObservable.add(
    () => socket.emit("toggleColor"),
    BABYLON.PointerEventTypes.POINTERDOWN
  );

  // Multiplayer state
  let baseLat = null, baseLon = null;
  let lastLat = null, lastLon = null;
  let currentLat = null, currentLon = null;
  const otherPlayers = {};
  let clientOrder   = [];

  function latLonToBabylon(lat, lon) {
    return new BABYLON.Vector3(
      (lon - baseLon) * 100000,
      0,
      (lat - baseLat) * 100000
    );
  }

  // dropped‐cube renderer
  function dropCubeAt(lat, lon) {
    if (baseLat === null) return;
    const pos = latLonToBabylon(lat, lon);
    const drop = BABYLON.MeshBuilder.CreateBox("dropCube", { size: 0.5 }, scene);
    const mat  = new BABYLON.StandardMaterial("dropMat", scene);
    mat.diffuseColor = new BABYLON.Color3(0.7, 0.1, 0.9); // purple
    drop.material    = mat;
    drop.position    = pos;
  }

  // handle existing drops on join
  socket.on("initialBlocks", blocks => {
    blocks.forEach(({ lat, lon }) => dropCubeAt(lat, lon));
  });

  // handle new drops
  socket.on("createBlock", ({ lat, lon }) => {
    dropCubeAt(lat, lon);
  });

  // your click → dropCube request
  canvas.addEventListener("pointerdown", () => {
    if (currentLat != null && currentLon != null) {
      socket.emit("dropCube", { lat: currentLat, lon: currentLon });
    }
  });

  // GPS tracking
  function startGpsTracking() {
    if (!navigator.geolocation) return console.warn("Geolocation not supported");
    navigator.geolocation.watchPosition(
      pos => {
        const lat = +pos.coords.latitude.toFixed(5);
        const lon = +pos.coords.longitude.toFixed(5);
        currentLat = lat; currentLon = lon;
        if (baseLat === null) { baseLat = lat; baseLon = lon; }
        if (lat !== lastLat || lon !== lastLon) {
          lastLat = lat; lastLon = lon;
          socket.emit("gpsUpdate", { lat, lon });
          const myPos = latLonToBabylon(lat, lon);
          camera.position.x = myPos.x;
          camera.position.z = myPos.z;
        }
      },
      err => console.warn("GPS error", err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
  }
  startGpsTracking();

  // (other multiplayer handlers remain unchanged...)
  socket.on("updateClientPosition", ({ id, lat, lon }) => { /* … */ });
  socket.on("clientListUpdate", clients => { /* … */ });
  socket.on("removeClient", id => { /* … */ });

  // render loop
  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
});
