const state = { blocks: [] }; // {lat, lon}
exports.add = (lat, lon) => (state.blocks.push({lat, lon}), state.blocks);
exports.list = () => state.blocks;
