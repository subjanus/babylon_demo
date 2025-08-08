const state = { clients: {} };
exports.update = (id, lat, lon) => (state.clients[id] = { lat, lon }, state.clients);
exports.remove = (id) => (delete state.clients[id], state.clients);
exports.all = () => state.clients;
