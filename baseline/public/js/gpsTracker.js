let history = [];
const WINDOW = 5;  // moving-average window

export function startGps(onUpdate) {
  navigator.geolocation.watchPosition(pos => {
    history.push({ lat: pos.coords.latitude, lon: pos.coords.longitude });
    if (history.length > WINDOW) history.shift();
    // compute average
    const avg = history.reduce((acc,p) => ({
      lat: acc.lat + p.lat/WINDOW,
      lon: acc.lon + p.lon/WINDOW
    }), {lat:0,lon:0});
    onUpdate(+avg.lat.toFixed(5), +avg.lon.toFixed(5));
  }, e => console.warn(e), { enableHighAccuracy:true });
}

