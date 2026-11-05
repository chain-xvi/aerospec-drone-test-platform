/* =========================================================
   AEROSPEC — DRONE MANUFACTURING TEST PLATFORM
   Industrial HMI console for airframe certification:
   open-jet wind tunnel, speed stress runs, structural load
   mapping and endurance draw-down — plus a fleet dashboard.

   Data flow:
     js/data.js      specs + physics + run store
     js/scene.js     renderer / bay / tunnel / materials
     js/drones.js    procedural airframes + stress mapping
     js/particles.js flow field
     js/sims.js      test-program director (source of truth)
     js/hud.js       gauges / chart / terminal
     js/dashboard.js dashboard view
   ========================================================= */
import * as THREE from 'three';
import { buildScene, MATS } from './js/scene.js';
import { buildDrone } from './js/drones.js';
import { FlowField } from './js/particles.js';
import { SimDirector } from './js/sims.js';
import { AIRFRAMES, TESTS, loadRuns, saveRun, purgeRuns, rpmAt, clamp } from './js/data.js';
import { fmtTime, setText, createGauge, createTiles, setTile, Chart, makeTerm } from './js/hud.js';
import { renderDashboard, exportCsv } from './js/dashboard.js';

const $ = id => document.getElementById(id);

/* ---------------- boot: scene ---------------- */
const canvas = $('view3d');
const S = buildScene(canvas);
const { renderer, scene, camera } = S;

const flow = new FlowField(scene, 1700);
const droneHolder = new THREE.Group();
scene.add(droneHolder);

/* ---------------- terminal + director ---------------- */
const term = makeTerm($('terminal'));
const director = new SimDirector({
  scene, droneHolder, flow,
  fanGrp: S.fanGrp, jetRings: S.jetRings,
  log: (msg, cls) => term.log(director.t, msg, cls),
  finish: onRunFinished,
  paramsGetter: (key, def) => paramState[key] ?? def,
});

/* ---------------- state ---------------- */
let currentAf = AIRFRAMES[0];
let currentTest = TESTS[0];
const droneCache = new Map();
const paramState = {};
const estop = { active: false };
let playing = true;
let units = 'ms';
let overlayOn = false;

/* ---------------- HUD: gauges / tiles / chart ---------------- */
const gAir = createGauge('AIRSPEED', 128, true);
const gRpm = createGauge('MOTOR RPM', 100, false);
const gThr = createGauge('THROTTLE', 100, false);
const gGrid = document.createElement('div');
gGrid.className = 'gauge-grid';
gGrid.append(gAir.el, gRpm.el, gThr.el);
$('gauges1').appendChild(gGrid);

const tiles = createTiles($('minis1'), [
  ['bus', 'BUS VOLT'], ['amp', 'CURRENT'], ['temp', 'MOTOR °C'], ['vib', 'VIB g'], ['mar', 'MARGIN'], ['soc', 'PACK SOC'],
]);
for (let i = 0; i < 8; i++) {
  const l = document.createElement('i');
  l.className = 'servo-led off';
  $('servo1').appendChild(l);
}
const chart = new Chart($('chartCanvas'), $('chartLegend'));
chart.setChannels(director.channels);

