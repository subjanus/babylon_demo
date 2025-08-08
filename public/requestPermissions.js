async function requestGeoPermissions() {
  if (!('geolocation' in navigator)) {
    alert("Geolocation not supported in this browser.");
    return;
  }
  // Best-effort permission preflight (iOS Safari ignores, but harmless)
  try {
    if (navigator.permissions) {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      if (status.state === 'denied') {
        alert("Location permission denied. Enable it in Settings to proceed.");
      }
    }
  } catch (_) {}
}
