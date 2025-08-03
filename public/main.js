import { initScene } from "./initScene.js";
import { initCamera } from "./initCamera.js";
import { requestDevicePermissions } from "./requestPermissions.js";
import { initBox } from "./initBox.js";

document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("renderCanvas");
  const hud    = document.getElementById("hud");
  const socket = io();

  // ─── Scene & Camera ─────────────────────────────────────────────────────────
  const { engine, scene } = initScene(canvas);
  const camera            = initCamera(scene, canvas);

  // ─── Local Client Cube ──────────────────────────────────────────────────────
  // This is your own “avatar” cube (size=2)
  const box = initBox(scene);

  // ─── Device Motion Permission (iOS) ────────────────────────────────────────
  window.addEventListener("click", requestDevicePermissions, { once: true });

  // ─── Color‐Toggle (unchanged) ──────────────────────────────────────────────
  socket.on("colorUpdate", (newColor) => {
    box.material.diffuseColor = BABYLON.Color3.FromHexString(newColor);
  });
  scene.onPointerObservable.add(
    () => socket.emit("toggleColor"),
    BABYLON.PointerEventTypes.POINTERDOWN
  );

  // ─── Multiplayer State Setup ────────────────────────────────────────────────
  let baseLat     = null, baseLon = null;
  let lastLat     = null, lastLon = null;
  let currentLat  = null, currentLon = null;
  const otherPlayers = {};
  let clientOrder    = [];

  function latLonToBabylon(lat, lon) {
    return new BABYLON.Vector3(
      (lon - baseLon) * 100000,
      0,
      (lat - baseLat) * 100000
    );
  }

  function getColorForClient(id) {
    const idx = clientOrder.indexOf(id);
    if (idx === 0) return BABYLON.Color3.Black();
    if (idx === 1) return BABYLON.Color3.White();
    return new BABYLON.Color3(0.5, 0.5, 0.5);
  }

  function createBlinkingCube(id, pos) {
    const col = getColorForClient(id);
    const c   = BABYLON.MeshBuilder.CreateBox(`player-${id}`, { size: 1 }, scene);
    const m   = new BABYLON.StandardMaterial(`mat-${id}`, scene);
    m.diffuseColor  = col;
    m.emissiveColor = col;
    m.emissiveIntensity = 0.2;
    c.material = m;
    c.position = pos;
    const anim = new BABYLON.Animation(
      `blink-${id}`, "material.emissiveIntensity", 2,
      BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
    );
    anim.setKeys([
      { frame: 0,  value: 0.2 },
      { frame: 10, value: 1   },
      { frame: 20, value: 0.2 }
    ]);
    c.animations.push(anim);
    scene.beginAnimation(c, 0, 20, true);
    return c;
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

  // ─── Render all existing dropped blocks on join ────────────────────────────
  socket.on("initialBlocks", (blocks) => {
    blocks.forEach(({ lat, lon }) => dropCubeAt(lat, lon));
  });

  // ─── Handle new dropped blocks ──────────────────────────────────────────────
  socket.on("createBlock", ({ lat, lon }) => dropCubeAt(lat, lon));

  // ─── Drop‐cube logic (click) ────────────────────────────────────────────────
  function dropCubeAt(lat, lon) {
    if (baseLat === null) return;
    const pos = latLonToBabylon(lat, lon);
    const d   = BABYLON.MeshBuilder.CreateBox("dropCube", { size: 0.5 }, scene);
    const m   = new BABYLON.StandardMaterial("dropMat", scene);
    m.diffuseColor = new BABYLON.Color3(0.7, 0.1, 0.9);
    d.material     = m;
    d.position     = pos;
  }
  canvas.addEventListener("pointerdown", () => {
    if (currentLat != null && currentLon != null) {
      socket.emit("dropCube", { lat: currentLat, lon: currentLon });
    }
  });

  // ─── GPS Tracking & Local Cube + Camera Sync ────────────────────────────────
  function startGpsTracking() {
    if (!navigator.geolocation) {
      console.warn("Geolocation not supported");
      return;
    }
    navigator.geolocation.watchPosition(
      (pos) => {
        const lat = +pos.coords.latitude.toFixed(5);
        const lon = +pos.coords.longitude.toFixed(5);
        currentLat = lat;
        currentLon = lon;

        // Establish map origin
        if (baseLat === null) {
          baseLat = lat;
          baseLon = lon;
        }

        // Only broadcast & update on actual change
        if (lat !== lastLat || lon !== lastLon) {
          lastLat = lat;
          lastLon = lon;
          socket.emit("gpsUpdate", { lat, lon });

          // Compute 3D position
          const myPos = latLonToBabylon(lat, lon);

          // ─── Move your own cube ────────────────────────────────────
          box.position = myPos;

          // ─── Reposition camera just above it ──────────────────────
          const cameraHeight = 5; // adjust as desired
          camera.position.x = myPos.x;
          camera.position.z = myPos.z;
          camera.position.y = myPos.y + cameraHeight;
          camera.setTarget(myPos);
        }
      },
      (err) => console.warn("GPS error", err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
  }
  startGpsTracking();

  // ─── Other‐Clients Handlers ────────────────────────────────────────────────
  socket.on("updateClientPosition", ({ id, lat, lon }) =>
    updateOrCreateClientCube(id, lat, lon)
  );

  socket.on("clientListUpdate", (clients) => {
    hud.innerHTML = `Active Clients: ${Object.keys(clients).length}<br>`;
    for (const [id, pos] of Object.entries(clients)) {
      if (pos.lat != null && pos.lon != null) {
        if (!clientOrder.includes(id)) clientOrder.push(id);
        updateOrCreateClientCube(id, pos.lat, pos.lon);
        hud.innerHTML += `${id.slice(0, 6)}: ${pos.lat}, ${pos.lon}<br>`;
      }
    }
  });

  socket.on("removeClient", (id) => {
    if (otherPlayers[id]) {
      otherPlayers[id].dispose();
      delete otherPlayers[id];
    }
    clientOrder = clientOrder.filter((c) => c !== id);
  });

  // ─── Render Loop & Resize ────────────────────────────────────────────────
  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
});