/* ---------------- airframe selector ---------------- */
const AF_ICONS = {
  quad: '<svg viewBox="0 0 40 30"><path d="M20 15 L8 6 M20 15 L32 6 M20 15 L8 24 M20 15 L32 24" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="6" r="4.4" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="32" cy="6" r="4.4" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="24" r="4.4" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="32" cy="24" r="4.4" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="16" y="11" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  hex: '<svg viewBox="0 0 40 30"><circle cx="20" cy="15" r="4" fill="none" stroke="currentColor" stroke-width="1.4"/><g stroke="currentColor" stroke-width="1.4" fill="none"><circle cx="20" cy="4" r="3.6"/><circle cx="29.5" cy="9.5" r="3.6"/><circle cx="29.5" cy="20.5" r="3.6"/><circle cx="20" cy="26" r="3.6"/><circle cx="10.5" cy="20.5" r="3.6"/><circle cx="10.5" cy="9.5" r="3.6"/><path d="M20 15 L20 4 M20 15 L29.5 9.5 M20 15 L29.5 20.5 M20 15 L20 26 M20 15 L10.5 20.5 M20 15 L10.5 9.5"/></g></svg>',
  x8: '<svg viewBox="0 0 40 30"><path d="M20 15 L8 6 M20 15 L32 6 M20 15 L8 24 M20 15 L32 24" stroke="currentColor" stroke-width="1.6"/><g fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="4.4" r="3.1"/><circle cx="8" cy="7.8" r="3.1"/><circle cx="32" cy="4.4" r="3.1"/><circle cx="32" cy="7.8" r="3.1"/><circle cx="8" cy="22.2" r="3.1"/><circle cx="8" cy="25.6" r="3.1"/><circle cx="32" cy="22.2" r="3.1"/><circle cx="32" cy="25.6" r="3.1"/></g><rect x="15" y="10.5" width="10" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  vtol: '<svg viewBox="0 0 40 30"><path d="M4 12 L36 12 L36 15 L4 15 Z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M20 6 L22 12 L22 24 L18 24 L18 12 Z" fill="none" stroke="currentColor" stroke-width="1.3"/><g fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="14" cy="9" r="2.6"/><circle cx="26" cy="9" r="2.6"/><circle cx="14" cy="27" r="2.6"/><circle cx="26" cy="27" r="2.6"/><path d="M14 12 V9 M26 12 V9 M14 24 V27 M26 24 V27"/></g></svg>',
};

function buildAfSwitch() {
  const root = $('afSwitch');
  root.innerHTML = '';
  for (const af of AIRFRAMES) {
    const b = document.createElement('button');
    b.className = 'af-btn' + (af === currentAf ? ' active' : '');
    b.innerHTML = `${AF_ICONS[af.icon]}<span class="af-tag">${af.id.toUpperCase()}</span>`;
    b.title = af.name;
    b.addEventListener('click', () => selectAirframe(af));
    root.appendChild(b);
  }
}

function selectAirframe(af, silent = false) {
  if (director.state === 'running') { showToast('CANNOT SWAP AIRFRAME MID-RUN'); return; }
  currentAf = af;
  if (!droneCache.has(af.id)) droneCache.set(af.id, buildDrone(renderer, af));
  director.mount(af, droneCache.get(af.id));
  buildAfSwitch();
  setText($('afName'), af.name);
  setText($('afClass'), af.cls);
  // spec tiles
  const specs = $('afSpecs');
  specs.innerHTML = '';
  const data = [
    ['MTOM', `${af.mass} kg`], ['MAX SPD', `${af.maxSpeed} m/s`], ['MOTORS', `${af.motors}×`],
    ['PACK', `${af.capWh} Wh`, ], ['PAYLOAD', `${af.maxPay} kg`], ['VNE', `${af.vne} m/s`],
  ];
  for (const [l, v] of data) {
    const d = document.createElement('div');
    d.className = 'mini-tile';
    d.innerHTML = `<label>${l}</label><span class="mono">${v}</span>`;
    specs.appendChild(d);
  }
  refreshCert();
  if (!silent) term.log(director.t, `Airframe mounted: ${af.name} — load cell zeroed`, 'a1');
}

/* ---------------- test program panel ---------------- */
function buildProgList() {
  const root = $('progList');
  root.innerHTML = '';
  for (const t of TESTS) {
    const b = document.createElement('button');
    b.className = 'prog-btn' + (t === currentTest ? ' active' : '');
    b.innerHTML = `<span class="p-ico">${t.ico}</span><span><span class="p-name">${t.name}</span><span class="p-sub">${t.sub}</span></span><span class="p-run">●REC</span>`;
    b.addEventListener('click', () => selectTest(t));
    b.dataset.tid = t.id;
    root.appendChild(b);
  }
}

