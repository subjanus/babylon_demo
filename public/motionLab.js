// Motion Lab v3: orientation-state, physical-pose, and sensor-freshness diagnostics.
// Client-only. It observes the working motion engine; it does not change camera math.

export function createMotionLab({ camera, getComputedState = () => ({}), onStatus = () => {} }) {
  let enabled = false;
  let raf = 0;
  let poseNo = 0;
  let raw = {
    alpha: null, beta: null, gamma: null,
    compass: null, compassAccuracy: null,
    absolute: null, eventType: null, at: null
  };
  let motion = {
    ax: null, ay: null, az: null,
    gx: null, gy: null, gz: null,
    at: null, eventCount: 0
  };
  let lastViewport = { w: innerWidth, h: innerHeight, at: Date.now() };
  let lastScreenChangeAt = 0;
  let localScreenChangeCount = 0;
  const poses = [];

  const root = document.createElement('div');
  root.id = 'motionLabOverlay';
  Object.assign(root.style, {
    position: 'fixed', left: '10px', right: '10px', bottom: '76px',
    zIndex: '2147483646', background: 'rgba(6,10,20,.95)', color: '#eef4ff',
    border: '1px solid #52657d', borderRadius: '14px', padding: '9px 11px',
    font: '12px/1.28 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
    boxShadow: '0 8px 26px rgba(0,0,0,.34)', display: 'none',
    maxHeight: '55vh', overflow: 'auto', pointerEvents: 'auto'
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
  function age(t) { return Number.isFinite(t) && t > 0 ? Math.max(0, Date.now() - t) : null; }
  function ageTxt(t) {
    const a = age(t);
    if (!Number.isFinite(a)) return '—';
    if (a < 1000) return `${Math.round(a)}ms`;
    return `${(a/1000).toFixed(1)}s`;
  }
  function screenInfo() {
    const so = screen.orientation;
    const angle = Number.isFinite(so?.angle) ? so.angle : (typeof window.orientation === 'number' ? window.orientation : 0);
    const viewportOrientation = innerWidth >= innerHeight ? 'landscape' : 'portrait';
    return { type: so?.type || 'unknown', angle: ((Number(angle)%360)+360)%360, viewportOrientation, w: innerWidth, h: innerHeight };
  }

  // Quaternion-vector rotate without relying on Matrix.FromQuaternion, which is
  // not present in every Babylon build.
  function rotateVecByQuat(v, q) {
    if (!q) return v.clone();
    const ux=q.x, uy=q.y, uz=q.z, s=q.w;
    const dotUV = ux*v.x + uy*v.y + uz*v.z;
    const dotUU = ux*ux + uy*uy + uz*uz;
    const cx = uy*v.z - uz*v.y;
    const cy = uz*v.x - ux*v.z;
    const cz = ux*v.y - uy*v.x;
    return new BABYLON.Vector3(
      2*dotUV*ux + (s*s-dotUU)*v.x + 2*s*cx,
      2*dotUV*uy + (s*s-dotUU)*v.y + 2*s*cy,
      2*dotUV*uz + (s*s-dotUU)*v.z + 2*s*cz
    );
  }

  function cameraBasis() {
    try {
      if (camera.rotationQuaternion) {
        return {
          right: rotateVecByQuat(new BABYLON.Vector3(1,0,0), camera.rotationQuaternion).normalize(),
          up: rotateVecByQuat(new BABYLON.Vector3(0,1,0), camera.rotationQuaternion).normalize(),
          forward: rotateVecByQuat(new BABYLON.Vector3(0,0,1), camera.rotationQuaternion).normalize()
        };
      }
      const m = BABYLON.Matrix.RotationYawPitchRoll(camera.rotation?.y || 0, camera.rotation?.x || 0, camera.rotation?.z || 0);
      return {
        right: BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(1,0,0), m).normalize(),
        up: BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(0,1,0), m).normalize(),
        forward: BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(0,0,1), m).normalize()
      };
    } catch (_) { return null; }
  }

  function vec(v) { return v ? `${n(v.x,2)}, ${n(v.y,2)}, ${n(v.z,2)}` : '—'; }

  function physicalPose() {
    // accelerationIncludingGravity is the cleanest browser-level clue to the
    // handset's physical portrait/landscape posture. We intentionally call this
    // "*-like" because browsers do not expose the iOS Orientation Lock switch.
    const x = motion.gx, y = motion.gy, z = motion.gz;
    if (![x,y,z].every(Number.isFinite)) return { pose:'unknown', confidence:0, detail:'gravity unavailable' };
    const xy = Math.hypot(x,y);
    if (Math.abs(z) > xy * 1.25) return { pose:'flat-like', confidence: Math.min(1, Math.abs(z)/9.8), detail:`g=${n(x,1)},${n(y,1)},${n(z,1)}` };
    const ax = Math.abs(x), ay = Math.abs(y);
    const denom = Math.max(0.01, ax+ay);
    const confidence = Math.abs(ax-ay)/denom;
    if (ay >= ax) return { pose:'portrait-like', confidence, detail:`g=${n(x,1)},${n(y,1)},${n(z,1)}` };
    return { pose:'landscape-like', confidence, detail:`g=${n(x,1)},${n(y,1)},${n(z,1)}` };
  }

  function orientationMismatch(s, p) {
    if (!p.pose.endsWith('-like')) return false;
    const physical = p.pose.startsWith('landscape') ? 'landscape' : p.pose.startsWith('portrait') ? 'portrait' : null;
    return physical && physical !== s.viewportOrientation && p.confidence > 0.18;
  }

  function drawAxes(basis) {
    const ctx = axes.getContext('2d');
    ctx.clearRect(0,0,axes.width,axes.height);
    ctx.fillStyle = '#08101c'; ctx.fillRect(0,0,axes.width,axes.height);
    ctx.fillStyle = '#aebed2'; ctx.font = '11px ui-monospace,monospace';
    ctx.fillText('camera basis (screen projection)', 8, 14);
    const ox = 110, oy = 55, scale = 34;
    ctx.strokeStyle = '#52657d'; ctx.beginPath(); ctx.arc(ox,oy,2,0,Math.PI*2); ctx.stroke();
    if (!basis) return;
    const items = [['R',basis.right,'#ff6b6b'],['U',basis.up,'#67e8a5'],['F',basis.forward,'#64b5ff']];
    for (const [label,v,color] of items) {
      const ex = ox + v.x * scale, ey = oy - v.y * scale;
      ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(ox,oy); ctx.lineTo(ex,ey); ctx.stroke();
      ctx.fillText(label,ex+3,ey-3);
    }
  }

  function snapshot(label = null) {
    const s=screenInfo(), c=getComputedState()||{}, basis=cameraBasis(), p=physicalPose();
    const r=camera.rotation||{}, qe=camera.rotationQuaternion ? camera.rotationQuaternion.toEulerAngles() : null;
    return {
      label:label||`P${poseNo+1}`, t:Date.now(), raw:{...raw}, deviceMotion:{...motion}, screen:s,
      physical:p, inferredOrientationLockMismatch:!!orientationMismatch(s,p),
      freshness:{orientationMs:age(raw.at), motionMs:age(motion.at), compassMs:age(c.motionStats?.lastCompassAt), appliedMs:age(c.motionStats?.lastAppliedAt)},
      computed:{yawDeg:deg(c.localYawRad),pitchDeg:deg(c.localPitchRad),rollDeg:deg(c.localRollRad),motionEnabled:!!c.motionEnabled,motionStats:c.motionStats||null},
      cameraDeg:qe?{x:deg(qe.x),y:deg(qe.y),z:deg(qe.z)}:{x:deg(r.x||0),y:deg(r.y||0),z:deg(r.z||0)},
      quaternion:camera.rotationQuaternion?{x:camera.rotationQuaternion.x,y:camera.rotationQuaternion.y,z:camera.rotationQuaternion.z,w:camera.rotationQuaternion.w}:null,
      basis:basis?{right:{x:basis.right.x,y:basis.right.y,z:basis.right.z},up:{x:basis.up.x,y:basis.up.y,z:basis.up.z},forward:{x:basis.forward.x,y:basis.forward.y,z:basis.forward.z}}:null
    };
  }

  function markPose(){poseNo+=1;const p=snapshot(`P${poseNo}`);poses.push(p);if(poses.length>30)poses.shift();onStatus(`Motion Lab marked ${p.label}`);render();}
  async function copySummary(){const payload=JSON.stringify({current:snapshot('CURRENT'),poses},null,2);try{await navigator.clipboard.writeText(payload);onStatus('Motion Lab summary copied');}catch(_){onStatus('Clipboard blocked; use screenshots');}}
  function reset(){poses.length=0;poseNo=0;onStatus('Motion Lab poses reset');render();}

  button('Mark Pose',markPose); button('Copy Summary',copySummary); button('Reset Poses',reset);

  function render(){
    if(!enabled)return;
    const s=screenInfo(), c=getComputedState()||{}, qe=camera.rotationQuaternion?camera.rotationQuaternion.toEulerAngles():null;
    const basis=cameraBasis(), p=physicalPose(), mismatch=orientationMismatch(s,p), stats=c.motionStats||{};
    const last=poses.length?poses[poses.length-1].label:'none';
    const status = mismatch ? 'MISMATCH (orientation lock likely / viewport held)' : 'matched';
    readout.textContent=
`MOTION LAB v3   last mark: ${last}   marks: ${poses.length}\n`+
`VIEW ${s.viewportOrientation} ${s.w}x${s.h}   screen ${s.type} @ ${n(s.angle,0)}°\n`+
`PHYS ${p.pose} conf ${n(p.confidence,2)}   ${status}\n`+
`RAW alpha ${n(raw.alpha)}°   beta ${n(raw.beta)}°   gamma ${n(raw.gamma)}°\n`+
`compass ${n(raw.compass)}°   accuracy ${n(raw.compassAccuracy)}   absolute ${String(raw.absolute??'—')}\n`+
`FRESH orient ${ageTxt(raw.at)}   compass ${ageTxt(stats.lastCompassAt)}   motion ${ageTxt(motion.at)}   applied ${ageTxt(stats.lastAppliedAt)}\n`+
`COUNTS orient ${stats.orientationEventCount??'—'}   screen changes ${stats.screenChangeCount??localScreenChangeCount}\n`+
`CALC yaw ${n(deg(c.localYawRad))}°   pitch ${n(deg(c.localPitchRad))}°   roll ${n(deg(c.localRollRad))}°   motion ${c.motionEnabled?'ON':'OFF'}\n`+
`CAM(q) x ${n(deg(qe?.x))}°   y ${n(deg(qe?.y))}°   z ${n(deg(qe?.z))}°\n`+
`UP  [${vec(basis?.up)}]   FWD [${vec(basis?.forward)}]\n`+
`Test A unlocked: rotate portrait↔landscape; Test B locked: rotate physically and watch VIEW vs PHYS.`;
    drawAxes(basis);
  }

  function loop(){render();raf=requestAnimationFrame(loop);}

  function onOrientation(ev){raw={alpha:Number.isFinite(ev.alpha)?ev.alpha:null,beta:Number.isFinite(ev.beta)?ev.beta:null,gamma:Number.isFinite(ev.gamma)?ev.gamma:null,compass:Number.isFinite(ev.webkitCompassHeading)?ev.webkitCompassHeading:null,compassAccuracy:Number.isFinite(ev.webkitCompassAccuracy)?ev.webkitCompassAccuracy:null,absolute:typeof ev.absolute==='boolean'?ev.absolute:null,eventType:ev.type,at:Date.now()};}
  function onMotion(ev){const a=ev.acceleration||{},g=ev.accelerationIncludingGravity||{};motion={ax:Number.isFinite(a.x)?a.x:null,ay:Number.isFinite(a.y)?a.y:null,az:Number.isFinite(a.z)?a.z:null,gx:Number.isFinite(g.x)?g.x:null,gy:Number.isFinite(g.y)?g.y:null,gz:Number.isFinite(g.z)?g.z:null,at:Date.now(),eventCount:(motion.eventCount||0)+1};}
  function onViewportChange(){lastViewport={w:innerWidth,h:innerHeight,at:Date.now()};localScreenChangeCount+=1;lastScreenChangeAt=Date.now();render();}

  window.addEventListener('deviceorientation',onOrientation,true);
  window.addEventListener('devicemotion',onMotion,true);
  window.addEventListener('resize',onViewportChange,true);
  window.addEventListener('orientationchange',onViewportChange,true);
  if(screen.orientation&&typeof screen.orientation.addEventListener==='function')screen.orientation.addEventListener('change',onViewportChange);

  function setEnabled(on){enabled=!!on;root.style.display=enabled?'block':'none';if(enabled&&!raf)loop();if(!enabled&&raf){cancelAnimationFrame(raf);raf=0;}onStatus(enabled?'Motion Lab v3 enabled':'Motion Lab disabled');return enabled;}

  return {setEnabled,isEnabled:()=>enabled,markPose,reset,getPoses:()=>JSON.parse(JSON.stringify(poses)),getCurrent:()=>snapshot('CURRENT')};
}
