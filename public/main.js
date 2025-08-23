import { initScene } from "./initScene.js";
// Emit only on change to reduce chatter
if (lat !== state.myLat || lon !== state.myLon) {
state.myLat = lat; state.myLon = lon;
socket.emit("gpsUpdate", { lat, lon });
updateHUD();
}
}, err => {
hud.textContent = `GPS error: ${err.message}`;
}, { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 });
}
startGps();


// --- Socket wiring ---
socket.on("connect", () => updateHUD());


// server sends full snapshot on join
socket.on("initialState", ({ clients, droppedBlocks, myColor }) => {
// paint me
if (myColor) setMyColor(myColor);


// existing others
Object.entries(clients).forEach(([id, c]) => {
if (id === socket.id) return;
const rec = ensureOther(id, c.color || "#FFCC00");
if (c.lat != null && c.lon != null && state.refLat != null) {
const { x, z } = latLonToLocal(c.lat, c.lon, state.refLat, state.refLon);
rec.mesh.position.set(x, 0.8, z);
}
});


// existing blocks
droppedBlocks.forEach(({ lat, lon }) => placeBlockAt(lat, lon));
updateHUD(Object.keys(clients).length);
});


socket.on("clientListUpdate", (clients) => {
// Add/update/remove meshes to mirror authoritative list
const ids = new Set(Object.keys(clients));
// remove disappeared
[...state.others.keys()].forEach(id => { if (!ids.has(id) || id === socket.id) removeOther(id); });
// ensure existing
Object.entries(clients).forEach(([id, c]) => {
if (id === socket.id) return;
const rec = ensureOther(id, c.color || "#FFCC00");
if (c.lat != null && c.lon != null && state.refLat != null) {
const { x, z } = latLonToLocal(c.lat, c.lon, state.refLat, state.refLon);
rec.mesh.position.set(x, 0.8, z);
}
});
updateHUD(Object.keys(clients).length);
});


socket.on("updateClientPosition", ({ id, lat, lon }) => {
if (id === socket.id) return;
const rec = ensureOther(id);
if (state.refLat == null) return;
const { x, z } = latLonToLocal(lat, lon, state.refLat, state.refLon);
rec.mesh.position.set(x, 0.8, z);
});


socket.on("removeClient", id => removeOther(id));


socket.on("createBlock", ({ lat, lon }) => placeBlockAt(lat, lon));


socket.on("colorUpdate", ({ id, color }) => {
if (id === socket.id) { setMyColor(color); return; }
const rec = ensureOther(id, color);
rec.color = color;
rec.mesh.material.diffuseColor = BABYLON.Color3.FromHexString(color);
});


// render loop
engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());