function selectTest(t, silent = false) {
  if (director.state === 'running') { showToast('ABORT CURRENT RUN FIRST'); return; }
  director.select(t);
  currentTest = t;
  buildProgList();
  buildParams();
  chart.setChannels(director.channels);
  chart.clear();
  setText($('vpLabel'), `${t.name} · WT-03 · ${currentAf.id.toUpperCase()}`);
  if (!silent) term.log(0, `Program loaded: ${t.name} — ${t.blurb}`, 'sys');
}

function buildParams() {
  const root = $('progParams');
  root.innerHTML = '';
  for (const p of currentTest.params) {
    let def = p.def;
    if (currentTest.id === 'speed' && p.key === 'target') def = currentAf.maxSpeed;
    paramState[p.key] = paramState[p.key] ?? def;
    if (currentTest.id === 'speed' && p.key === 'target' && !paramState._speedTouched) paramState.target = currentAf.maxSpeed;
    const row = document.createElement('div');
    row.className = 'ctl-row';
    row.innerHTML = `<label>${p.label}</label>`;
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = p.min; inp.max = p.max; inp.step = p.step; inp.value = paramState[p.key];
    if (currentTest.id === 'speed' && p.key === 'target') inp.addEventListener('input', () => paramState._speedTouched = true);
    const out = document.createElement('output');
    out.textContent = `${paramState[p.key]}${p.unit}`;
    inp.addEventListener('input', () => {
      paramState[p.key] = parseFloat(inp.value);
      out.textContent = `${inp.value}${p.unit}`;
    });
    row.append(inp, out);
    root.appendChild(row);
  }
  // blurb + run row
  const bl = document.createElement('div');
  bl.className = 'tiny';
  bl.style.cssText = 'font-size:8.5px;line-height:1.5;margin-top:6px;letter-spacing:.4px';
  bl.textContent = currentTest.blurb;
  root.appendChild(bl);
  const rr = document.createElement('div');
  rr.className = 'run-row';
  const run = document.createElement('button');
  run.className = 'run-btn';
  run.id = 'btnRun';
  run.textContent = '▶ EXECUTE RUN';
  run.addEventListener('click', startRun);
  rr.appendChild(run);
  root.appendChild(rr);
}

function startRun() {
  if (estop.active) { showToast('E-STOP ACTIVE — RELEASE TO ARM'); return; }
  if (!director.start()) return;
  playing = true;
  $('btnAbort').disabled = false;
  $('btnRun').disabled = true;
  chart.clear();
  setText($('runChip'), `RUN #${director.runNo}`);
  $('testBanner').classList.remove('hidden');
  setText($('tbName'), currentTest.name);
  markProgRunning(true);
  setStateChip('RUNNING', 'busy');
  setText($('topStatus'), 'RUNNING');
  for (const b of $('afSwitch').children) b.disabled = true;
}

function markProgRunning(on) {
  for (const b of $('progList').children) {
    b.classList.toggle('running', on && b.dataset.tid === currentTest.id);
    b.disabled = on && b.dataset.tid !== currentTest.id;
  }
}

$('btnAbort').addEventListener('click', () => {
  director.abort();
  endRunUi();
});

function onRunFinished(rec) {
  if (rec.verdict !== 'ABORT') {
    saveRun(rec);
    showToast(`RUN #${rec.n} COMPLETE — ${rec.verdict}`);
    refreshCert();
    if (!$('dashView').classList.contains('hidden')) renderDashboard(loadRuns());
  }
  endRunUi();
}

function endRunUi() {
  $('btnAbort').disabled = true;
  const rb = $('btnRun'); if (rb) rb.disabled = false;
  $('testBanner').classList.add('hidden');
  markProgRunning(false);
  setStateChip('IDLE', '');
  setText($('topStatus'), 'STANDBY');
  for (const b of $('afSwitch').children) b.disabled = false;
  director._setStressMode?.(false);
}

function setStateChip(txt, cls) {
  const c = $('state1');
  setText(c, txt);
  c.className = 'state-chip' + (cls ? ' ' + cls : '');
}

