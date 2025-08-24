const { v4: uuid } = require("uuid");

function latLonToLocal(lat, lon, refLat, refLon) {
  const toRad = d => d * Math.PI/180;
  const φ = toRad(refLat);
  const mLat = 111132.92 - 559.82*Math.cos(2*φ) + 1.175*Math.cos(4*φ);
  const mLon = 111412.84*Math.cos(φ) - 93.5*Math.cos(3*φ);
  return { x:(lon-refLon)*mLon, z:(lat-refLat)*mLat };
}

function createBlock(ctx, { lat, lon, size=0.8, color="#AA66EE" }) {
  const id = uuid();
  const { x, z } = latLonToLocal(lat, lon, ctx.ref.lat ?? lat, ctx.ref.lon ?? lon);
  const obj = { id, type:"block", props:{ x, y:0.4, z, size, color } };
  ctx.scene.upsert(obj);
  ctx.broadcastScene();
  return { ok:true, id };
}

function removeObject(ctx, { id }) {
  const existed = ctx.scene.remove(id);
  if (existed) ctx.broadcastScene();
  return { ok:existed };
}

function toggleSpin(ctx, { id }) {
  const obj = ctx.scene.get(id);
  if (!obj) return { ok:false, error:"not_found" };
  obj.props.spin = !obj.props.spin;
  ctx.scene.upsert(obj);
  ctx.broadcastScene();
  return { ok:true, id, spin:obj.props.spin };
}

function assignInterface(ctx, { uiId }, { socket }) {
  socket.emit("uiConfig", { uiId });
  return { ok:true, uiId };
}

const registry = { createBlock, removeObject, toggleSpin, assignInterface };
module.exports = { registry };
