// Motion Lab v2: quaternion-aware screenshot-friendly orientation diagnostic.
// Client-only. Does not alter camera behavior; it observes raw sensor values
// and the camera transform so we can diagnose yaw/pitch/roll cross-coupling.

export function createMotionLab({ camera, getComputedState = () => ({}), onStatus = () => {} }) {
  let enabled = false;
  let raf = 0;
  let poseNo = 0;
  let raw = {
    alpha: null, beta: null, gamma: null,
    compass: null, compassAccuracy: null,
    absolute: null, eventType: null, at: null
  };
  const poses = [];

  const root = document.createElement('div');
  root.id = 'motionLabOverlay';
  Object.assign(root.style, {
    position: 'fixed', left: '12px', right: '12px', bottom: '88px',
    zIndex: '2147483646', background: 'rgba(6,10,20,.94)', color: '#eef4ff',
    border: '1px solid #52657d', borderRadius: '14px', padding: '10px 12px',
    font: '13px/1.30 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
    boxShadow: '0 8px 26px rgba(0,0,0,.34)', display: 'none',
    maxHeight: '46vh', overflow: 'auto', pointerEvents: 'auto'
  });

  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: '7px', flexWrap: 'wrap', marginBottom: '7px' });
  root.appendChild(row);

  function button(label, fn) {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, {
      background: '#111827', color: '#e6edf3', border: '1px solid #52657d',
      borderRadius: '9px', padding: '7px 10px', fontSize: '12px'
    });
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
    row.appendChild(b);
    return b;
  }

  const readout = document.createElement('div');
  readout.style.whiteSpace = 'pre-wrap';
  root.appendChild(readout);

  const axes = document.createElement('canvas');
  axes.width = 220; axes.height = 92;
  Object.assign(axes.style, { width: '220px', height: '92px', display: 'block', marginTop: '7px', border: '1px solid #26354a', borderRadius: '8px' });
  root.appendChild(axes);

  document.body.appendChild(root);

  function n(v, digits = 1) { return Number.isFinite(v) ? Number(v).toFixed(digits) : '—'; }
  function deg(rad) { return Number.isFinite(rad) ? rad * 180 / Math.PI : null; }
  function screenInfo() {
    const so = screen.orientation;
    const angle = (typeof window.orientation === 'number') ? window.orientation : (so?.angle ?? 0);
    return { type: so?.type || 'unknown', angle };
  }

  function cameraBasis() {
    try {
      const m = camera.rotationQuaternion
        ? BABYLON.Matrix.FromQuaternion(camera.rotationQuaternion)
        : BABYLON.Matrix.RotationYawPitchRoll(camera.rotation?.y || 0, camera.rotation?.x || 0, camera.rotation?.z || 0);
      const right = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(1,0,0), m).normalize();
      const up = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(0,1,0), m).normalize();
      const forward = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(0,0,1), m).normalize();
      return { right, up, forward };
    } catch (_) { return null; }
  }

  function vec(v) { return v ? `${n(v.x,2)}, ${n(v.y,2)}, ${n(v.z,2)}` : '—'; }

  function drawAxes(basis) {
    const ctx = axes.getContext('2d');
    ctx.clearRect(0,0,axes.width,axes.height);
    ctx.fillStyle = '#08101c'; ctx.fillRect(0,0,axes.width,axes.height);
    ctx.fillStyle = '#aebed2'; ctx.font = '11px ui-monospace,monospace';
    ctx.fillText('camera basis (screen projection)', 8, 14);
    const ox = 110, oy = 55, scale = 34;
    ctx.strokeStyle = '#52657d'; ctx.beginPath(); ctx.arc(ox,oy,2,0,Math.PI*2); ctx.stroke();
    if (!basis) return;
    const items = [
      ['R', basis.right, '#ff6b6b'],
      ['U', basis.up, '#67e8a5'],
      ['F', basis.forward, '#64b5ff']
    ];
    for (const [label,v,color] of items) {
      // Use world x/y as a deliberately simple diagnostic projection.
      const ex = ox + v.x * scale;
      const ey = oy - v.y * scale;
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ox,oy); ctx.lineTo(ex,ey); ctx.stroke();
      ctx.fillText(label, ex + 3, ey - 3);
    }
  }

  function snapshot(label = null) {
    const s = screenInfo();
    const c = getComputedState() || {};
    const basis = cameraBasis();
    const r = camera.rotation || {};
    const qe = camera.rotationQuaternion ? camera.rotationQuaternion.toEulerAngles() : null;
    return {
      label: label || `P${poseNo + 1}`,
      t: Date.now(),
      raw: { ...raw }, screen: s,
      computed: {
        yawDeg: deg(c.localYawRad), pitchDeg: deg(c.localPitchRad), rollDeg: deg(c.localRollRad),
        motionEnabled: !!c.motionEnabled
      },
      cameraDeg: qe ? { x: deg(qe.x), y: deg(qe.y), z: deg(qe.z) } : { x: deg(r.x || 0), y: deg(r.y || 0), z: deg(r.z || 0) },
      quaternion: camera.rotationQuaternion ? { x:camera.rotationQuaternion.x, y:camera.rotationQuaternion.y, z:camera.rotationQuaternion.z, w:camera.rotationQuaternion.w } : null,
      basis: basis ? {
        right: { x:basis.right.x, y:basis.right.y, z:basis.right.z },
        up: { x:basis.up.x, y:basis.up.y, z:basis.up.z },
        forward: { x:basis.forward.x, y:basis.forward.y, z:basis.forward.z }
      } : null
    };
  }

  function markPose() {
    poseNo += 1;
    const p = snapshot(`P${poseNo}`);
    poses.push(p);
    if (poses.length > 20) poses.shift();
    onStatus(`Motion Lab marked ${p.label}`);
    render();
  }

  async function copySummary() {
    const payload = JSON.stringify({ current: snapshot('CURRENT'), poses }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      onStatus('Motion Lab summary copied');
    } catch (_) {
      onStatus('Clipboard blocked; use screenshots');
    }
  }

  function reset() {
    poses.length = 0; poseNo = 0;
    onStatus('Motion Lab poses reset');
    render();
  }

  button('Mark Pose', markPose);
  button('Copy Summary', copySummary);
  button('Reset Poses', reset);

  function render() {
    if (!enabled) return;
    const s = screenInfo();
    const c = getComputedState() || {};
    const r = camera.rotation || {};
    const qe = camera.rotationQuaternion ? camera.rotationQuaternion.toEulerAngles() : null;
    const basis = cameraBasis();
    const last = poses.length ? poses[poses.length - 1].label : 'none';
    readout.textContent =
`MOTION LAB v2   last mark: ${last}   marks: ${poses.length}\n` +
`RAW alpha ${n(raw.alpha)}°   beta ${n(raw.beta)}°   gamma ${n(raw.gamma)}°\n` +
`compass ${n(raw.compass)}°   accuracy ${n(raw.compassAccuracy)}   absolute ${String(raw.absolute ?? '—')}\n` +
`screen ${s.type} @ ${n(s.angle,0)}°   event ${raw.eventType || '—'}\n` +
`CALC yaw ${n(deg(c.localYawRad))}°   pitch ${n(deg(c.localPitchRad))}°   roll ${n(deg(c.localRollRad))}°   motion ${c.motionEnabled ? 'ON':'OFF'}\n` +
`CAM(q) x ${n(deg(qe?.x))}°   y ${n(deg(qe?.y))}°   z ${n(deg(qe?.z))}°\n` +
`QUAT [${n(camera.rotationQuaternion?.x,3)}, ${n(camera.rotationQuaternion?.y,3)}, ${n(camera.rotationQuaternion?.z,3)}, ${n(camera.rotationQuaternion?.w,3)}]\n` +
`UP   [${vec(basis?.up)}]\n` +
`FWD  [${vec(basis?.forward)}]\n` +
`Test: upright ahead → 45°L → 90°L → ahead → 45°R → 90°R; then pitch and roll separately.`;
    drawAxes(basis);
  }

  function loop() { render(); raf = requestAnimationFrame(loop); }

  function onOrientation(ev) {
    raw = {
      alpha: Number.isFinite(ev.alpha) ? ev.alpha : null,
      beta: Number.isFinite(ev.beta) ? ev.beta : null,
      gamma: Number.isFinite(ev.gamma) ? ev.gamma : null,
      compass: Number.isFinite(ev.webkitCompassHeading) ? ev.webkitCompassHeading : null,
      compassAccuracy: Number.isFinite(ev.webkitCompassAccuracy) ? ev.webkitCompassAccuracy : null,
      absolute: typeof ev.absolute === 'boolean' ? ev.absolute : null,
      eventType: ev.type,
      at: Date.now()
    };
  }

  window.addEventListener('deviceorientation', onOrientation, true);
  
  function setEnabled(on) {
    enabled = !!on;
    root.style.display = enabled ? 'block' : 'none';
    if (enabled && !raf) loop();
    if (!enabled && raf) { cancelAnimationFrame(raf); raf = 0; }
    onStatus(enabled ? 'Motion Lab enabled' : 'Motion Lab disabled');
    return enabled;
  }

  return {
    setEnabled,
    isEnabled: () => enabled,
    markPose,
    reset,
    getPoses: () => poses.map(p => structuredClone ? structuredClone(p) : JSON.parse(JSON.stringify(p))),
    getCurrent: () => snapshot('CURRENT')
  };
}