/* ---------------- certification panel ---------------- */
function refreshCert() {
  const runs = loadRuns().filter(r => r.af === currentAf.id);
  const list = $('certList');
  list.innerHTML = '';
  let passCount = 0;
  for (const t of TESTS) {
    const mine = runs.filter(r => r.test === t.id);
    const best = mine.some(r => r.verdict === 'PASS') ? 'PASS'
      : mine.some(r => r.verdict === 'MARGINAL') ? 'MARGINAL'
      : mine.some(r => r.verdict === 'FAIL') ? 'FAIL' : null;
    if (best === 'PASS') passCount++;
    const d = document.createElement('div');
    d.className = 'cert-item' + (best === 'PASS' ? ' pass' : best === 'FAIL' || best === 'MARGINAL' ? ' fail' : '');
    const last = mine[mine.length - 1];
    d.innerHTML = `<span class="c-dot"></span>${t.name}<span class="c-val">${best ?? '—'}${last ? ` · M${last.margin > 0 ? '+' : ''}${last.margin}%` : ''}</span>`;
    list.appendChild(d);
  }
  setText($('certPct'), `${passCount}/4`);
}

/* ---------------- time control ---------------- */
const tcScrub = $('tcScrub');
function setPlaying(p) {
  if (estop.active && p) return;
  playing = p;
  $('btnPlay').classList.toggle('active', p);
  $('btnPause').classList.toggle('active', !p);
  if (director.state !== 'running') setText($('topStatus'), estop.active ? 'FAULT' : 'STANDBY');
}
$('btnPlay').addEventListener('click', () => { setPlaying(true); term.log(director.t, 'Playback resumed', 'sys'); });
$('btnPause').addEventListener('click', () => { setPlaying(false); term.log(director.t, 'Playback paused', 'sys'); });
$('btnStep').addEventListener('click', () => {
  setPlaying(false);
  if (director.state === 'running') { director.seek(Math.min(director.test.dur, director.t + 0.2)); term.log(director.t, 'Step +0.2s', 'sys'); }
});
$('btnStop').addEventListener('click', () => {
  setPlaying(false);
  if (director.state === 'running') { director.seek(0); term.log(0, 'Timeline rewound to 00:00.000', 'sys'); }
});
tcScrub.addEventListener('input', () => {
  if (director.state !== 'running') return;
  setPlaying(false);
  director.seek(tcScrub.value / 1000 * director.test.dur);
});

/* ---------------- E-STOP ---------------- */
$('estop').addEventListener('click', () => {
  estop.active = !estop.active;
  $('estop').classList.toggle('tripped', estop.active);
  $('faultBanner').classList.toggle('hidden', !estop.active);
  if (estop.active) {
    if (director.state === 'running') { director.abort(); endRunUi(); }
    setPlaying(false);
    setStateChip('FAULT', 'fault');
    setText($('topStatus'), 'FAULT');
    term.log(director.t, '!! EMERGENCY STOP — ESC power stage disabled', 'err');
  } else {
    setStateChip('IDLE', '');
    setText($('topStatus'), 'STANDBY');
    term.log(director.t, 'E-STOP released — interlocks reset, drive ready', 'sys');
  }
});

/* ---------------- night mode ---------------- */
const sceneMode = { night: false };
function setNight(v) {
  sceneMode.night = v;
  const bg = v ? 0x040506 : 0xdfe3e8;
  scene.background = new THREE.Color(bg);
  scene.fog.color.setHex(bg);
  scene.fog.near = v ? 7 : 15; scene.fog.far = v ? 18 : 36;
  S.sun.intensity = v ? 0.05 : 1.9;
  S.hemi.intensity = v ? 0.04 : 0.5;
  S.rim.intensity = v ? 0.1 : 0.7;
  scene.environmentIntensity = v ? 0.03 : 0.55;
  for (const s of S.baySpots) s.intensity = v ? 3.2 : 13;
  for (const m of S.lampGlowMats) m.emissiveIntensity = v ? 6.5 : 2.4;
  for (const m of S.scrMats) m.emissiveIntensity = v ? 2.6 : 0.85;
  for (const e of S.edgeGlowMeshes) e.visible = v;
  renderer.toneMappingExposure = v ? 1.18 : 1.02;
  $('btnNight').classList.toggle('active', v);
  setText($('btnNight'), v ? '☀ DAY' : '☾ NIGHT');
  term.log(director.t, v ? 'Night lighting profile — low-glare test ops' : 'Day lighting profile restored', 'sys');
}
$('btnNight').addEventListener('click', () => setNight(!sceneMode.night));

