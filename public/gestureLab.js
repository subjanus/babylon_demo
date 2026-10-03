export function createGestureLab({ canvas, camera, scene, onStatus = () => {} }) {
  const config = {
    tapMaxMs: 300,
    longPressMs: 525,
    moveTolerancePx: 12,
    swipeMinPx: 55,
    flickMinVelocity: 700,
    stationaryPx: 14,
    trailPersistMs: 1200,
  };

  let enabled = false;
  let maxSimultaneous = 0;
  let lastGesture = null;
  let lastSession = null;
  let session = null;
  const active = new Map();
  const history = [];
  const fingerTransitions = [];

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
    width: 'min(94vw, 470px)', maxHeight: '46vh', overflow: 'auto',
    background: 'rgba(7,12,20,.9)', color: '#e6edf3', border: '1px solid #334155',
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

  const orientationState = {
    type: 'unknown', angle: 0, changes: 0, lastChangeAt: null,
    note: 'Use the phone Control Center orientation lock if needed.'
  };

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

  function displacement(samples) {
    if (!samples?.length) return 0;
    const a = samples[0], b = samples.at(-1);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function pathLength(samples) {
    let d = 0;
    for (let i = 1; i < samples.length; i++) d += Math.hypot(samples[i].x - samples[i-1].x, samples[i].y - samples[i-1].y);
    return d;
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
    return {
      type, pointerId: p.pointerId, pointerType: p.pointerType,
      dx, dy, distance: dist, pathLength: pathLength(p.samples), duration: dur,
      velocity, angle, samples: p.samples.length, pressure
    };
  }

  function activePoints() {
    return [...active.values()].map(p => ({ p, q: p.samples.at(-1) }));
  }

  function centroid(points = activePoints()) {
    if (!points.length) return null;
    const x = points.reduce((s, x) => s + x.q.x, 0) / points.length;
    const y = points.reduce((s, x) => s + x.q.y, 0) / points.length;
    return { x, y };
  }

  function twoFingerMetrics() {
    const pts = activePoints();
    if (pts.length < 2) return null;
    const a = pts[0], b = pts[1];
    return {
      ids: [a.p.pointerId, b.p.pointerId],
      separation: Math.hypot(b.q.x - a.q.x, b.q.y - a.q.y),
      angle: (Math.atan2(b.q.y - a.q.y, b.q.x - a.q.x) * 180 / Math.PI + 360) % 360,
      midpoint: { x: (a.q.x + b.q.x) / 2, y: (a.q.y + b.q.y) / 2 }
    };
  }

  function motionSummary() {
    const pts = activePoints();
    if (!pts.length) return null;
    let stationary = 0, moving = 0;
    const states = [];
    for (const { p } of pts) {
      const d = displacement(p.samples);
      const isStationary = d <= config.stationaryPx;
      if (isStationary) stationary++; else moving++;
      states.push({ pointerId: p.pointerId, displacement: d, stationary: isStationary });
    }
    return { stationary, moving, states };
  }

  function beginSessionIfNeeded() {
    if (session) return;
    session = {
      startedAt: Date.now(),
      maxFingers: 0,
      pointerIds: new Set(),
      transitions: [],
      centroidStart: null,
      centroidEnd: null,
      twoFingerStart: null,
      twoFingerEnd: null,
      completedGestures: []
    };
  }

  function noteTransition(reason) {
    const rec = { t: Date.now(), active: active.size, reason };
    fingerTransitions.push(rec);
    if (fingerTransitions.length > 100) fingerTransitions.shift();
    if (session) session.transitions.push(rec);
  }

  function updateSessionMetrics() {
    if (!session) return;
    session.maxFingers = Math.max(session.maxFingers, active.size);
    for (const id of active.keys()) session.pointerIds.add(id);
    const c = centroid();
    if (c && !session.centroidStart) session.centroidStart = { ...c };
    if (c) session.centroidEnd = { ...c };
    const two = twoFingerMetrics();
    if (two && !session.twoFingerStart) session.twoFingerStart = { ...two, midpoint: { ...two.midpoint } };
    if (two) session.twoFingerEnd = { ...two, midpoint: { ...two.midpoint } };
  }

  function finishSessionIfNeeded() {
    if (!session || active.size) return;
    const endedAt = Date.now();
    const summary = {
      startedAt: session.startedAt,
      endedAt,
      durationMs: endedAt - session.startedAt,
      maxFingers: session.maxFingers,
      pointerIds: [...session.pointerIds],
      transitions: session.transitions.slice(),
      centroidStart: session.centroidStart,
      centroidEnd: session.centroidEnd,
      centroidTravel: (session.centroidStart && session.centroidEnd)
        ? Math.hypot(session.centroidEnd.x - session.centroidStart.x, session.centroidEnd.y - session.centroidStart.y)
        : null,
      twoFingerStart: session.twoFingerStart,
      twoFingerEnd: session.twoFingerEnd,
      twoFingerSeparationDelta: (session.twoFingerStart && session.twoFingerEnd)
        ? session.twoFingerEnd.separation - session.twoFingerStart.separation : null,
      twoFingerRotationDelta: (session.twoFingerStart && session.twoFingerEnd)
        ? ((session.twoFingerEnd.angle - session.twoFingerStart.angle + 540) % 360) - 180 : null,
      completedGestures: session.completedGestures.slice(),
      orientation: { ...readOrientation() }
    };
    lastSession = summary;
    history.push({ kind: 'session', ...summary });
    if (history.length > 200) history.shift();
    session = null;
  }

  function renderPanel() {
    if (!enabled) return;
    const lines = [];
    lines.push(`Gesture Lab v3`);
    lines.push(`Active fingers: ${active.size}   Max seen: ${maxSimultaneous}   Device maxTouchPoints: ${navigator.maxTouchPoints || 0}`);
    lines.push(`Orientation: ${orientationState.type} @ ${orientationState.angle}°   changes:${orientationState.changes}`);
    lines.push(`Orientation lock: use phone control`);

    const c = centroid();
    const motion = motionSummary();
    if (c) lines.push(`${active.size}-finger centroid: ${c.x.toFixed(0)},${c.y.toFixed(0)}   stationary:${motion.stationary} moving:${motion.moving}`);

    for (const p of active.values()) {
      const q = p.samples.at(-1);
      const d = displacement(p.samples);
      lines.push(`#${p.pointerId} x:${q.x.toFixed(0)} y:${q.y.toFixed(0)} move:${d.toFixed(0)}px pressure:${Number.isFinite(q.pressure) ? q.pressure.toFixed(2) : '?'} contact:${q.width ?? '?'}x${q.height ?? '?'}`);
    }

    const two = twoFingerMetrics();
    if (two) lines.push(`2-finger separation:${two.separation.toFixed(1)}px angle:${two.angle.toFixed(1)}° midpoint:${two.midpoint.x.toFixed(0)},${two.midpoint.y.toFixed(0)}`);

    if (lastGesture) lines.push(`LAST FINGER: ${lastGesture.type.toUpperCase()} #${lastGesture.pointerId} ${lastGesture.angle.toFixed(0)}° ${lastGesture.distance.toFixed(0)}px ${lastGesture.duration.toFixed(0)}ms ${lastGesture.velocity.toFixed(0)}px/s pressure Δ${lastGesture.pressure.delta == null ? '?' : lastGesture.pressure.delta.toFixed(2)}`);

    if (lastSession) {
      lines.push(`LAST SESSION: max:${lastSession.maxFingers} fingers  ${lastSession.durationMs}ms  centroid travel:${lastSession.centroidTravel == null ? '?' : lastSession.centroidTravel.toFixed(0) + 'px'}`);
      if (lastSession.twoFingerSeparationDelta != null) lines.push(`  pinch/spread Δ:${lastSession.twoFingerSeparationDelta.toFixed(1)}px  rotation Δ:${lastSession.twoFingerRotationDelta.toFixed(1)}°`);
      const seq = lastSession.transitions.map(t => t.active).join('→');
      if (seq) lines.push(`  finger-count sequence: ${seq}`);
    }

    panelText.textContent = lines.join('\n');
  }

  function drawTrails() {
    if (!enabled) return;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const colors = ['#ffd54a', '#6ee7ff', '#a7f3d0', '#f9a8d4', '#c4b5fd'];
    let i = 0;
    for (const p of active.values()) {
      const s = p.samples;
      if (!s.length) continue;
      const color = colors[i++ % colors.length];
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      for (let j = 1; j < s.length; j++) ctx.lineTo(s[j].x, s[j].y);
      ctx.lineWidth = 6;
      ctx.strokeStyle = color;
      ctx.stroke();
      const q = s.at(-1);
      ctx.beginPath(); ctx.arc(q.x, q.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.fillStyle = '#111827'; ctx.font = '12px sans-serif'; ctx.fillText(String(p.pointerId), q.x - 4, q.y + 4);
    }
    const c = centroid();
    if (c && active.size > 1) {
      ctx.beginPath(); ctx.arc(c.x, c.y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c.x - 12, c.y); ctx.lineTo(c.x + 12, c.y); ctx.moveTo(c.x, c.y - 12); ctx.lineTo(c.x, c.y + 12); ctx.stroke();
    }
  }

  function addSamples(p, e) {
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    for (const ce of events.length ? events : [e]) p.samples.push(pointFromEvent(ce));
    if (p.samples.length > 800) p.samples.splice(0, p.samples.length - 800);
  }

  function onDown(e) {
    if (!enabled || e.pointerType === 'mouse') return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    beginSessionIfNeeded();
    active.set(e.pointerId, { pointerId: e.pointerId, pointerType: e.pointerType, samples: [pointFromEvent(e)] });
    maxSimultaneous = Math.max(maxSimultaneous, active.size);
    noteTransition('down');
    updateSessionMetrics();
    drawTrails(); renderPanel();
  }

  function onMove(e) {
    if (!enabled) return;
    const p = active.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    addSamples(p, e);
    updateSessionMetrics();
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
    history.push({ kind: 'finger', ...g });
    if (history.length > 200) history.shift();
    if (session) session.completedGestures.push(g);
    active.delete(e.pointerId);
    noteTransition(cancelled ? 'cancel' : 'up');
    updateSessionMetrics();
    finishSessionIfNeeded();
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
      lastSession = null;
      session = null;
      try { camera.detachControl(canvas); } catch (_) {}
      onStatus('Gesture Lab ON: touch camera disabled; phone motion remains active');
      renderPanel();
    } else {
      active.clear();
      session = null;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      try { camera.attachControl(canvas, true); } catch (_) {}
      onStatus('Gesture Lab OFF: Babylon touch camera restored');
    }
    return enabled;
  }

  async function copySummary() {
    const summary = {
      gestureLab: 'v3',
      maxTouchPoints: navigator.maxTouchPoints || 0,
      maxSimultaneous,
      orientation: { ...orientationState },
      lastGesture,
      lastSession,
      recentTransitions: fingerTransitions.slice(-20)
    };
    const text = JSON.stringify(summary, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      onStatus('Gesture Lab summary copied');
    } catch (_) {
      onStatus('Clipboard copy blocked; use screenshot instead');
    }
    return text;
  }

  makeControl('Phone Lock: use Control Center', () => onStatus('Use the iPhone/Android system orientation lock; browser lock is unreliable here.'));
  makeControl('Copy Summary', () => copySummary());
  makeControl('Reset Counters', () => {
    history.length = 0;
    fingerTransitions.length = 0;
    maxSimultaneous = active.size;
    lastGesture = null;
    lastSession = null;
    session = null;
    renderPanel();
  });

  const api = {
    setEnabled,
    isEnabled: () => enabled,
    getHistory: () => history.slice(),
    getConfig: () => ({ ...config }),
    getState: () => ({
      enabled,
      activeFingers: active.size,
      maxSimultaneous,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      orientation: { ...orientationState },
      lastGesture,
      lastSession,
      recentTransitions: fingerTransitions.slice(-20)
    }),
    copySummary,
    reset: () => {
      history.length = 0;
      fingerTransitions.length = 0;
      maxSimultaneous = active.size;
      lastGesture = null;
      lastSession = null;
      session = null;
      renderPanel();
    },
  };

  window.__gestureLab = api;
  return api;
}
