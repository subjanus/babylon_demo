const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { path: '/socket.io', cors: { origin: '*' } });

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/circles', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'circles.html')));
app.get('/debug', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'debug.html')));

const COLORS = ['#00A3FF', '#FFCC00', '#34D399', '#F472B6', '#F59E0B', '#22D3EE', '#A78BFA'];
let nextColorIdx = 0;
let nextObjectId = 1;

const peers = {};          // socketId -> peer state
const worldObjects = {};   // objectId -> object state
const telemetry = [];
const triggerLog = [];
const TELEMETRY_MAX = 5000;
const TRIGGER_LOG_MAX = 200;
const INTERACT_RANGE_M = 10;

function now() { return Date.now(); }
function isNumber(n) { return typeof n === 'number' && Number.isFinite(n); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function distance2d(a, b) {
  if (!a || !b) return Infinity;
  if (!isNumber(a.x) || !isNumber(a.z) || !isNumber(b.x) || !isNumber(b.z)) return Infinity;
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function pushTelemetry(entry) {
  telemetry.push(entry);
  if (telemetry.length > TELEMETRY_MAX) telemetry.splice(0, telemetry.length - TELEMETRY_MAX);
}

function pushTrigger(entry) {
  triggerLog.push(entry);
  if (triggerLog.length > TRIGGER_LOG_MAX) triggerLog.splice(0, triggerLog.length - TRIGGER_LOG_MAX);
}

function createObjectRecord(input, ownerId) {
  const objectId = String(nextObjectId++);
  const kind = String(input?.kind || input?.type || 'box');
  const pos = input?.position || {};
  const rot = input?.rotation || {};
  const scale = input?.scale || {};
  const trigger = input?.trigger && typeof input.trigger === 'object' ? input.trigger : null;

  return {
    id: objectId,
    ownerId,
    createdAt: now(),
    updatedAt: now(),
    kind,
    position: {
      x: isNumber(pos.x) ? pos.x : 0,
      y: isNumber(pos.y) ? pos.y : 0,
      z: isNumber(pos.z) ? pos.z : 0
    },
    rotation: {
      x: isNumber(rot.x) ? rot.x : 0,
      y: isNumber(rot.y) ? rot.y : 0,
      z: isNumber(rot.z) ? rot.z : 0
    },
    scale: {
      x: isNumber(scale.x) ? scale.x : 1,
      y: isNumber(scale.y) ? scale.y : 1,
      z: isNumber(scale.z) ? scale.z : 1
    },
    color: typeof input?.color === 'string' ? input.color : '#ffffff',
    textureUrl: typeof input?.textureUrl === 'string' ? input.textureUrl : null,
    billboard: !!input?.billboard,
    label: typeof input?.label === 'string' ? input.label : null,
    tags: Array.isArray(input?.tags) ? input.tags.slice(0, 20).map(String) : [],
    props: input?.props && typeof input.props === 'object' ? input.props : {},
    trigger
  };
}

function updateObjectRecord(target, patch) {
  if (!target || !patch || typeof patch !== 'object') return target;
  if (typeof patch.kind === 'string') target.kind = patch.kind;
  if (typeof patch.color === 'string') target.color = patch.color;
  if (typeof patch.textureUrl === 'string' || patch.textureUrl === null) target.textureUrl = patch.textureUrl;
  if (typeof patch.billboard === 'boolean') target.billboard = patch.billboard;
  if (typeof patch.label === 'string' || patch.label === null) target.label = patch.label;
  if (Array.isArray(patch.tags)) target.tags = patch.tags.slice(0, 20).map(String);
  if (patch.props && typeof patch.props === 'object') target.props = { ...target.props, ...patch.props };
  if (patch.trigger === null) target.trigger = null;
  else if (patch.trigger && typeof patch.trigger === 'object') target.trigger = patch.trigger;

  for (const key of ['position', 'rotation', 'scale']) {
    const src = patch[key];
    if (src && typeof src === 'object') {
      for (const axis of ['x', 'y', 'z']) {
        if (isNumber(src[axis])) target[key][axis] = src[axis];
      }
    }
  }

  target.updatedAt = now();
  return target;
}

function emitWorldState() {
  io.emit('worldState', {
    peers,
    worldObjects,
    worldConfig: {
      units: 'meters',
      privacyMode: 'client_private_anchor',
      interactRangeM: INTERACT_RANGE_M
    },
    triggerLog: triggerLog.slice(-20)
  });
}

function peerSummary(peer) {
  return peer ? {
    id: peer.id,
    role: peer.role,
    daemonType: peer.daemonType,
    label: peer.label,
    x: peer.x,
    y: peer.y,
    z: peer.z,
    yaw: peer.yaw,
    color: peer.color,
    updatedAt: peer.updatedAt
  } : null;
}

app.get('/debug/state', (_req, res) => {
  res.json({
    peers,
    worldObjects,
    worldConfig: { units: 'meters', privacyMode: 'client_private_anchor', interactRangeM: INTERACT_RANGE_M },
    triggerLog: triggerLog.slice(-50)
  });
});

app.get('/debug/telemetry', (req, res) => {
  const limit = clamp(parseInt(req.query.limit || '500', 10) || 500, 1, 5000);
  const filterId = String(req.query.id || '').trim();
  const filtered = filterId ? telemetry.filter(entry => entry.id === filterId) : telemetry;
  res.json({
    count: telemetry.length,
    filteredCount: filtered.length,
    returned: Math.min(limit, filtered.length),
    filterId: filterId || null,
    telemetry: filtered.slice(-limit)
  });
});

io.on('connection', (socket) => {
  const role = socket.handshake.auth?.role === 'daemon' ? 'daemon' : 'player';
  const daemonType = typeof socket.handshake.auth?.daemonType === 'string' ? socket.handshake.auth.daemonType : null;
  const label = typeof socket.handshake.auth?.label === 'string' ? socket.handshake.auth.label.slice(0, 80) : null;
  const color = COLORS[nextColorIdx++ % COLORS.length];

  peers[socket.id] = {
    id: socket.id,
    role,
    daemonType,
    label,
    color,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    updatedAt: now()
  };

  pushTelemetry({ t: now(), id: socket.id, kind: 'connect', role, daemonType, label });
  socket.emit('welcome', { id: socket.id, role, color });
  emitWorldState();

  socket.on('positionUpdate', (payload = {}) => {
    const peer = peers[socket.id];
    if (!peer) return;

    if (isNumber(payload.x)) peer.x = payload.x;
    if (isNumber(payload.y)) peer.y = payload.y;
    if (isNumber(payload.z)) peer.z = payload.z;
    if (isNumber(payload.yaw)) peer.yaw = payload.yaw;
    peer.updatedAt = now();

    pushTelemetry({
      t: now(),
      id: socket.id,
      kind: 'positionUpdate',
      role: peer.role,
      x: peer.x,
      y: peer.y,
      z: peer.z,
      yaw: peer.yaw,
      source: payload.source || null,
      accuracyM: isNumber(payload.accuracyM) ? payload.accuracyM : null
    });

    emitWorldState();
  });

  socket.on('orientationUpdate', (payload = {}) => {
    const peer = peers[socket.id];
    if (!peer || !isNumber(payload.yaw)) return;
    peer.yaw = payload.yaw;
    peer.updatedAt = now();
    emitWorldState();
  });

  socket.on('toggleColor', () => {
    const peer = peers[socket.id];
    if (!peer) return;
    const idx = Math.max(0, COLORS.indexOf(peer.color));
    peer.color = COLORS[(idx + 1) % COLORS.length];
    pushTelemetry({ t: now(), id: socket.id, kind: 'toggleColor', color: peer.color });
    emitWorldState();
  });

  socket.on('createObject', (payload = {}, ack) => {
    const peer = peers[socket.id];
    if (!peer || !payload || typeof payload !== 'object') return;
    const record = createObjectRecord(payload, socket.id);
    worldObjects[record.id] = record;
    pushTelemetry({ t: now(), id: socket.id, kind: 'createObject', objectId: record.id, objectKind: record.kind });
    emitWorldState();
    if (typeof ack === 'function') ack({ ok: true, objectId: record.id });
  });

  socket.on('updateObject', ({ objectId, patch } = {}, ack) => {
    const record = worldObjects[String(objectId || '')];
    if (!record) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'not_found' });
      return;
    }
    updateObjectRecord(record, patch);
    pushTelemetry({ t: now(), id: socket.id, kind: 'updateObject', objectId: record.id });
    emitWorldState();
    if (typeof ack === 'function') ack({ ok: true, objectId: record.id });
  });

  socket.on('destroyObject', ({ objectId } = {}, ack) => {
    const record = worldObjects[String(objectId || '')];
    if (!record) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'not_found' });
      return;
    }
    delete worldObjects[record.id];
    pushTelemetry({ t: now(), id: socket.id, kind: 'destroyObject', objectId: record.id });
    emitWorldState();
    if (typeof ack === 'function') ack({ ok: true, objectId: record.id });
  });

  socket.on('interactObject', ({ objectId, triggerId, payload } = {}, ack) => {
    const record = worldObjects[String(objectId || '')];
    const peer = peers[socket.id];
    if (!record || !peer) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'not_found' });
      return;
    }

    const d = distance2d(peer, record.position);
    if (d > INTERACT_RANGE_M) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'too_far', distM: d, maxM: INTERACT_RANGE_M });
      return;
    }

    const event = {
      t: now(),
      objectId: record.id,
      triggerId: triggerId || record.trigger?.id || null,
      sourcePeerId: socket.id,
      sourcePeerRole: peer.role,
      distM: d,
      payload: payload && typeof payload === 'object' ? payload : null,
      object: {
        id: record.id,
        kind: record.kind,
        label: record.label,
        trigger: record.trigger,
        position: record.position,
        props: record.props
      }
    };

    pushTrigger(event);
    pushTelemetry({ t: now(), id: socket.id, kind: 'interactObject', objectId: record.id, triggerId: event.triggerId, distM: d });
    io.emit('triggerEvent', event);
    if (typeof ack === 'function') ack({ ok: true, triggerId: event.triggerId, objectId: record.id, distM: d });
  });

  socket.on('dropCube', ({ x, z, color } = {}, ack) => {
    const peer = peers[socket.id];
    if (!peer) return;
    const record = createObjectRecord({
      kind: 'box',
      color: typeof color === 'string' ? color : peer.color,
      position: { x: isNumber(x) ? x : peer.x, y: -1, z: isNumber(z) ? z : peer.z },
      scale: { x: 2, y: 2, z: 2 },
      label: 'Dropped Cube',
      tags: ['legacy', 'dropCube'],
      trigger: { id: 'cube.touch', mode: 'proximity' },
      props: { deletable: true }
    }, socket.id);
    worldObjects[record.id] = record;
    pushTelemetry({ t: now(), id: socket.id, kind: 'dropCube', objectId: record.id, x: record.position.x, z: record.position.z });
    emitWorldState();
    if (typeof ack === 'function') ack({ ok: true, objectId: record.id });
  });

  socket.on('deleteObject', ({ objectId } = {}, ack) => {
    const record = worldObjects[String(objectId || '')];
    const peer = peers[socket.id];
    if (!record || !peer) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'not_found' });
      return;
    }
    const d = distance2d(peer, record.position);
    if (d > INTERACT_RANGE_M) {
      if (typeof ack === 'function') ack({ ok: false, reason: 'too_far', distM: d, maxM: INTERACT_RANGE_M });
      return;
    }
    delete worldObjects[record.id];
    pushTelemetry({ t: now(), id: socket.id, kind: 'deleteObject', objectId: record.id, distM: d });
    emitWorldState();
    if (typeof ack === 'function') ack({ ok: true, objectId: record.id, distM: d });
  });

  socket.on('requestWorldState', (_payload, ack) => {
    const snapshot = {
      peers,
      worldObjects,
      worldConfig: { units: 'meters', privacyMode: 'client_private_anchor', interactRangeM: INTERACT_RANGE_M },
      triggerLog: triggerLog.slice(-20)
    };
    if (typeof ack === 'function') ack(snapshot);
    else socket.emit('worldState', snapshot);
  });

  socket.on('telemetry', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    let json = '';
    try { json = JSON.stringify(payload); } catch (_err) { return; }
    if (json.length > 8000) return;
    pushTelemetry({ t: now(), id: socket.id, kind: payload.kind || 'telemetry', payload });
  });

  socket.on('disconnect', () => {
    pushTelemetry({ t: now(), id: socket.id, kind: 'disconnect' });
    delete peers[socket.id];
    emitWorldState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
