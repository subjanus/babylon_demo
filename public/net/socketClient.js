import { Events } from './messages.js';

export function createSocket({ url, on } = {}) {
  const socket = io(url);
  if (on) Object.entries(on).forEach(([evt, fn]) => socket.on(evt, fn));
  return {
    emitGps({lat, lon})      { socket.emit(Events.gpsUpdate, { lat, lon }); },
    emitDrop({lat, lon})     { socket.emit(Events.dropCube, { lat, lon }); },
    emitDiag(sample)         { socket.emit(Events.diagSample, sample); },
    on(evt, fn)              { socket.on(evt, fn); },
    off(evt, fn)             { socket.off(evt, fn); },
    raw: socket
  };
}