/* ---------------- settings modal ---------------- */
const modal = $('settingsModal');
function openModal() { modal.classList.remove('hidden'); }
function closeModal() { modal.classList.add('hidden'); }
$('btnSettings').addEventListener('click', openModal);
$('btnSetClose').addEventListener('click', closeModal);
modal.addEventListener('pointerdown', e => { if (e.target === modal) closeModal(); });
addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); $('lockScreen').classList.add('hidden'); } });

function segWire(id, fn) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of $(id).querySelectorAll('button')) x.classList.toggle('active', x === b);
    fn(b.dataset.v);
    closeModal();
  });
}
segWire('segParticles', v => { flow.setCount(parseInt(v, 10)); showToast(`FLOW FIELD × ${v}`); });
segWire('segUnits', v => { units = v; showToast(`UNITS: ${v === 'ms' ? 'm/s' : v === 'kmh' ? 'km/h' : 'KNOTS'}`); });
segWire('segBlur', v => { director.blurEnabled = v === 'on'; showToast(`PROP BLUR ${v.toUpperCase()}`); });
segWire('segOverlay', v => { overlayOn = v === 'on'; showToast(`PRECISION OVERLAY ${v.toUpperCase()}`); });

/* ---------------- logout / lock ---------------- */
$('btnLogout').addEventListener('click', () => {
  $('lockScreen').classList.remove('hidden');
  setPlaying(false);
  term.log(director.t, 'Operator console locked', 'sys');
});
$('btnUnlock').addEventListener('click', () => {
  $('lockScreen').classList.add('hidden');
  term.log(director.t, 'Session resumed — operator authenticated', 'sys');
});

/* ---------------- view tabs ---------------- */
$('viewTabs').addEventListener('click', e => {
  const b = e.target.closest('button.tab'); if (!b) return;
  const view = b.dataset.view;
  for (const x of $('viewTabs').querySelectorAll('button.tab')) x.classList.toggle('active', x === b);
  $('simView').classList.toggle('hidden', view !== 'sim');
  $('dashView').classList.toggle('hidden', view !== 'dash');
  if (view === 'dash') renderDashboard(loadRuns());
  else resize();
});
$('btnExport').addEventListener('click', () => { exportCsv(loadRuns()); showToast('REGISTER EXPORTED — CSV'); });
$('btnPurge').addEventListener('click', () => {
  purgeRuns();
  renderDashboard(loadRuns());
  refreshCert();
  showToast('HISTORY PURGED — SEED BASELINE RESTORED');
  term.log(director.t, 'Run register purged by operator', 'warn');
});

/* ---------------- camera ---------------- */
const orbit = { yaw: 0.72, pitch: 0.4, dist: 5.0, tgt: new THREE.Vector3(0.2, 1.5, 0) };
let camTween = null;
function applyCamera() {
  const cp = Math.cos(orbit.pitch), t = orbit.tgt;
  camera.position.set(
    t.x + orbit.dist * cp * Math.sin(orbit.yaw),
    t.y + orbit.dist * Math.sin(orbit.pitch),
    t.z + orbit.dist * cp * Math.cos(orbit.yaw));
  camera.lookAt(t);
}
const CAMS = {
  iso: { yaw: 0.72, pitch: 0.4, dist: 5.0, tgt: [0.2, 1.5, 0] },
  side: { yaw: 0.02, pitch: 0.1, dist: 5.4, tgt: [0, 1.55, 0] },
  top: { yaw: 0.5, pitch: 1.42, dist: 6.2, tgt: [0, 1.0, 0] },
  close: { yaw: 0.95, pitch: 0.24, dist: 1.9, tgt: [0, 1.75, 0] },
};
$('vpCam').addEventListener('click', e => {
  const b = e.target.closest('.cam-btn'); if (!b) return;
  for (const x of $('vpCam').querySelectorAll('.cam-btn')) x.classList.toggle('active', x === b);
  const c = CAMS[b.dataset.v];
  camTween = {
    t: 0,
    from: { yaw: orbit.yaw, pitch: orbit.pitch, dist: orbit.dist, tgt: orbit.tgt.clone() },
    to: { yaw: c.yaw, pitch: c.pitch, dist: c.dist, tgt: new THREE.Vector3(...c.tgt) },
  };
});

