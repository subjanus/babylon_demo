export function ema(alpha = 0.25) {
  let state = null;
  return (sample) => {
    if (!state) { state = sample; return state; }
    state = {
      lat: state.lat + alpha * (sample.lat - state.lat),
      lon: state.lon + alpha * (sample.lon - state.lon),
      acc: sample.acc
    };
    return state;
  };
}
