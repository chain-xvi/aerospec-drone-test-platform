/* =========================================================
   AEROSPEC — data layer
   Airframe specifications, test-program definitions and the
   simplified-but-plausible physics model used by all sims.

   Conventions: SI units throughout (m, s, kg, N, W, m/s).
   ========================================================= */

export const RHO = 1.225;      // air density kg/m^3
export const G = 9.81;

/* ---------------- airframes ----------------
   Geometry params feed js/drones.js; performance params feed
   the physics model + dashboard. Numbers are sized to be
   plausible for each class. */
export const AIRFRAMES = [
  {
    id: 'qx4', name: 'QX-4 “HORNET”', cls: 'QUAD · X CONFIG · 5″ CLASS', icon: 'quad',
    type: 'multi', layout: 'quad',          // 4 arms @45°
    armLen: 0.46, propD: 0.34, motorZ: 0.02,
    mass: 2.4, cdA: 0.052,                   // kg, drag area m²
    maxSpeed: 41, vne: 46,                   // m/s rated / never-exceed
    kv: 920, cells: 6, capWh: 148, motors: 4,
    hoverT: 0.46,                            // hover throttle fraction
    armYield: 62,                            // MPa effective at arm root
    maxPay: 1.2,                             // rated payload kg
    price: 4120,
  },
  {
    id: 'hx6', name: 'HX-6 “TITAN”', cls: 'HEX · RADIAL · 18″ CLASS', icon: 'hex',
    type: 'multi', layout: 'hex',           // 6 arms @60°
    armLen: 0.62, propD: 0.47, motorZ: 0.03,
    mass: 6.8, cdA: 0.118,
    maxSpeed: 24, vne: 28,
    kv: 340, cells: 12, capWh: 622, motors: 6,
    hoverT: 0.42,
    armYield: 74,
    maxPay: 5.5,
    price: 14800,
  },
  {
    id: 'vx8', name: 'VX-8 “ATLAS”', cls: 'COAXIAL X8 · HEAVY LIFT', icon: 'x8',
    type: 'multi', layout: 'x8',            // 4 arms, 2 stacked motors each
    armLen: 0.72, propD: 0.56, motorZ: 0.05,
    mass: 11.4, cdA: 0.164,
    maxSpeed: 20, vne: 23,
    kv: 130, cells: 12, capWh: 980, motors: 8,
    hoverT: 0.5,
    armYield: 88,
    maxPay: 12.0,
    price: 26900,
  },
  {
    id: 'fw2', name: 'FW-2 “DART”', cls: 'FIXED-WING VTOL · SURVEY', icon: 'vtol',
    type: 'vtol', layout: 'vtol',           // wing + 4 lift motors + pusher
    armLen: 0.0, propD: 0.30, wingSpan: 1.68, motorZ: 0.0,
    mass: 4.2, cdA: 0.011,                   // clean cruise config
    maxSpeed: 52, vne: 60,
    kv: 1400, cells: 6, capWh: 296, motors: 5,
    hoverT: 0.58,                            // hover is inefficient; cruise sips
    cruiseT: 0.31,
    armYield: 55,                            // wing root
    maxPay: 1.8,
    price: 19400,
  },
];

/* ---------------- test programs ---------------- */
export const TESTS = [
  {
    id: 'wind', name: 'WIND TUNNEL', sub: 'FREESTREAM + GUST SWEEP', ico: '≋',
    dur: 36,
    params: [
      { key: 'wind', label: 'SETPOINT WIND', min: 6, max: 30, def: 18, step: 0.5, unit: 'm/s' },
      { key: 'turb', label: 'TURBULENCE', min: 0, max: 40, def: 14, step: 1, unit: '%' },
      { key: 'yaw', label: 'YAW SWEEP', min: 0, max: 45, def: 20, step: 1, unit: '°' },
    ],
    blurb: 'Ram air to setpoint, sweep yaw, inject a gust front. Measures drag, trim throttle and attitude stability margin.',
  },
  {
    id: 'speed', name: 'SPEED STRESS', sub: 'ACCEL RUN TO VNE', ico: '➾',
    dur: 30,
    params: [
      { key: 'target', label: 'TARGET SPEED', min: 15, max: 55, def: 0, step: 1, unit: 'm/s' }, // def 0 → airframe maxSpeed
      { key: 'dwell', label: 'HOLD AT PEAK', min: 2, max: 10, def: 5, step: 1, unit: 's' },
    ],
    blurb: 'Full-throttle acceleration run to target airspeed. Tracks motor temperature, bus sag and vibration envelope.',
  },
  {
    id: 'struct', name: 'STRUCTURAL LOAD', sub: 'PAYLOAD RAMP · STRESS MAP', ico: '⛭',
    dur: 32,
    params: [
      { key: 'payload', label: 'PEAK PAYLOAD', min: 50, max: 200, def: 150, step: 5, unit: '%rated' },
      { key: 'rate', label: 'LOAD RATE', min: 2, max: 12, def: 6, step: 1, unit: 'kg/s' },
    ],
    blurb: 'Ramps suspended payload past rating while a live finite-element-style stress map tracks arm-root and motor-mount margins.',
  },
  {
    id: 'endur', name: 'ENDURANCE', sub: 'HOVER · BATTERY DRAW-DOWN', ico: '⌛',
    dur: 34,
    params: [
      { key: 'soc', label: 'START CHARGE', min: 40, max: 100, def: 100, step: 5, unit: '%' },
      { key: 'payload', label: 'PAYLOAD', min: 0, max: 100, def: 30, step: 5, unit: '%rated' },
    ],
    blurb: 'Accelerated hover draw-down. Projects real-world endurance, voltage sag curve and thermal rise of the pack.',
  },
];

