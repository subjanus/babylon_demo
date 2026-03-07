const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { path: "/socket.io" });

const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.use(express.static(PUBLIC_DIR));
app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

const COLORS = ["#00A3FF", "#FFCC00", "#34D399", "#F472B6", "#F59E0B", "#22D3EE", "#A78BFA"];
let nextColorIdx = 0;

const clients = {};   // id -> { x, z, yaw, color, anchorId, refLat, refLon, accuracyM, lastPoseAt }
const objects = [];   // dynamic world objects
const daemons = {};   // id -> { label, capabilities, connectedAt }
const deletedObjectsByClient = {};
let nextObjectId = 1;

const TELEMETRY_MAX = 5000;
const telemetry = [];
const MAX_DELETE_M = 8;

function pushTelemetry(entry) {
  telemetry.push(entry);
  if (telemetry.length > TELEMETRY_MAX) telemetry.splice(0, telemetry.length - TELEMETRY_MAX);
}

function isNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function distXZ(a, b) {
  return Math.hypot((b.x || 0) - (a.x || 0), (b.z || 0) - (a.z || 0));
}

function metersPerDeg(refLat) {
  const φ = refLat * Math.PI / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * φ) + 1.175 * Math.cos(4 * φ),
    lon: 111412.84 * Math.cos(φ) - 93.5 * Math.cos(3 * φ)
  };
}

function localToLatLon(x, z, refLat, refLon) {
  const m = metersPerDeg(refLat);
  return {
    lat: refLat - ((Number(z) || 0) / m.lat),
    lon: refLon + ((Number(x) || 0) / m.lon)
  };
}

function distanceRelative(a, b) {
  const aRefLat = isNumber(a.refLat) ? a.refLat : 0;
  const aRefLon = isNumber(a.refLon) ? a.refLon : 0;
  const bRefLat = isNumber(b.refLat) ? b.refLat : 0;
  const bRefLon = isNumber(b.refLon) ? b.refLon : 0;
  const aWorld = localToLatLon(a.x, a.z, aRefLat, aRefLon);
  const bWorld = localToLatLon(b.x, b.z, bRefLat, bRefLon);
  const avgLat = (aWorld.lat + bWorld.lat) / 2;
  const m = metersPerDeg(avgLat);
  const dx = (bWorld.lon - aWorld.lon) * m.lon;
  const dz = (aWorld.lat - bWorld.lat) * m.lat;
  return Math.hypot(dx, dz);
}

function getVisibleClients() {
  const out = {};
  for (const [id, c] of Object.entries(clients)) {
    out[id] = {
      x: c.x,
      z: c.z,
      y: c.y || 0,
      yaw: c.yaw || 0,
      color: c.color,
      anchorId: c.anchorId || "private-anchor",
      refLat: c.refLat ?? 0,
      refLon: c.refLon ?? 0,
      accuracyM: c.accuracyM ?? null,
      lastPoseAt: c.lastPoseAt || null,
      isDaemon: false
    };
  }
  return out;
}

function getVisibleObjects() {
  return objects.map(o => ({ ...o }));
}

function emitWorldState() {
  io.emit("worldState", {
    clients: getVisibleClients(),
    objects: getVisibleObjects(),
    daemons: Object.values(daemons).map(d => ({ label: d.label, connectedAt: d.connectedAt })),
    serverTime: Date.now()
  });
}