/* orbit drag / zoom / focus pick */
let dragInfo = null;
canvas.addEventListener('pointerdown', e => {
  dragInfo = { x: e.clientX, y: e.clientY, moved: 0 };
  camTween = null;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', e => {
  if (dragInfo && dragInfo.moved < 5 && director.drone) {
    // tap → focus drone
    camTween = {
      t: 0,
      from: { yaw: orbit.yaw, pitch: orbit.pitch, dist: orbit.dist, tgt: orbit.tgt.clone() },
      to: { yaw: orbit.yaw, pitch: Math.max(0.2, orbit.pitch), dist: Math.max(2.4, orbit.dist * 0.55), tgt: director.drone.group.position.clone().add(new THREE.Vector3(0, 0.2, 0)) },
    };
  }
  dragInfo = null;
});
canvas.addEventListener('pointermove', e => {
  if (!dragInfo) return;
  dragInfo.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
  orbit.yaw -= e.movementX * 0.006;
  orbit.pitch = clamp(orbit.pitch + e.movementY * 0.004, 0.06, 1.5);
  applyCamera();
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  orbit.dist = clamp(orbit.dist + e.deltaY * 0.01, 1.6, 16);
  applyCamera();
}, { passive: false });

/* ---------------- top bar clock / sysload ---------------- */
setInterval(() => {
  const d = new Date();
  setText($('clock'), d.toLocaleTimeString('en-GB'));
  setText($('date'), `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`);
}, 250);
let sysload = 38;
setInterval(() => {
  sysload = clamp(sysload + (Math.random() - 0.5) * 13, 12, 96);
  setText($('sysload'), `${Math.round(sysload)}%`);
}, 1400);

/* toast */
const toast = $('toast');
let toastTimer = 0;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2600);
}

/* ---------------- resize ---------------- */
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w < 2 || h < 2) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
addEventListener('resize', resize);

/* ---------------- units ---------------- */
function fmtSpeed(v) {
  if (units === 'kmh') return `${(v * 3.6).toFixed(0)}`;
  if (units === 'kn') return `${(v * 1.94384).toFixed(1)}`;
  return v.toFixed(1);
}
const unitLbl = () => units === 'kmh' ? 'km/h' : units === 'kn' ? 'kn' : 'm/s';

/* ---------------- precision overlay ---------------- */
const overlay = document.createElement('div');
overlay.style.cssText = `position:absolute;right:12px;bottom:40px;z-index:4;display:none;
  font-family:var(--mono);font-size:9px;line-height:1.7;color:var(--ink-dim);
  background:rgba(13,16,20,.8);border:1px solid var(--line);border-radius:6px;padding:8px 11px;white-space:pre`;
$('viewport-wrap').appendChild(overlay);

/* ---------------- main loop ---------------- */
let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsShown = 0;
let flowState = { wind: 0, turb: 0, drone: null, droneR: 0.6, propwash: 0, gust: null };

