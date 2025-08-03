import io from '/socket.io/socket.io.js';

const socket = io();

export function onClientList(fn)   { socket.on('clientListUpdate', fn); }
export function onGpsUpdate(fn)     { socket.on('updateClientPosition', fn); }
export function onDroppedCube(fn)   { socket.on('droppedCube', fn); }

export function emitGps(lat, lon)   { socket.emit('gpsUpdate', { lat, lon }); }
export function emitDrop(lat, lon)  { socket.emit('dropCube',   { lat, lon }); }