function sanitizeObject(input, fallbackOwner) {
  if (!input || typeof input !== "object") return null;
  const type = String(input.type || "cube");
  const x = Number(input.x);
  const z = Number(input.z);
  if (!isNumber(x) || !isNumber(z)) return null;

  const y = isNumber(Number(input.y)) ? Number(input.y) : (type === "disc" ? -1 : -1);
  const trigger = input.trigger && typeof input.trigger === "object"
    ? {
        kind: String(input.trigger.kind || "none"),
        radius: isNumber(Number(input.trigger.radius)) ? clamp(Number(input.trigger.radius), 0.5, 500) : null,
        cooldownMs: isNumber(Number(input.trigger.cooldownMs)) ? clamp(Number(input.trigger.cooldownMs), 0, 600000) : 0
      }
    : null;

  return {
    id: nextObjectId++,
    type,
    x,
    y,
    z,
    rotY: isNumber(Number(input.rotY)) ? Number(input.rotY) : 0,
    scale: {
      x: isNumber(Number(input.scale?.x)) ? Number(input.scale.x) : 1,
      y: isNumber(Number(input.scale?.y)) ? Number(input.scale.y) : 1,
      z: isNumber(Number(input.scale?.z)) ? Number(input.scale.z) : 1
    },
    style: {
      color: typeof input.style?.color === "string" ? input.style.color : "#34D399",
      alpha: isNumber(Number(input.style?.alpha)) ? clamp(Number(input.style.alpha), 0.05, 1) : 1
    },
    trigger,
    owner: String(input.owner || fallbackOwner || "user"),
    anchorId: typeof input.anchorId === "string" ? input.anchorId.slice(0, 64) : "private-anchor",
    refLat: isNumber(Number(input.refLat)) ? clamp(Number(input.refLat), -90, 90) : 0,
    refLon: isNumber(Number(input.refLon)) ? clamp(Number(input.refLon), -180, 180) : 0,
    ttlMs: isNumber(Number(input.ttlMs)) ? clamp(Number(input.ttlMs), 0, 86400000) : 0,
    createdAt: Date.now()
  };
}

function destroyExpiredObjects() {
  const now = Date.now();
  let changed = false;
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const o = objects[i];
    if (o.ttlMs > 0 && now - o.createdAt >= o.ttlMs) {
      objects.splice(i, 1);
      changed = true;
    }
  }
  if (changed) emitWorldState();
}
setInterval(destroyExpiredObjects, 1000);

app.get("/debug/state", (_req, res) => {
  res.json({ clients: getVisibleClients(), objects: getVisibleObjects(), daemons, serverTime: Date.now() });
});

app.get("/debug/telemetry", (req, res) => {
  const limit = Math.max(1, Math.min(5000, parseInt(req.query.limit || "500", 10)));
  const filterId = (req.query.id || "").trim();
  const filtered = filterId ? telemetry.filter(e => e.id === filterId) : telemetry;
  res.json(filtered.slice(-limit));
});

