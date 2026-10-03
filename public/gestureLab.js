export function createGestureLab({ canvas, camera, scene, onStatus = () => {} }) {
  const config = {
    tapMaxMs: 300,
    longPressMs: 525,
    moveTolerancePx: 12,
    swipeMinPx: 55,
    flickMinVelocity: 700,
    trailPersistMs: 1000,
  };

  let enabled = false;
  let maxSimultaneous = 0;
  let lastGesture = null;
  let cameraWasAttached = true;
  const active = new Map();
  const history = [];

  const overlay = document.createElement('canvas');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', width: '100vw', height: '100vh',
    pointerEvents: 'none', zIndex: '9998', display: 'none'
  });
  document.body.appendChild(overlay);
  const ctx = overlay.getContext('2d');

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed', left: '10px', bottom: '10px', zIndex: '9999',
    width: 'min(92vw, 430px)', maxHeight: '42vh', overflow: 'auto',
    background: 'rgba(7,12,20,.88)', color: '#e6edf3', border: '1px solid #334155',
    borderRadius: '12px', padding: '10px', font: '12px ui-monospace, SFMono-Regular, Menlo, monospace',
    whiteSpace: 'pre-wrap', display: 'none', backdropFilter: 'blur(5px)'
  });
  document.body.appendChild(panel);

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap';
  const panelText = document.createElement('div');
  panel.appendChild(controls);
  panel.appendChild(panelText);

  function makeControl(label, fn) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'width:auto;margin:0;padding:6px 8px;border-radius:8px;border:1px solid #475569;background:#111827;color:#e6edf3;font:11px system-ui';
    b.addEventListener('pointerdown', e => e.stopPropagation());
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); fn(); });
    controls.appendChild(b);
    return b;
  }

  const orientationState = { type: 'unknown', angle: 0, changes: 0, lastChangeAt: null, lockResult: 'not tried' };

  function resizeOverlay() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    overlay.width = Math.round(innerWidth * dpr);
    overlay.height = Math.round(innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resizeOverlay);
  resizeOverlay();

  function readOrientation() {
    const s = screen.orientation;
    orientationState.type = s?.type || (innerWidth > innerHeight ? 'landscape' : 'portrait');
    orientationState.angle = Number.isFinite(s?.angle) ? s.angle : (typeof window.orientation === 'number' ? window.orientation : 0);
    return orientationState;
  }

  function onOrientationChange() {
    const prev = `${orientationState.type}:${orientationState.angle}`;
    readOrientation();
    const now = `${orientationState.type}:${orientationState.angle}`;
    if (prev !== now) {
      orientationState.changes += 1;
      orientationState.lastChangeAt = Date.now();
      renderPanel();
    }
  }
  window.addEventListener('orientationchange', onOrientationChange);
  screen.orientation?.addEventListener?.('change', onOrientationChange);
  readOrientation();

  function pointFromEvent(e) {
    return {
      x: e.clientX, y: e.clientY, t: performance.now(),
      pressure: Number.isFinite(e.pressure) ? e.pressure : null,
      width: Number.isFinite(e.width) ? e.width : null,
      height: Number.isFinite(e.height) ? e.height : null,
    };
  }

  function boundsPressure(samples) {
    const vals = samples.map(s => s.pressure).filter(Number.isFinite);
    if (!vals.length) return { min: null, max: null, delta: null };
    const min = Math.min(...vals), max = Math.max(...vals);
    return { min, max, delta: max - min };
  }

  function classify(p) {
    const a = p.samples[0];
    const b = p.samples[p.samples.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const dur = Math.max(1, b.t - a.t);
    const velocity = dist / dur * 1000;
    const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    let type = 'drag';
    if (dist <= config.moveTolerancePx && dur >= config.longPressMs) type = 'longpress';
    else if (dist <= config.moveTolerancePx && dur <= config.tapMaxMs) type = 'tap';
    else if (dist >= config.swipeMinPx && velocity >= config.flickMinVelocity) type = 'flick';
    else if (dist >= config.swipeMinPx) type = 'swipe';
    const pressure = boundsPressure(p.samples);
    return { type, pointerId: p.pointerId, pointerType: p.pointerType, dx, dy, distance: dist, duration: dur, velocity, angle, samples: p.samples.length, pressure };
  }

  function twoFingerMetrics() {
    const pts = [...active.values()];
    if (pts.length < 2) return null;
    const a = pts[0].samples.at(-1), b = pts[1].samples.at(-1);
    return {
      ids: [pts[0].pointerId, pts[1].pointerId],
      separation: Math.hypot(b.x - a.x, b.y - a.y),
      angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 360) % 360,
      midpoint: { x: (a.x + b.x)/2, y: (a.y + b.y)/2 }
    };
  }

  function renderPanel() {
    if (!enabled) return;
    const lines = [];
    lines.push(`Gesture Lab v2`);
    lines.push(`Active fingers: ${active.size}   Max seen: ${maxSimultaneous}   Device maxTouchPoints: ${navigator.maxTouchPoints || 0}`);
    lines.push(`Orientation: ${orientationState.type} @ ${orientationState.angle}°   changes:${orientationState.changes}`);
    lines.push(`Orientation lock: ${orientationState.lockResult}`);
    for (const p of active.values()) {
      const q = p.samples.at(-1);
      lines.push(`#${p.pointerId} x:${q.x.toFixed(0)} y:${q.y.toFixed(0)} pressure:${Number.isFinite(q.pressure) ? q.pressure.toFixed(2) : '?'} contact:${q.width ?? '?'}x${q.height ?? '?'}`);
    }
    const two = twoFingerMetrics();
    if (two) lines.push(`2-finger separation:${two.separation.toFixed(1)}px angle:${two.angle.toFixed(1)}° midpoint:${two.midpoint.x.toFixed(0)},${two.midpoint.y.toFixed(0)}`);
    if (lastGesture) lines.push(`LAST: ${lastGesture.type.toUpperCase()} #${lastGesture.pointerId} ${lastGesture.angle.toFixed(0)}° ${lastGesture.distance.toFixed(0)}px ${lastGesture.duration.toFixed(0)}ms ${lastGesture.velocity.toFixed(0)}px/s pressure Δ${lastGesture.pressure.delta == null ? '?' : lastGesture.pressure.delta.toFixed(2)}`);
    panelText.textContent = lines.join('\n');
  }

  function drawTrails() {
    if (!enabled) return;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const p of active.values()) {
      const s = p.samples;
      if (!s.length) continue;
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#ffd54a';
      ctx.stroke();
      const q = s.at(-1);
      ctx.beginPath(); ctx.arc(q.x, q.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd54a'; ctx.fill();
      ctx.fillStyle = '#111827'; ctx.font = '12px sans-serif'; ctx.fillText(String(p.pointerId), q.x - 4, q.y + 4);
    }
  }

  function addSamples(p, e) {
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    for (const ce of events.length ? events : [e]) p.samples.push(pointFromEvent(ce));
    if (p.samples.length > 600) p.samples.splice(0, p.samples.length - 600);
  }

  function onDown(e) {
    if (!enabled || e.pointerType === 'mouse') return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    active.set(e.pointerId, { pointerId: e.pointerId, pointerType: e.pointerType, samples: [pointFromEvent(e)] });
    maxSimultaneous = Math.max(maxSimultaneous, active.size);
    drawTrails(); renderPanel();
  }

  function onMove(e) {
    if (!enabled) return;
    const p = active.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    addSamples(p, e);
    drawTrails(); renderPanel();
  }

  function finish(e, cancelled = false) {
    if (!enabled) return;
    const p = active.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    addSamples(p, e);
    const g = classify(p);
    g.cancelled = cancelled;
    g.completedAt = Date.now();
    g.orientation = { ...readOrientation() };
    g.maxSimultaneous = maxSimultaneous;
    lastGesture = g;
    history.push(g);
    if (history.length > 200) history.shift();
    active.delete(e.pointerId);
    drawTrails(); renderPanel();
    setTimeout(() => { if (!active.size) ctx.clearRect(0, 0, innerWidth, innerHeight); }, config.trailPersistMs);
  }

  canvas.addEventListener('pointerdown', onDown, { passive: false });
  canvas.addEventListener('pointermove', onMove, { passive: false });
  canvas.addEventListener('pointerup', e => finish(e, false), { passive: false });
  canvas.addEventListener('pointercancel', e => finish(e, true), { passive: false });

  function setEnabled(v) {
    enabled = !!v;
    overlay.style.display = enabled ? 'block' : 'none';
    panel.style.display = enabled ? 'block' : 'none';
    if (enabled) {
      active.clear();
      maxSimultaneous = 0;
      lastGesture = null;
      try {
        cameraWasAttached = !!camera.inputs?.attached;
        camera.detachControl(canvas);
      } catch (_) {}
      onStatus('Gesture Lab ON: touch camera disabled; phone motion remains active');
      renderPanel();
    } else {
      active.clear();
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      try { camera.attachControl(canvas, true); } catch (_) {}
      onStatus('Gesture Lab OFF: Babylon touch camera restored');
    }
    return enabled;
  }

  async function tryOrientationLock(mode = 'landscape') {
    try {
      if (!screen.orientation?.lock) throw new Error('Screen Orientation lock API unavailable');
      await screen.orientation.lock(mode);
      orientationState.lockResult = `locked: ${mode}`;
    } catch (err) {
      orientationState.lockResult = `blocked: ${err?.name || err?.message || 'error'}`;
    }
    readOrientation(); renderPanel();
    return orientationState.lockResult;
  }

  async function unlockOrientation() {
    try { screen.orientation?.unlock?.(); orientationState.lockResult = 'unlocked'; }
    catch (err) { orientationState.lockResult = `unlock failed: ${err?.name || 'error'}`; }
    readOrientation(); renderPanel();
    return orientationState.lockResult;
  }

  makeControl('Try Landscape Lock', () => tryOrientationLock('landscape'));
  makeControl('Unlock Orientation', () => unlockOrientation());
  makeControl('Reset Counters', () => { history.length = 0; maxSimultaneous = active.size; lastGesture = null; renderPanel(); });

  const api = {
    setEnabled,
    isEnabled: () => enabled,
    getHistory: () => history.slice(),
    getConfig: () => ({ ...config }),
    getState: () => ({ enabled, activeFingers: active.size, maxSimultaneous, maxTouchPoints: navigator.maxTouchPoints || 0, orientation: { ...orientationState }, lastGesture }),
    tryOrientationLock,
    unlockOrientation,
    reset: () => { history.length = 0; maxSimultaneous = active.size; lastGesture = null; renderPanel(); },
  };
  window.__gestureLab = api;
  return api;
}