function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.05, (now - last) / 1000);
  last = now;

  // fps
  fpsAcc += dtReal; fpsN++;
  if (fpsAcc > 0.5) { fpsShown = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }

  const running = director.state === 'running';
  const dt = playing || !running ? dtReal : 0;      // pause freezes test, idle anims always run
  const simDt = running && playing ? dtReal : 0;

  const T = director.update(simDt);
  if (estop.active) {
    // hard power-stage cut: props spool down fast
    T.thrN = Math.max(0, T.thrN - dtReal * 2.4);
    T.rpm = rpmAt(currentAf, T.thrN);
    T.rpmN = T.rpm / rpmAt(currentAf, 1);
    T.amps = 0;
  }

  // flow field follows director state
  if (director.flowState) flowState = director.flowState;
  if (estop.active) { flowState = { ...flowState, wind: 0, propwash: 0 }; }
  flow.update(dt, now / 1000, flowState);

  // fan + jet rings
  const fanSpeed = (flowState.wind * 1.4 + (running ? 2 : 0.4)) * (sceneMode.night ? 1 : 1);
  S.fanGrp.rotation.x -= fanSpeed * dt;
  const jrOp = clamp(flowState.wind / 30, 0, 1) * (sceneMode.night ? 0.4 : 0.2);
  S.jetRings.forEach((r, i) => {
    r.material.opacity = jrOp * (0.55 + 0.45 * Math.sin(now / 320 + i * 1.3));
    r.position.x = -1.8 + i * 0.9 + Math.sin(now / 900 + i) * 0.05;
  });

  // markers pulse during struct
  if (director._markers) {
    const on = currentTest.id === 'struct' && running;
    for (const mk of director._markers.children) {
      mk.material.opacity = on ? clamp((T.stressN - 0.35) * 1.6, 0, 0.95) * (0.6 + 0.4 * Math.sin(now / 180)) : 0;
      const s = 1 + clamp(T.stressN, 0, 1) * 0.8 * Math.abs(Math.sin(now / 240));
      mk.scale.setScalar(s);
    }
  }

  // camera tween
  if (camTween) {
    camTween.t += dtReal * 1.6;
    const k = camTween.t >= 1 ? 1 : 1 - Math.pow(1 - camTween.t, 3);
    orbit.yaw = camTween.from.yaw + (camTween.to.yaw - camTween.from.yaw) * k;
    orbit.pitch = camTween.from.pitch + (camTween.to.pitch - camTween.from.pitch) * k;
    orbit.dist = camTween.from.dist + (camTween.to.dist - camTween.from.dist) * k;
    orbit.tgt.lerpVectors(camTween.from.tgt, camTween.to.tgt, k);
    if (camTween.t >= 1) camTween = null;
    applyCamera();
  }

  /* ---- HUD refresh ---- */
  const af = currentAf;
  const spdTone = T.airspeed > af.vne ? 'crit' : T.airspeed > af.maxSpeed ? 'warn' : '';
  gAir.set(clamp(T.airspeed / (af.vne + 4), 0, 1), fmtSpeed(T.airspeed), spdTone);
  gRpm.set(T.rpmN, `${Math.round(T.rpm / 100) / 10}k`, T.rpmN > 0.96 ? 'warn' : '');
  gThr.set(T.thrN, `${Math.round(T.thrN * 100)}`, T.thrN > 0.92 ? 'warn' : '');
  setTile(tiles.bus, `${T.busV.toFixed(1)}V`, T.busV / (af.cells * 4.3));
  setTile(tiles.amp, `${T.amps.toFixed(0)}A`, clamp(T.amps / 120, 0, 1), T.amps > 90 ? 'warn' : '');
  setTile(tiles.temp, `${T.temp.toFixed(0)}°C`, clamp(T.temp / 115, 0, 1), T.temp > 100 ? 'crit' : T.temp > 80 ? 'warn' : '');
  setTile(tiles.vib, `${T.vib.toFixed(1)}g`, clamp(T.vib / 4.5, 0, 1), T.vib > 4.2 ? 'crit' : T.vib > 3 ? 'warn' : '');
  setTile(tiles.mar, `${T.margin.toFixed(0)}%`, clamp(T.margin / 100, 0, 1), T.margin < 10 ? 'crit' : T.margin < 25 ? 'warn' : '');
  setTile(tiles.soc, `${Math.round(T.soc * 100)}%`, T.soc, T.soc < 0.2 ? 'crit' : T.soc < 0.35 ? 'warn' : '');

  // motor LEDs
  const leds = $('servo1').children;
  const lit = T.rpmN > 0.05 && !estop.active;
  for (let i = 0; i < leds.length; i++) leds[i].classList.toggle('off', !(lit && i < af.motors));

  // chart
  if (playing || running) {
    chart.push(T);
    chart.draw();
  }

  // viewport chips + banner
  setText($('chipAirspeed'), `AIR ${fmtSpeed(T.airspeed)} ${unitLbl()}`);
  setText($('chipThrottle'), `THR ${Math.round(T.thrN * 100)}%`);
  setText($('chipFps'), `${fpsShown} FPS`);
  $('chipAirspeed').classList.toggle('hot', spdTone !== '');
  if (running) {
    setText($('tbPhase'), `PHASE ${T.phaseIdx + 1}/${T.phaseCount} · ${T.phaseName}`);
    setText($('tbRead'), bannerReadout(T));
    setText($('tcTime'), fmtTime(director.t));
    if (document.activeElement !== tcScrub) tcScrub.value = Math.round(director.t / director.test.dur * 1000);
  } else {
    setText($('tcTime'), fmtTime(director.t));
  }

  // precision overlay
  overlay.style.display = overlayOn ? 'block' : 'none';
  if (overlayOn && director.drone) {
    const p = director.drone.group.position;
    overlay.textContent =
      `ARTICLE   ${af.id.toUpperCase()}\n` +
      `POS  X ${p.x.toFixed(3)}  Y ${p.y.toFixed(3)}  Z ${p.z.toFixed(3)}\n` +
      `TRIM PITCH ${(director.pose.pitch * 57.3).toFixed(1)}°  YAW ${(director.pose.yaw * 57.3).toFixed(1)}°\n` +
      `Q-BAR ${(0.5 * 1.225 * T.airspeed * T.airspeed / 1000).toFixed(2)} kPa\n` +
      `STRESS ${T.stressMpa.toFixed(1)} MPa (${Math.round(T.stressN * 100)}% YLD)`;
  }

  renderer.render(scene, camera);
}

