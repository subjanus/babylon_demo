// Client-side gesture diagnostic harness.
// Purpose: measure real mobile-browser input before assigning game semantics.

export function createGestureLab({ canvas, scene, isBlocked = () => false } = {}) {
  if (!canvas) throw new Error('createGestureLab requires a canvas');

  const cfg = {
    tapMaxMs: 300,
    longPressMs: 525,
    stationaryPx: 12,
    dragStartPx: 14,
    swipeMinPx: 55,
    flickMinPx: 35,
    flickMinPxPerMs: 0.75,
    historySize: 8
  };

  let enabled = false;
  let active = null;
  let longPressTimer = null;
  const history = [];

  const overlay = document.createElement('canvas');
  overlay.id = 'gestureLabOverlay';
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', width: '100vw', height: '100vh',
    pointerEvents: 'none', zIndex: '40', display: 'none'
  });
  document.body.appendChild(overlay);

  const panel = document.createElement('div');
  panel.id = 'gestureLabPanel';
  Object.assign(panel.style, {
    position: 'fixed', left: '10px', bottom: '10px', zIndex: '41',
    maxWidth: 'min(92vw, 430px)', padding: '9px 11px', borderRadius: '12px',
    background: '#071018e8', border: '1px solid #334155', color: '#e6edf3',
    font: '12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
    whiteSpace: 'pre-wrap', pointerEvents: 'none', display: 'none'
  });
  document.body.appendChild(panel);

  function fitOverlay() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    overlay.width = Math.round(window.innerWidth * dpr);
    overlay.height = Math.round(window.innerHeight * dpr);
    const ctx = overlay.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  fitOverlay();
  window.addEventListener('resize', fitOverlay);

  function clearOverlay() {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  function renderPath() {
    clearOverlay();
    if (!enabled || !active || active.points.length < 1) return;
    const ctx = overlay.getContext('2d');
    const pts = active.points;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(34,211,238,0.9)';
    ctx.fillStyle = 'rgba(255,204,0,0.95)';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  function meshLabelFromPointer(ev) {
    if (!scene) return 'none';
    try {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const pick = scene.pick(x, y);
      if (!pick?.hit || !pick.pickedMesh) return 'none';
      const m = pick.pickedMesh;
      const md = m.metadata || {};
      if (md.kind === 'worldObject' && md.objectId != null) return `worldObject#${md.objectId}`;
      if (md.kind === 'playerPointer') return `player:${String(md.socketId || '').slice(-4)}`;
      return m.name || md.kind || 'mesh';
    } catch (_) {
      return 'pick-error';
    }
  }

  function pointFromEvent(ev) {
    return {
      x: ev.clientX,
      y: ev.clientY,
      t: performance.now(),
      pressure: Number.isFinite(ev.pressure) ? ev.pressure : null,
      width: Number.isFinite(ev.width) ? ev.width : null,
      height: Number.isFinite(ev.height) ? ev.height : null
    };
  }

  function pushPointsFromEvent(ev) {
    const events = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [ev];
    for (const e of events) active.points.push(pointFromEvent(e));
    const p = active.points[active.points.length - 1];
    if (p.pressure != null) {
      active.pressureMin = Math.min(active.pressureMin, p.pressure);
      active.pressureMax = Math.max(active.pressureMax, p.pressure);
    }
    if (p.width != null) active.widthMax = Math.max(active.widthMax, p.width);
    if (p.height != null) active.heightMax = Math.max(active.heightMax, p.height);
  }

  function distFromStart() {
    if (!active || active.points.length < 2) return 0;
    const a = active.points[0];
    const b = active.points[active.points.length - 1];
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function direction8(angleDeg) {
    const names = ['E','SE','S','SW','W','NW','N','NE'];
    const i = Math.round((((angleDeg % 360) + 360) % 360) / 45) % 8;
    return names[i];
  }

  function classify(endT) {
    const pts = active.points;
    const a = pts[0];
    const b = pts[pts.length - 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    const durationMs = Math.max(1, endT - active.startT);
    const velocity = distance / durationMs;
    const angleDeg = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;

    let type = 'drag';
    if (active.longPressFired && distance <= cfg.stationaryPx) type = 'longpress';
    else if (distance <= cfg.stationaryPx && durationMs <= cfg.tapMaxMs) type = 'tap';
    else if (distance >= cfg.flickMinPx && velocity >= cfg.flickMinPxPerMs) type = 'flick';
    else if (distance >= cfg.swipeMinPx) type = 'swipe';
    else if (durationMs >= cfg.longPressMs && distance <= cfg.stationaryPx) type = 'longpress';

    return {
      type,
      dx, dy, distance, durationMs, velocity, angleDeg,
      direction8: direction8(angleDeg),
      pointerType: active.pointerType,
      target: active.target,
      pressureMin: Number.isFinite(active.pressureMin) ? active.pressureMin : null,
      pressureMax: Number.isFinite(active.pressureMax) ? active.pressureMax : null,
      pressureRange: Number.isFinite(active.pressureMin) && Number.isFinite(active.pressureMax)
        ? active.pressureMax - active.pressureMin : null,
      contactWidthMax: active.widthMax || null,
      contactHeightMax: active.heightMax || null,
      sampleCount: pts.length
    };
  }

  function fmt(n, digits = 1) {
    return Number.isFinite(n) ? n.toFixed(digits) : '?';
  }

  function renderPanel(current = null) {
    if (!enabled) return;
    const c = current || history[0];
    if (!c) {
      panel.textContent = 'GESTURE LAB — touch the world\nwaiting for input…';
      return;
    }
    const pressure = c.pressureMin == null
      ? 'n/a'
      : `${fmt(c.pressureMin,2)}–${fmt(c.pressureMax,2)} Δ${fmt(c.pressureRange,2)}`;
    panel.textContent = [
      `GESTURE LAB  ${String(c.type).toUpperCase()}  ${c.direction8 || ''}`,
      `angle ${fmt(c.angleDeg)}°  distance ${fmt(c.distance)}px  time ${fmt(c.durationMs,0)}ms`,
      `speed ${fmt(c.velocity,3)}px/ms  samples ${c.sampleCount ?? '?'}`,
      `pointer ${c.pointerType || '?'}  pressure ${pressure}`,
      `contact ≤ ${fmt(c.contactWidthMax)}×${fmt(c.contactHeightMax)}px`,
      `target ${c.target || 'none'}`
    ].join('\n');
  }

  function onPointerDown(ev) {
    if (!enabled || active || isBlocked(ev)) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;

    const p = pointFromEvent(ev);
    active = {
      id: ev.pointerId,
      pointerType: ev.pointerType || 'unknown',
      startT: performance.now(),
      points: [p],
      target: meshLabelFromPointer(ev),
      longPressFired: false,
      dragStarted: false,
      pressureMin: p.pressure == null ? Infinity : p.pressure,
      pressureMax: p.pressure == null ? -Infinity : p.pressure,
      widthMax: p.width || 0,
      heightMax: p.height || 0
    };

    try { canvas.setPointerCapture(ev.pointerId); } catch (_) {}
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      if (!active || active.id !== ev.pointerId) return;
      if (distFromStart() <= cfg.stationaryPx) {
        active.longPressFired = true;
        const preview = classify(performance.now());
        preview.type = 'longpress';
        renderPanel(preview);
      }
    }, cfg.longPressMs);
    renderPath();
  }

  function onPointerMove(ev) {
    if (!enabled || !active || active.id !== ev.pointerId) return;
    pushPointsFromEvent(ev);
    if (distFromStart() > cfg.stationaryPx) clearTimeout(longPressTimer);
    if (distFromStart() >= cfg.dragStartPx) active.dragStarted = true;
    renderPath();

    const pts = active.points;
    const a = pts[0], b = pts[pts.length - 1];
    const durationMs = Math.max(1, performance.now() - active.startT);
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const angleDeg = ((Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI) + 360) % 360;
    renderPanel({
      type: active.dragStarted ? 'dragging' : 'tracking',
      angleDeg, distance, durationMs, velocity: distance / durationMs,
      direction8: direction8(angleDeg), pointerType: active.pointerType,
      target: active.target, pressureMin: active.pressureMin, pressureMax: active.pressureMax,
      pressureRange: active.pressureMax - active.pressureMin,
      contactWidthMax: active.widthMax, contactHeightMax: active.heightMax,
      sampleCount: pts.length
    });
  }

  function finish(ev, cancelled = false) {
    if (!active || active.id !== ev.pointerId) return;
    clearTimeout(longPressTimer);
    pushPointsFromEvent(ev);
    const result = classify(performance.now());
    if (cancelled) result.type = 'cancel';
    history.unshift(result);
    if (history.length > cfg.historySize) history.length = cfg.historySize;
    renderPanel(result);
    try { canvas.releasePointerCapture(ev.pointerId); } catch (_) {}
    active = null;
    setTimeout(() => { if (!active) clearOverlay(); }, 500);
  }

  canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
  canvas.addEventListener('pointermove', onPointerMove, { passive: true });
  canvas.addEventListener('pointerup', ev => finish(ev, false), { passive: true });
  canvas.addEventListener('pointercancel', ev => finish(ev, true), { passive: true });
  canvas.addEventListener('contextmenu', ev => { if (enabled) ev.preventDefault(); });

  function setEnabled(value) {
    enabled = !!value;
    overlay.style.display = enabled ? 'block' : 'none';
    panel.style.display = enabled ? 'block' : 'none';
    if (!enabled) {
      clearTimeout(longPressTimer);
      active = null;
      clearOverlay();
    }
    renderPanel();
    return enabled;
  }

  return {
    setEnabled,
    toggle: () => setEnabled(!enabled),
    isEnabled: () => enabled,
    getHistory: () => history.slice(),
    getConfig: () => ({ ...cfg })
  };
}