/* ---------------- physics helpers ---------------- */
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);

/** Drag force at airspeed v (N) */
export function dragN(af, v) { return 0.5 * RHO * v * v * af.cdA; }

/** Throttle fraction needed to hold airspeed v (level flight, simplified) */
export function throttleAt(af, v) {
  const base = af.type === 'vtol' && v > 12
    ? lerp(af.hoverT, af.cruiseT, clamp((v - 12) / 10, 0, 1))   // wing takes over
    : af.hoverT;
  const dragTerm = dragN(af, v) / (af.mass * G);               // extra thrust to fight drag
  return clamp(base + dragTerm * (af.type === 'vtol' ? 0.5 : 0.8), 0, 1);
}

/** Motor RPM for a throttle fraction */
export function rpmAt(af, thr) {
  const vmax = af.cells * 4.2;
  return clamp(thr, 0, 1) * af.kv * vmax * 0.62;               // loaded Kv derate
}

/** Total electric power (W) at throttle + airspeed */
export function powerAt(af, thr, v) {
  const mech = (af.mass * G) * (thr * 7.5) * 0.55;             // induced power approx
  const prof = dragN(af, v) * v / 0.72;                        // profile power
  const esc = 34 * af.motors * thr;                            // ESC + avionics overhead
  return (mech + prof) * thr + esc + 95;                       // + avionics baseline
}

/** Pack voltage under load */
export function busV(af, soc, thr) {
  const nominal = af.cells * 3.7;
  const full = af.cells * 4.2, empty = af.cells * 3.28;
  const ocv = lerp(empty, full, clamp(soc, 0, 1));
  const sag = nominal * 0.055 * thr * (1.25 - clamp(soc, 0, 1));
  return Math.max(empty * 0.94, ocv - sag);
}

/** Vibration RMS (g) at motor rpm — grows with square of rpm + imbalance noise */
export function vibAt(af, rpm, seed = 0) {
  const n = rpm / Math.max(1, rpmAt(af, 1));
  return 0.06 + 3.6 * n * n + (seed ? (Math.sin(seed * 12.9) * 0.5 + 0.5) * 0.5 * n : 0);
}

/** Stress (MPa) at the critical joint for a given total lifted mass */
export function stressAt(af, totalKg, dynFactor = 1) {
  const ratedMass = af.mass + af.maxPay;
  const frac = (totalKg * dynFactor) / ratedMass;
  return frac * af.armYield * 0.58;                            // 58% of yield at max rated load
}

/** Wind-tunnel stability margin (%) — attitude hold quality vs gusts */
export function stabilityMargin(af, wind, turbPct) {
  const authority = clamp(af.maxThrustMargin ?? (af.motors * 1.9) / af.mass, 1.1, 3);
  const load = (wind / af.vne) * (1 + turbPct / 60);
  return clamp((1 - load / authority) * 100, -40, 100);
}

/** Endurance minutes for a hover at payload fraction & state of charge */
export function enduranceMin(af, payloadFrac) {
  const totalMass = af.mass + af.maxPay * payloadFrac;
  const thr = clamp(af.hoverT * (totalMass / af.mass), 0.2, 0.97);
  const p = powerAt(af, thr, 0);
  return (af.capWh * 0.92) / p * 60;
}

/* ---------------- run-record store (browser localStorage) ---------------- */
const LS_KEY = 'aerospec_runs_v1';

export function loadRuns() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* fall through to seed */ }
  return seedRuns();
}

export function saveRun(rec) {
  const runs = loadRuns();
  runs.push(rec);
  try { localStorage.setItem(LS_KEY, JSON.stringify(runs.slice(-120))); } catch (e) {}
  return runs;
}

export function purgeRuns() {
  try { localStorage.removeItem(LS_KEY); } catch (e) {}
}

/** First-visit seed: a plausible week of historical runs so the
    dashboard renders alive before the operator runs anything. */
function seedRuns() {
  const now = Date.now();
  const seed = [];
  const tests = ['wind', 'speed', 'struct', 'endur'];
  let n = 47;
  for (let d = 6; d >= 1; d--) {
    const count = 2 + ((d * 7) % 3);
    for (let i = 0; i < count; i++) {
      const af = AIRFRAMES[(d * 3 + i * 5 + 1) % 4];
      const test = TESTS[(d + i * 2) % 4];
      const r = Math.sin(d * 91.7 + i * 37.3 + af.id.charCodeAt(0)) * 0.5 + 0.5;
      const pass = r > 0.22;
      const marg = r > 0.22 && r < 0.34;
      seed.push({
        n: n++, ts: now - d * 86400e3 + i * 3900e3,
        af: af.id, test: test.id,
        peak: +(af.maxSpeed * (0.62 + r * 0.45)).toFixed(1),
        dur: test.dur,
        verdict: pass ? (marg ? 'MARGINAL' : 'PASS') : 'FAIL',
        margin: +((r - 0.2) * 60).toFixed(1),
      });
    }
  }
  try { localStorage.setItem(LS_KEY, JSON.stringify(seed)); } catch (e) {}
  return seed;
}
