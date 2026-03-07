const fs = require("fs");
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
let nextObjectId = 1;

const clients = {}; // socketId -> { role, color, yaw, anchorLat, anchorLon, anchorKey, relX, relY, relZ, lastGpsAt }
const worldObjects = {}; // objectId -> world object
const deletedCubesByClient = {};
const socketToObjectIds = {}; // socketId -> Set(objectId)

const TELEMETRY_MAX = 5000;
const telemetry = [];

const AUTH_FILE = path.join(__dirname, "circle-auth.txt");
let circleAuthCue = "circle-auth-demo-change-me";
try {
  const fileCue = fs.readFileSync(AUTH_FILE, "utf8").trim();
  if (fileCue) circleAuthCue = fileCue;
} catch (_) {}

function pushTelemetry(entry) {
  telemetry.push(entry);
  if (telemetry.length > TELEMETRY_MAX) {
    telemetry.splice(0, telemetry.length - TELEMETRY_MAX);
  }
}

function isNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function normalizeAnchor(lat, lon) {
  const aLat = Number(lat);
  const aLon = Number(lon);
  if (!Number.isFinite(aLat) || !Number.isFinite(aLon)) return null;
  return {
    anchorLat: aLat,
    anchorLon: aLon,
    anchorKey: `${aLat.toFixed(6)},${aLon.toFixed(6)}`
  };
}