io.on("connection", (socket) => {
  const color = COLORS[nextColorIdx % COLORS.length];
  nextColorIdx += 1;

  clients[socket.id] = { x: 0, y: -5, z: 0, yaw: 0, color, anchorId: "private-anchor", refLat: 0, refLon: 0, accuracyM: null, lastPoseAt: null };
  deletedObjectsByClient[socket.id] = 0;
  socket.emit("myCounters", { deletedCubes: 0, deletedObjects: 0 });
  pushTelemetry({ t: Date.now(), id: socket.id, kind: "connect", color });
  emitWorldState();

  socket.on("poseUpdate", (payload = {}) => {
    const me = clients[socket.id];
    if (!me) return;

    const x = Number(payload.x);
    const z = Number(payload.z);
    if (!isNumber(x) || !isNumber(z)) return;

    me.x = clamp(x, -50000, 50000);
    me.z = clamp(z, -50000, 50000);
    me.y = isNumber(Number(payload.y)) ? clamp(Number(payload.y), -5000, 5000) : -5;
    if (isNumber(Number(payload.yaw))) me.yaw = Number(payload.yaw);
    me.anchorId = typeof payload.anchorId === "string" ? payload.anchorId.slice(0, 64) : "private-anchor";
    me.refLat = isNumber(Number(payload.refLat)) ? clamp(Number(payload.refLat), -90, 90) : 0;
    me.refLon = isNumber(Number(payload.refLon)) ? clamp(Number(payload.refLon), -180, 180) : 0;
    me.accuracyM = isNumber(Number(payload.accuracyM)) ? clamp(Number(payload.accuracyM), 0, 10000) : null;
    me.lastPoseAt = Date.now();

    pushTelemetry({ t: Date.now(), id: socket.id, kind: "poseUpdate", x: me.x, z: me.z, anchorId: me.anchorId, refLat: me.refLat, refLon: me.refLon, accuracyM: me.accuracyM });
    emitWorldState();
  });

  socket.on("orientationUpdate", ({ yaw } = {}) => {
    const me = clients[socket.id];
    if (!me || !isNumber(yaw)) return;
    me.yaw = yaw;
    emitWorldState();
  });

  socket.on("createObjectRequest", ({ object } = {}) => {
    const me = clients[socket.id];
    if (!me) return;
    const safe = sanitizeObject({ ...object, anchorId: object?.anchorId || me.anchorId, refLat: object?.refLat ?? me.refLat, refLon: object?.refLon ?? me.refLon }, `player:${socket.id}`);
    if (!safe) return;
    objects.push(safe);
    pushTelemetry({ t: Date.now(), id: socket.id, kind: "createObjectRequest", objectId: safe.id, type: safe.type });
    emitWorldState();
  });

  socket.on("destroyObjectRequest", ({ objectId } = {}) => {
    const idNum = Number(objectId);
    if (!Number.isFinite(idNum)) {
      socket.emit("deleteResult", { ok: false, objectId, reason: "bad_id" });
      return;
    }
    const idx = objects.findIndex(o => o.id === idNum);
    if (idx === -1) {
      socket.emit("deleteResult", { ok: false, objectId: idNum, reason: "not_found" });
      return;
    }

    const me = clients[socket.id];
    const obj = objects[idx];
    if (!me) {
      socket.emit("deleteResult", { ok: false, objectId: idNum, reason: "no_pose" });
      return;
    }

    const d = distanceRelative(me, obj);
    if (d > MAX_DELETE_M) {
      socket.emit("deleteResult", { ok: false, objectId: idNum, reason: "too_far", distM: d, maxM: MAX_DELETE_M });
      return;
    }

    objects.splice(idx, 1);
    deletedObjectsByClient[socket.id] = (deletedObjectsByClient[socket.id] || 0) + 1;
    socket.emit("myCounters", { deletedCubes: deletedObjectsByClient[socket.id], deletedObjects: deletedObjectsByClient[socket.id] });
    socket.emit("deleteResult", { ok: true, objectId: idNum, distM: d });
    pushTelemetry({ t: Date.now(), id: socket.id, kind: "destroyObjectRequest", objectId: idNum, distM: d });
    emitWorldState();
  });

  socket.on("toggleColor", () => {
    const me = clients[socket.id];
    if (!me) return;
    const idx = Math.max(0, COLORS.indexOf(me.color));
    me.color = COLORS[(idx + 1) % COLORS.length];
    pushTelemetry({ t: Date.now(), id: socket.id, kind: "toggleColor", color: me.color });
    emitWorldState();
  });

  socket.on("daemonAuth", (payload = {}) => {
    daemons[socket.id] = {
      label: String(payload.label || "helper-daemon").slice(0, 80),
      capabilities: Array.isArray(payload.capabilities) ? payload.capabilities.slice(0, 20) : [],
      connectedAt: Date.now()
    };
    pushTelemetry({ t: Date.now(), id: socket.id, kind: "daemonAuth", label: daemons[socket.id].label });
    socket.emit("daemonReady", { ok: true, label: daemons[socket.id].label });
    emitWorldState();
  });

  socket.on("daemonCreateObject", ({ object } = {}) => {
    if (!daemons[socket.id]) return;
    const safe = sanitizeObject(object, `daemon:${daemons[socket.id].label}`);
    if (!safe) return;
    objects.push(safe);
    pushTelemetry({ t: Date.now(), id: socket.id, kind: "daemonCreateObject", objectId: safe.id, type: safe.type });
    emitWorldState();
  });

  socket.on("daemonDestroyObject", ({ objectId } = {}) => {
    if (!daemons[socket.id]) return;
    const idNum = Number(objectId);
    if (!Number.isFinite(idNum)) return;
    const idx = objects.findIndex(o => o.id === idNum);
    if (idx === -1) return;
    objects.splice(idx, 1);
    pushTelemetry({ t: Date.now(), id: socket.id, kind: "daemonDestroyObject", objectId: idNum });
    emitWorldState();
  });

  socket.on("clearCircles", () => {
    if (!daemons[socket.id]) return;
    let removed = 0;
    for (let i = objects.length - 1; i >= 0; i -= 1) {
      const o = objects[i];
      if (o.type === "disc" && String(o.owner || "").startsWith(`daemon:${daemons[socket.id].label}`)) {
        objects.splice(i, 1);
        removed += 1;
      }
    }
    socket.emit("spawnCirclesResult", { totalAdded: 0, removed, targets: [] });
    emitWorldState();
  });

  socket.on("spawnCircles", ({ count, radius, targetId } = {}) => {
    if (!daemons[socket.id]) return;

    const all = Object.entries(clients).filter(([id]) => id !== socket.id);
    const now = Date.now();
    const fresh = all.filter(([, c]) => isNumber(c.lastPoseAt) && now - c.lastPoseAt <= 15000);
    let targets = [];

    if (targetId === "*") targets = fresh;
    else if (targetId === "**") targets = all;
    else if (targetId && clients[targetId]) targets = [[targetId, clients[targetId]]];
    else if (fresh.length > 0) targets = [fresh[0]];
    else if (all.length > 0) targets = [all[0]];

    const totalCount = clamp(Number(count) || 0, 1, 400);
    const spread = clamp(Number(radius) || 0, 5, 500);
    const addedIds = [];

    for (const [id, c] of targets) {
      for (let i = 0; i < totalCount; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * spread;
        const safe = sanitizeObject({
          type: "disc",
          x: c.x + Math.cos(angle) * r,
          y: -1,
          z: c.z + Math.sin(angle) * r,
          scale: { x: 1 + Math.random() * 1.6, y: 0.25, z: 1 + Math.random() * 1.6 },
          style: { color: "#34D399", alpha: 0.8 },
          trigger: { kind: "proximity", radius: 2.5 },
          owner: `daemon:${daemons[socket.id].label}:target:${id}`,
          anchorId: c.anchorId || "private-anchor",
          refLat: c.refLat ?? 0,
          refLon: c.refLon ?? 0
        }, `daemon:${daemons[socket.id].label}`);
        if (!safe) continue;
        objects.push(safe);
        addedIds.push(safe.id);
      }
    }

    pushTelemetry({ t: Date.now(), id: socket.id, kind: "spawnCircles", totalAdded: addedIds.length, targetId });
    socket.emit("spawnCirclesResult", {
      totalAdded: addedIds.length,
      firstId: addedIds[0] || null,
      lastId: addedIds[addedIds.length - 1] || null,
      targets: targets.map(([id]) => id)
    });
    emitWorldState();
  });

  socket.on("telemetry", (payload) => {
    if (!payload || typeof payload !== "object") return;
    let json = "";
    try { json = JSON.stringify(payload); } catch (_) { return; }
    if (json.length > 8000) return;
    pushTelemetry({ t: Date.now(), id: socket.id, kind: payload.kind || "telemetry", payload });
  });

  socket.on("disconnect", () => {
    delete clients[socket.id];
    delete daemons[socket.id];
    delete deletedObjectsByClient[socket.id];
    pushTelemetry({ t: Date.now(), id: socket.id, kind: "disconnect" });
    emitWorldState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