function bannerReadout(T) {
  switch (currentTest.id) {
    case 'wind': return `${fmtSpeed(T.wind)} ${unitLbl()} · M${Math.round(T.margin)}%`;
    case 'speed': return `${fmtSpeed(T.airspeed)} ${unitLbl()} · ${Math.round(T.temp)}°C`;
    case 'struct': return `${Math.round(T.payN * currentAf.maxPay * 10) / 10} kg · ${Math.round(T.stressN * 100)}% YLD`;
    case 'endur': return `SOC ${Math.round(T.soc * 100)}% · ${T.busV.toFixed(1)}V`;
    default: return '';
  }
}

/* ---------------- boot ---------------- */
buildAfSwitch();
selectAirframe(currentAf, true);
selectTest(currentTest, true);
setPlaying(true);
setStateChip('IDLE', '');
setText($('topStatus'), 'STANDBY');
term.log(0, 'AEROSPEC test console v3.2 — bay 03 interlock chain OK', 'sys');
term.log(0, 'Wind tunnel WT-03 calibrated · nozzle delta-P nominal', 'sys');
term.log(0, `${currentAf.name} clamped to sting mount — load cell zeroed`, 'a1');
term.log(0, 'Select a TEST PROGRAM, tune parameters, EXECUTE RUN', 'sys');
applyCamera();
resize();
requestAnimationFrame(frame);
addEventListener('load', resize);
setTimeout(resize, 120);

/* test hooks (verification) */
window.__director = director;
window.__scene = scene;
window.__camera = camera;
window.__selectAf = id => selectAirframe(AIRFRAMES.find(a => a.id === id));
window.__selectTest = id => selectTest(TESTS.find(t => t.id === id));
window.__run = startRun;
window.__selfCheck = () => ({
  state: director.state,
  af: currentAf.id,
  test: currentTest.id,
  tele: { ...director.tele },
  droneParts: director.drone ? director.drone.group.children.length : 0,
  stressParts: director.drone ? director.drone.stressParts.length : 0,
  particles: flow.count,
  fps: fpsShown,
});