function sanitizeNumber(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function sanitizeColor(color, fallback = "#00A3FF") {
  const s = String(color || fallback).trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
}

function sanitizedClientView(c) {
  return {
    role: c.role || "player",
    daemonType: c.daemonType || null,
    authed: !!c.authed,
    color: c.color || "#ffffff",
    yaw: isNumber(c.yaw) ? c.yaw : null,
    anchorLat: isNumber(c.anchorLat) ? c.anchorLat : null,
    anchorLon: isNumber(c.anchorLon) ? c.anchorLon : null,
    anchorKey: c.anchorKey || null,
    relX: isNumber(c.relX) ? c.relX : null,
    relY: isNumber(c.relY) ? c.relY : 0,
    relZ: isNumber(c.relZ) ? c.relZ : null,
    lastGpsAt: isNumber(c.lastGpsAt) ? c.lastGpsAt : null
  };
}

function objectToClientView(o) {
  return {
    id: o.id,
    kind: o.kind,
    subtype: o.subtype || null,
    anchorLat: o.anchorLat,
    anchorLon: o.anchorLon,
    anchorKey: o.anchorKey,
    position: { ...o.position },
    rotation: { ...o.rotation },
    scale: { ...o.scale },
    visual: { ...o.visual },
    trigger: o.trigger ? { ...o.trigger } : null,
    ownership: { ...o.ownership },
    state: { ...o.state },
    metadata: { ...o.metadata },
    createdAt: o.createdAt,
    updatedAt: o.updatedAt
  };
}

function droppedBlocksView() {
  return Object.values(worldObjects)
    .filter(o => o.subtype === "droppedCube")
    .map(o => ({
      id: o.id,
      color: o.visual?.color || "#ffffff",
      anchorLat: o.anchorLat,
      anchorLon: o.anchorLon,
      anchorKey: o.anchorKey,
      relX: o.position.x,
      relY: o.position.y,
      relZ: o.position.z,
      lat: o.anchorLat,
      lon: o.anchorLon
    }));
}

function buildWorldState() {
  const clientView = {};
  for (const [id, c] of Object.entries(clients)) clientView[id] = sanitizedClientView(c);
  return {
    clients: clientView,
    worldObjects: Object.values(worldObjects).map(objectToClientView),
    droppedBlocks: droppedBlocksView(),
    worldOrigin: null
  };
}

function emitWorldState() {
  io.emit("worldState", buildWorldState());
}

function makeWorldObject(spec, ownerSocketId, creatorRole = "player") {
  const anchor = normalizeAnchor(spec.anchorLat, spec.anchorLon);
  if (!anchor) return null;

  const kind = String(spec.kind || "box");
  const subtype = spec.subtype ? String(spec.subtype) : null;
  const now = Date.now();
  const id = nextObjectId++;

  const obj = {
    id,
    kind,
    subtype,
    anchorLat: anchor.anchorLat,
    anchorLon: anchor.anchorLon,
    anchorKey: anchor.anchorKey,
    position: {
      x: sanitizeNumber(spec.position?.x),
      y: sanitizeNumber(spec.position?.y),
      z: sanitizeNumber(spec.position?.z)
    },
    rotation: {
      x: sanitizeNumber(spec.rotation?.x),
      y: sanitizeNumber(spec.rotation?.y),
      z: sanitizeNumber(spec.rotation?.z)
    },
    scale: {
      x: Math.min(50, Math.max(0.1, sanitizeNumber(spec.scale?.x, 1))),
      y: Math.min(50, Math.max(0.1, sanitizeNumber(spec.scale?.y, 1))),
      z: Math.min(50, Math.max(0.1, sanitizeNumber(spec.scale?.z, 1)))
    },
    visual: {
      color: sanitizeColor(spec.visual?.color || spec.color || "#00A3FF"),
      label: spec.visual?.label ? String(spec.visual.label).slice(0, 80) : null,
      imageUrl: spec.visual?.imageUrl ? String(spec.visual.imageUrl).slice(0, 400) : null,
      opacity: Math.min(1, Math.max(0.05, sanitizeNumber(spec.visual?.opacity, 1))),
      wireframe: !!spec.visual?.wireframe,
      billboard: !!spec.visual?.billboard
    },
    trigger: spec.trigger && spec.trigger.enabled ? {
      enabled: true,
      type: String(spec.trigger.type || "proximity"),
      radius: Math.min(500, Math.max(0.5, sanitizeNumber(spec.trigger.radius, 5))),
      triggerId: String(spec.trigger.triggerId || `obj-${id}`),
      cooldownMs: Math.min(120000, Math.max(0, sanitizeNumber(spec.trigger.cooldownMs, 2000))),
      oncePerClient: !!spec.trigger.oncePerClient
    } : null,
    ownership: {
      createdBy: ownerSocketId,
      creatorRole
    },
    state: {
      active: spec.state?.active !== false
    },
    metadata: spec.metadata && typeof spec.metadata === "object" ? spec.metadata : {},
    createdAt: now,
    updatedAt: now
  };

  return obj;
}

function addWorldObject(obj) {
  worldObjects[obj.id] = obj;
  if (!socketToObjectIds[obj.ownership.createdBy]) socketToObjectIds[obj.ownership.createdBy] = new Set();
  socketToObjectIds[obj.ownership.createdBy].add(obj.id);
  return obj;
}

function destroyObject(objectId, reason = "destroyed") {
  const obj = worldObjects[objectId];
  if (!obj) return false;
  const ownerSet = socketToObjectIds[obj.ownership.createdBy];
  if (ownerSet) ownerSet.delete(objectId);
  delete worldObjects[objectId];
  pushTelemetry({ t: Date.now(), kind: "objectDestroyed", objectId, reason });
  return true;
}

function isDaemonAuthed(socket) {
  return !!(clients[socket.id]?.role === "daemon" && clients[socket.id]?.authed);
}

function canManageObject(socket, obj) {
  const me = clients[socket.id];
  if (!me) return false;
  if (me.role === "daemon" && me.authed) return obj.ownership.createdBy === socket.id;
  return obj.ownership.createdBy === socket.id && obj.ownership.creatorRole === "player";
}

function distanceRel(a, b) {
  return Math.hypot((a.relX || 0) - (b.x || 0), (a.relZ || 0) - (b.z || 0));
}

const MAX_DELETE_M = 8;
const MAX_OBJECTS_PER_DAEMON = 1200;
const ALLOWED_KINDS = new Set(["box", "sphere", "cylinder", "plane", "billboard", "triggerZone"]);

app.get("/debug/state", (_req, res) => {
  res.json({
    clients: buildWorldState().clients,
    worldObjects: Object.values(worldObjects),
    circleAuthLoaded: !!circleAuthCue,
    authFile: AUTH_FILE
  });
});

app.get("/debug/telemetry", (req, res) => {
  const limit = Math.max(1, Math.min(5000, parseInt(req.query.limit || "500", 10)));
  const filterId = (req.query.id || "").trim();
  const filtered = filterId ? telemetry.filter(e => e.id === filterId || e.socketId === filterId) : telemetry;
  res.json({
    count: telemetry.length,
    filteredCount: filtered.length,
    returned: Math.min(limit, filtered.length),
    filterId: filterId || null,
    telemetry: filtered.slice(-limit)
  });
});

io.on("connection", (socket) => {
  const color = COLORS[nextColorIdx++ % COLORS.length];
  clients[socket.id] = {
    role: "player",
    daemonType: null,
    authed: false,
    color,
    yaw: null,
    anchorLat: null,
    anchorLon: null,
    anchorKey: null,
    relX: null,
    relY: 0,
    relZ: null,
    lastGpsAt: null
  };

  deletedCubesByClient[socket.id] = deletedCubesByClient[socket.id] || 0;
  socket.emit("myCounters", { deletedCubes: deletedCubesByClient[socket.id] });
  socket.emit("worldState", buildWorldState());
  pushTelemetry({ t: Date.now(), id: socket.id, kind: "connect", color });

  socket.on("daemonHello", ({ daemonType, authCue }) => {
    const me = clients[socket.id];
    if (!me) return;
    me.role = "daemon";
    me.daemonType = String(daemonType || "unknown");
    me.authed = String(authCue || "").trim() === circleAuthCue;
    socket.emit("daemonAuthResult", {
      ok: me.authed,
      daemonType: me.daemonType,
      capabilities: me.authed ? ["readWorld", "createObject", "destroyObject", "receiveTriggers"] : []
    });
    pushTelemetry({ t: Date.now(), id: socket.id, kind: "daemonHello", daemonType: me.daemonType, ok: me.authed });
    emitWorldState();
  });

  socket.on("requestWorldSnapshot", () => {
    if (!isDaemonAuthed(socket)) return;
    socket.emit("worldState", buildWorldState());
  });

  socket.on("orientationUpdate", ({ yaw }) => {
    const me = clients[socket.id];
    if (!me) return;
    const y = Number(yaw);
    if (!Number.isFinite(y)) return;
    me.yaw = y;
    emitWorldState();
  });

  socket.on("gpsUpdate", ({ anchorLat, anchorLon, relX, relY, relZ }) => {
    const me = clients[socket.id];
    if (!me) return;
    const anchor = normalizeAnchor(anchorLat, anchorLon);
    if (!anchor) return;
    if (!isNumber(relX) || !isNumber(relZ)) return;

    me.anchorLat = anchor.anchorLat;
    me.anchorLon = anchor.anchorLon;
    me.anchorKey = anchor.anchorKey;
    me.relX = Number(relX);
    me.relY = isNumber(relY) ? Number(relY) : 0;
    me.relZ = Number(relZ);
    me.lastGpsAt = Date.now();

    emitWorldState();
  });

  socket.on("dropCube", ({ anchorLat, anchorLon, relX, relY, relZ }) => {
    const me = clients[socket.id];
    if (!me) return;
    const anchor = normalizeAnchor(anchorLat, anchorLon);
    if (!anchor || !isNumber(relX) || !isNumber(relZ)) return;

    const obj = makeWorldObject({
      kind: "box",
      subtype: "droppedCube",
      anchorLat: anchor.anchorLat,
      anchorLon: anchor.anchorLon,
      position: { x: relX, y: isNumber(relY) ? relY : 0, z: relZ },
      scale: { x: 1, y: 1, z: 1 },
      visual: { color: me.color || "#ffffff" },
      metadata: { source: "playerDrop" }
    }, socket.id, "player");

    addWorldObject(obj);
    pushTelemetry({ t: Date.now(), id: socket.id, kind: "dropCube", objectId: obj.id, anchorKey: obj.anchorKey, relX, relZ });
    emitWorldState();
  });

  socket.on("deleteCube", ({ objectId, blockId }) => {
    const idNum = Number(objectId ?? blockId);
    if (!Number.isFinite(idNum)) {
      socket.emit("deleteResult", { ok: false, objectId: idNum, reason: "bad_id" });
      return;
    }

    const me = clients[socket.id];
    const obj = worldObjects[idNum];
    if (!me || !obj || obj.subtype !== "droppedCube") {
      socket.emit("deleteResult", { ok: false, objectId: idNum, reason: "not_found" });
      return;
    }
    if (!me.anchorKey || me.anchorKey !== obj.anchorKey || !isNumber(me.relX) || !isNumber(me.relZ)) {
      socket.emit("deleteResult", { ok: false, objectId: idNum, reason: "no_position" });
      return;
    }

    const d = distanceRel(me, obj.position);
    if (d > MAX_DELETE_M) {
      socket.emit("deleteResult", { ok: false, objectId: idNum, reason: "too_far", distM: d, maxM: MAX_DELETE_M });
      return;
    }

    destroyObject(idNum, "player_delete");
    deletedCubesByClient[socket.id] = (deletedCubesByClient[socket.id] || 0) + 1;
    socket.emit("myCounters", { deletedCubes: deletedCubesByClient[socket.id] });
    socket.emit("deleteResult", { ok: true, objectId: idNum, distM: d });
    emitWorldState();
  });

  socket.on("toggleColor", () => {
    const me = clients[socket.id];
    if (!me) return;
    const idx = Math.max(0, COLORS.indexOf(me.color));
    me.color = COLORS[(idx + 1) % COLORS.length];
    emitWorldState();
  });

  socket.on("daemonCreateObjectsRequest", ({ objects }) => {
    if (!isDaemonAuthed(socket)) {
      socket.emit("daemonCreateObjectsResult", { ok: false, reason: "not_authed", created: [] });
      return;
    }
    const list = Array.isArray(objects) ? objects : [];
    const owned = socketToObjectIds[socket.id]?.size || 0;
    if (owned + list.length > MAX_OBJECTS_PER_DAEMON) {
      socket.emit("daemonCreateObjectsResult", { ok: false, reason: "too_many_objects", created: [] });
      return;
    }

    const created = [];
    for (const spec of list.slice(0, 300)) {
      const kind = String(spec?.kind || "box");
      if (!ALLOWED_KINDS.has(kind)) continue;
      const obj = makeWorldObject(spec, socket.id, "daemon");
      if (!obj) continue;
      addWorldObject(obj);
      created.push(objectToClientView(obj));
    }

    pushTelemetry({ t: Date.now(), id: socket.id, kind: "daemonCreateObjects", count: created.length });
    socket.emit("daemonCreateObjectsResult", { ok: true, createdCount: created.length, created });
    emitWorldState();
  });

  socket.on("daemonDestroyObjectsRequest", ({ objectIds, ownedOnly }) => {
    if (!isDaemonAuthed(socket)) {
      socket.emit("daemonDestroyObjectsResult", { ok: false, reason: "not_authed", destroyedCount: 0 });
      return;
    }

    const ids = Array.isArray(objectIds) ? objectIds.map(Number).filter(Number.isFinite) : [];
    let destroyedCount = 0;

    if (ownedOnly) {
      for (const id of Array.from(socketToObjectIds[socket.id] || [])) {
        if (destroyObject(id, "daemon_owned_clear")) destroyedCount += 1;
      }
    } else {
      for (const id of ids) {
        const obj = worldObjects[id];
        if (!obj) continue;
        if (obj.ownership.createdBy !== socket.id) continue;
        if (destroyObject(id, "daemon_destroy")) destroyedCount += 1;
      }
    }

    socket.emit("daemonDestroyObjectsResult", { ok: true, destroyedCount });
    emitWorldState();
  });

  socket.on("objectTriggerEvent", (payload) => {
    const me = clients[socket.id];
    if (!me || !payload || typeof payload !== "object") return;
    const objectId = Number(payload.objectId);
    const obj = worldObjects[objectId];
    if (!obj || !obj.trigger || !obj.trigger.enabled) return;
    if (me.anchorKey !== obj.anchorKey) return;

    const event = {
      t: Date.now(),
      triggerId: String(payload.triggerId || obj.trigger.triggerId),
      triggerType: String(payload.triggerType || obj.trigger.type),
      objectId,
      actorId: socket.id,
      actorRole: me.role,
      anchorKey: obj.anchorKey,
      relX: sanitizeNumber(payload.relX),
      relZ: sanitizeNumber(payload.relZ),
      distM: isNumber(payload.distM) ? payload.distM : null
    };

    pushTelemetry({ ...event, kind: "trigger" });
    for (const [id, c] of Object.entries(clients)) {
      if (c.role === "daemon" && c.authed) io.to(id).emit("daemonTrigger", event);
    }
  });

  socket.on("telemetry", (payload) => {
    if (!payload || typeof payload !== "object") return;
    let json = "";
    try { json = JSON.stringify(payload); } catch (_) { return; }
    if (json.length > 8000) return;
    pushTelemetry({ t: Date.now(), id: socket.id, kind: payload.kind || "telemetry", payload });
  });

  socket.on("disconnect", () => {
    for (const id of Array.from(socketToObjectIds[socket.id] || [])) destroyObject(id, "socket_disconnect");
    delete socketToObjectIds[socket.id];
    delete clients[socket.id];
    delete deletedCubesByClient[socket.id];
    pushTelemetry({ t: Date.now(), id: socket.id, kind: "disconnect" });
    emitWorldState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
