import { initScene } from "./initScene.js";
import { initCamera } from "./initCamera.js";
import { requestDevicePermissions } from "./requestPermissions.js";
import { initBox } from "./initBox.js";

document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("renderCanvas");
  const hud    = document.getElementById("hud");
  const socket = io();

  // 1️⃣ Set up scene & camera
  const { engine, scene } = initScene(canvas);
  const camera            = initCamera(scene, canvas);

  // 2️⃣ Create the doubled-size client cube
  const box = initBox(scene);

  // 3️⃣ iOS device motion permission on first tap
  window.addEventListener("click", requestDevicePermissions, { once: true });

  // 4️⃣ Color-toggle logic (unchanged)
  socket.on("colorUpdate", newColor => {
    box.material.diffuseColor = BABYLON.Color3.FromHexString(newColor);
  });
  scene.onPointerObservable.add(
    () => socket.emit("toggleColor"),
    BABYLON.PointerEventTypes.POINTERDOWN
  );

  // 5️⃣ GPS + multiplayer logic
  let baseLat = null, baseLon = null;
  let lastLat = null, lastLon = null;
  let currentLat = null, currentLon = null;
  const otherPlayers = {};
  let clientOrder = [];

  function latLonToBabylon(lat, lon) {
    return new BABYLON.Vector3(
      (lon - baseLon) * 100000,
      0,
      (lat - baseLat) * 100000
    );
  }

  function getColorForClient(id) {
    const i = clientOrder.indexOf(id);
    if (i === 0) return BABYLON.Color3.Black();
    if (i === 1) return BABYLON.Color3.White();
    return new BABYLON.Color3(0.5, 0.5, 0.5);
  }

  function createBlinkingCube(id, pos) {
    const color = getColorForClient(id);
    const cube = BABYLON.MeshBuilder.CreateBox(`player-${id}`, { size: 1 }, scene);
    const mat  = new BABYLON.StandardMaterial(`mat-${id}`, scene);
    mat.diffuseColor   = color;
    mat.emissiveColor  = color;
    mat.emissiveIntensity = 0.2;
    cube.material = mat;
    cube.position = pos;

    const anim = new BABYLON.Animation(
      `blink-${id}`, "material.emissiveIntensity",
      2, BABYLON.Animation.ANIMATIONTYPE_FLOAT,
      BABYLON.AnimationLOOPMODE_CYCLE
    );
    anim.setKeys([
      { frame: 0,  value: 0.2 },
      { frame: 10, value: 1   },
      { frame: 20, value: 0.2 }
    ]);
    cube.animations.push(anim);
    scene.beginAnimation(cube, 0, 20, true);
    return cube;
  }

  function updateOrCreateClientCube(id, lat, lon) {
    if (!baseLat || !baseLon || id === socket.id) return;
    const pos = latLonToBabylon(lat, lon);
    if (!clientOrder.includes(id)) clientOrder.push(id);
    if (otherPlayers[id]) {
      otherPlayers[id].position = pos;
    } else {
      otherPlayers[id] = createBlinkingCube(id, pos);
    }
  }

  // Handlers
  socket.on("updateClientPosition", ({id, lat, lon}) =>
    updateOrCreateClientCube(id, lat, lon)
  );

  socket.on("clientListUpdate", clients => {
    hud.innerHTML = `Active Clients: ${Object.keys(clients).length}<br>`;
    for (const [id, pos] of Object.entries(clients)) {
      if (pos.lat != null && pos.lon != null) {
        if (!clientOrder.includes(id)) clientOrder.push(id);
        updateOrCreateClientCube(id, pos.lat, pos.lon);
        hud.innerHTML += `${id.slice(0,6)}: ${pos.lat}, ${pos.lon}<br>`;
      }
    }
  });

  socket.on("removeClient", id => {
    if (otherPlayers[id]) {
      otherPlayers[id].dispose();
      delete otherPlayers[id];
    }
    clientOrder = clientOrder.filter(c => c !== id);
  });

  // GPS watching
  function startGpsTracking() {
    if (!navigator.geolocation) return console.warn("Geolocation not supported");
    navigator.geolocation.watchPosition(
      pos => {
        const lat = +pos.coords.latitude.toFixed(5);
        const lon = +pos.coords.longitude.toFixed(5);
        currentLat = lat; currentLon = lon;
        if (!baseLat||!baseLon) { baseLat = lat; baseLon = lon; }
        if (lat!==lastLat||lon!==lastLon) {
          lastLat = lat; lastLon = lon;
          socket.emit("gpsUpdate", {lat,lon});
          const myPos = latLonToBabylon(lat, lon);
          camera.position.x = myPos.x; camera.position.z = myPos.z;
        }
      },
      err => console.warn("GPS error", err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
  }
  startGpsTracking();

  // Cube‐dropping (unchanged)
  canvas.addEventListener("pointerdown", () => {
    if (currentLat!=null && currentLon!=null) {
      socket.emit("dropCube", { lat: currentLat, lon: currentLon });
    }
  });
  socket.on("droppedCube", ({lat,lon}) => {
    const pos = latLonToBabylon(lat,lon);
    const drop = BABYLON.MeshBuilder.CreateBox("dropCube",{size:0.5},scene);
    const mat  = new BABYLON.StandardMaterial("dropMat",scene);
    mat.diffuseColor = new BABYLON.Color3(0.7,0.1,0.9);
    drop.material = mat;
    drop.position = pos;
  });

  // Render loop + resize
  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
});