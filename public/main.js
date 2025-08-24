import { initScene } from "./initScene.js";
import { initCamera } from "./initCamera.js";
import { initBox } from "./initBox.js";
import { requestDevicePermissions } from "./requestPermissions.js";
import { toFix5 } from "./geo.js";

const socket = io({ transports:["websocket"] });
const canvas = document.getElementById("renderCanvas");
const status = document.getElementById("status");
const btnDrop = document.getElementById("btnDrop");
const btnColor = document.getElementById("btnColor");

const { engine, scene } = initScene(canvas);
const camera = initCamera(scene, canvas);
const me = initBox(scene, "#00A3FF");
const meshes = new Map();

function upsertMesh(obj) {
  let m = meshes.get(obj.id);
  if (!m) {
    if (obj.type === "block") {
      m = BABYLON.MeshBuilder.CreateBox(obj.id, { size: obj.props.size||0.8 }, scene);
      const mat = new BABYLON.StandardMaterial(obj.id+"_mat", scene);
      mat.diffuseColor = BABYLON.Color3.FromHexString(obj.props.color||"#AA66EE");
      m.material = mat;
    } else { m = BABYLON.MeshBuilder.CreateSphere(obj.id, { diameter:1 }, scene); }
    meshes.set(obj.id, m);
  }
  m.position.set(obj.props.x||0, obj.props.y||0, obj.props.z||0);
  m.__spin = !!obj.props.spin;
}
scene.onBeforeRenderObservable.add(()=>{ for(const m of meshes.values()) if(m.__spin) m.rotation.y+=0.02; });
function removeMesh(id){const m=meshes.get(id);if(m){m.dispose();meshes.delete(id);}}

scene.onPointerObservable.add(info=>{
  if(info.type!==BABYLON.PointerEventTypes.POINTERDOWN)return;
  const pick=scene.pick(scene.pointerX,scene.pointerY);
  if(pick?.hit&&meshes.has(pick.pickedMesh.id)) socket.emit("objectEvent",{objectId:pick.pickedMesh.id,event:"toggleSpin"});
});

btnDrop.onclick=()=>{ if(window.__lat) socket.emit("invoke",{action:"createBlock",args:{lat:window.__lat,lon:window.__lon}}); };
btnColor.onclick=()=>{ socket.emit("invoke",{action:"assignInterface",args:{uiId:"basic"}}); };
canvas.addEventListener("click", async()=>{await requestDevicePermissions();},{once:true});

navigator.geolocation.watchPosition(p=>{
  const lat=toFix5(p.coords.latitude), lon=toFix5(p.coords.longitude);
  window.__lat=lat; window.__lon=lon;
  socket.emit("gpsUpdate",{lat,lon});
  status.textContent=`You: ${lat},${lon}`;
});

socket.on("welcome",({color})=>{ me.material.diffuseColor=BABYLON.Color3.FromHexString(color); });
socket.on("sceneUpdate",(objs)=>{
  const ids=new Set(objs.map(o=>o.id));
  for(const id of [...meshes.keys()]) if(!ids.has(id)) removeMesh(id);
  for(const o of objs) upsertMesh(o);
});
engine.runRenderLoop(()=>scene.render());
addEventListener("resize",()=>engine.resize());
