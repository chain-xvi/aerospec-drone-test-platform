/* =========================================================
   AEROSPEC — drones.js
   Procedural airframe factory. Four selectable designs:
     QX-4 Hornet  — quad X, 5″ racer class
     HX-6 Titan   — hex radial, 18″ cinematography class
     VX-8 Atlas   — coaxial X8 heavy lift
     FW-2 Dart    — fixed-wing VTOL survey
   Every airframe exposes motors (spin + blur discs), arm
   pivots (for load-flex) and stress-mapped parts whose vertex
   colours are driven live by the structural test.
   ========================================================= */
import * as THREE from 'three';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { MATS, canvasTex } from './scene.js';

/* ---------- stress colour ramp: blue → chartreuse → amber → red ---------- */
const RAMP = [
  [0.00, new THREE.Color(0x2f6fd8)],
  [0.35, new THREE.Color(0xd8ff3d)],
  [0.65, new THREE.Color(0xffb03d)],
  [0.85, new THREE.Color(0xff5148)],
];
export function rampColor(t, out) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      const f = (t - RAMP[i - 1][0]) / (RAMP[i][0] - RAMP[i - 1][0]);
      return out.copy(RAMP[i - 1][1]).lerp(RAMP[i][1], f);
    }
  }
  return out.copy(RAMP[RAMP.length - 1][1]);
}

/** Tag a mesh as stress-mapped: bakes a per-vertex base
    concentration factor and a colour attribute. */
export function tagStress(mesh, fn) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const base = new Float32Array(pos.count);
  const col = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    base[i] = fn(v);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  mesh.userData.stressBase = base;
  mesh.userData.stressOn = false;
  return mesh;
}

const _c = new THREE.Color();
/** level 0..1.2 — writes the ramp into every tagged vertex */
export function setStress(mesh, level) {
  const base = mesh.userData.stressBase;
  if (!base) return;
  const attr = mesh.geometry.attributes.color;
  for (let i = 0; i < base.length; i++) {
    rampColor(base[i] * level, _c);
    attr.setXYZ(i, _c.r, _c.g, _c.b);
  }
  attr.needsUpdate = true;
}

export function stressMaterial(renderer) {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.42, metalness: 0.5,
  });
}

/* ---------- shared part builders ---------- */

// propeller: shaped 2-blade prop with pitch twist
function buildProp(renderer, propD, accentHex = 0xd8ff3d) {
  const grp = new THREE.Group();
  const L = propD / 2;
  // blade planform: narrow hub → wide at 60% → tapered tip
  const s = new THREE.Shape();
  s.moveTo(0, -0.012);
  s.bezierCurveTo(L * 0.25, -0.030, L * 0.55, -0.036, L * 0.72, -0.028);
  s.bezierCurveTo(L * 0.9, -0.020, L * 0.99, -0.008, L, 0);
  s.bezierCurveTo(L * 0.99, 0.008, L * 0.9, 0.020, L * 0.72, 0.028);
  s.bezierCurveTo(L * 0.55, 0.036, L * 0.25, 0.030, 0, 0.012);
  s.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(s, { depth: 0.0045, bevelEnabled: true, bevelThickness: 0.0016, bevelSize: 0.0016, bevelSegments: 1 });
  bladeGeo.translate(0, 0, -0.00225);

  const propMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.36, metalness: 0.25 });
  const tipMat = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.4, emissive: accentHex, emissiveIntensity: 0.35 });

  // blades are drawn in the XY plane (long axis +X, thickness +Z);
  // holder.rotation.y mirrors the second blade; `inner` then lays the
  // disc flat so the prop spins about +Y.
  const inner = new THREE.Group();
  for (const dir of [0, Math.PI]) {
    const holder = new THREE.Group();
    const blade = new THREE.Mesh(bladeGeo, propMat);
    blade.castShadow = true;
    blade.rotation.x = -0.30;                   // pitch
    holder.add(blade);
    // tip stripe
    const tip = new THREE.Mesh(new THREE.BoxGeometry(L * 0.14, 0.016, 0.006), tipMat);
    tip.position.set(L * 0.93, 0, 0);
    tip.rotation.x = -0.30;
    holder.add(tip);
    holder.rotation.y = dir;
    inner.add(holder);
  }
  inner.rotation.x = Math.PI / 2;               // planform XY → XZ plane
  grp.add(inner);
  // hub
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.018, 12), propMat);
  grp.add(hub);
  const nut = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.014, 10), tipMat);
  nut.position.y = 0.013;
  grp.add(nut);
  return grp;
}

// translucent blur disc shown at high rpm
function buildBlurDisc(renderer, propD) {
  const tex = canvasTex(renderer, 256, 256, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = w / 2 - 4;
    const g = x.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
    g.addColorStop(0, 'rgba(180,188,198,0.05)');
    g.addColorStop(0.75, 'rgba(180,188,198,0.16)');
    g.addColorStop(0.97, 'rgba(216,255,61,0.30)');
    g.addColorStop(1, 'rgba(216,255,61,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(cx, cy, R, 0, 7); x.fill();
    // two faint blade streaks
    x.fillStyle = 'rgba(200,206,214,0.10)';
    for (const a of [0.5, 0.5 + Math.PI]) {
      x.save(); x.translate(cx, cy); x.rotate(a);
      x.fillRect(0, -R * 0.09, R, R * 0.18);
      x.restore();
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const m = new THREE.Mesh(new THREE.CircleGeometry(propD / 2, 40),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

// brushless outrunner motor with mount
function buildMotor(renderer, propD, opts = {}) {
  const grp = new THREE.Group();
  const rB = propD * 0.062;
  // mount plate
  const plate = new THREE.Mesh(new RoundedBoxGeometry(rB * 3.2, 0.012, rB * 3.2, 2, 0.005), MATS.carbon);
  plate.castShadow = true;
  grp.add(plate);
  // stator
  const stator = new THREE.Mesh(new THREE.CylinderGeometry(rB * 0.72, rB * 0.78, 0.02, 16), MATS.steelDark);
  stator.position.y = 0.016;
  grp.add(stator);
  // bell (lathe cup) with anodised ring
  const pts = [
    new THREE.Vector2(rB * 0.30, 0),
    new THREE.Vector2(rB * 0.95, 0.004),
    new THREE.Vector2(rB * 1.02, 0.016),
    new THREE.Vector2(rB * 0.98, 0.028),
    new THREE.Vector2(rB * 0.55, 0.034),
    new THREE.Vector2(rB * 0.30, 0.036),
  ];
  const bell = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), MATS.steel);
  bell.position.y = 0.024;
  bell.castShadow = true;
  grp.add(bell);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(rB * 1.0, 0.0035, 6, 20),
    opts.accent ? MATS.lime : MATS.polymerLite);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.030;
  grp.add(ring);

  const prop = buildProp(renderer, propD, opts.accent ? 0xd8ff3d : 0x9ba1a8);
  prop.position.y = 0.052;
  grp.add(prop);

  const blur = buildBlurDisc(renderer, propD);
  blur.position.y = 0.052;
  grp.add(blur);

  return { grp, prop, blur, plate };
}

// carbon arm tube along +X with root fairing, wiring channel, tip LED
function buildArm(renderer, len, tubeR, opts = {}) {
  const pivot = new THREE.Group();              // rotate .z for flex
  pivot.userData.flexAxis = 'z';                // tips rise under load
  pivot.userData.flexSign = 1;
  const stressMat = opts.stressMat || null;

  // root fairing
  const fair = new THREE.Mesh(new RoundedBoxGeometry(len * 0.3, tubeR * 3.4, tubeR * 4.2, 3, tubeR), MATS.carbon);
  fair.position.set(len * 0.10, 0, 0);
  fair.castShadow = true;
  pivot.add(fair);

  // tube (stress mapped)
  const tubeGeo = new THREE.CylinderGeometry(tubeR, tubeR * 0.86, len, 14, 8);
  tubeGeo.rotateZ(-Math.PI / 2);                // → +X
  tubeGeo.translate(len / 2 + len * 0.06, 0, 0);
  const tube = new THREE.Mesh(tubeGeo, MATS.carbon);
  tube.castShadow = true;
  tagStress(tube, v => {
    const t = (v.x - len * 0.06) / len;         // 0 root → 1 tip
    return 1.0 - 0.62 * t + (t > 0.86 ? 0.34 : 0);
  });
  pivot.add(tube);

  // wiring channel
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(tubeR * 0.22, tubeR * 0.22, len * 0.86, 6), MATS.polymer);
  wire.geometry.rotateZ(-Math.PI / 2);
  wire.position.set(len / 2 + len * 0.08, -tubeR * 0.95, 0);
  pivot.add(wire);

  // tip LED
  const ledMat = opts.rear ? MATS.ledRed : MATS.ledGrn;
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, tubeR * 2.4), ledMat);
  led.position.set(len * 0.99, tubeR * 0.4, 0);
  pivot.add(led);

  return { pivot, tube, fair };
}

function textPlate(renderer, text, w = 0.3) {
  const tex = canvasTex(renderer, 512, 96, (x, cw, ch) => {
    x.clearRect(0, 0, cw, ch);
    x.fillStyle = 'rgba(238,241,244,0.92)';
    x.font = '700 52px Menlo, monospace';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, cw / 2, ch / 2);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 96 / 512),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -1 }));
  return m;
}

/* =========================================================
   Airframe builders — origin: belly underside on y=0
   ========================================================= */

function buildQX4(renderer, af) {
  const g = new THREE.Group();
  const motors = [], stressParts = [], armPivots = [];
  const L = af.armLen, propD = af.propD;

  // lower plate
  const plateLo = new THREE.Mesh(new RoundedBoxGeometry(0.30, 0.025, 0.30, 3, 0.02), MATS.carbon);
  plateLo.position.y = 0.075; plateLo.castShadow = true;
  tagStress(plateLo, v => 0.55 + 0.4 * (Math.abs(v.x) + Math.abs(v.z)));
  g.add(plateLo); stressParts.push(plateLo);

  // canopy: sleek squashed shell
  const canopyGeo = new THREE.SphereGeometry(0.16, 28, 20);
  canopyGeo.scale(1.55, 0.62, 1.0);
  const canopy = new THREE.Mesh(canopyGeo, MATS.polymerLite);
  canopy.position.set(0.02, 0.145, 0);
  canopy.castShadow = true;
  g.add(canopy);
  // canopy stripe
  const stripe = new THREE.Mesh(new THREE.SphereGeometry(0.161, 28, 12, Math.PI * 0.36, Math.PI * 0.28, Math.PI * 0.42, Math.PI * 0.2), MATS.lime);
  stripe.geometry.scale(1.55, 0.62, 1.0);
  stripe.position.copy(canopy.position);
  g.add(stripe);
  // FPV camera
  const camBody = new THREE.Mesh(new RoundedBoxGeometry(0.045, 0.04, 0.05, 2, 0.01), MATS.polymer);
  camBody.position.set(0.235, 0.14, 0);
  g.add(camBody);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 10), MATS.glass);
  lens.position.set(0.26, 0.14, 0);
  g.add(lens);
  // top battery + strap
  const batt = new THREE.Mesh(new RoundedBoxGeometry(0.19, 0.045, 0.09, 2, 0.012), MATS.polymer);
  batt.position.set(0, 0.255, 0); batt.castShadow = true;
  g.add(batt);
  const strap = new THREE.Mesh(new RoundedBoxGeometry(0.196, 0.052, 0.018, 2, 0.006), MATS.ledRed);
  strap.position.set(0, 0.253, 0);
  g.add(strap);
  // GPS puck + antenna
  const gps = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.02, 16), MATS.polymerLite);
  gps.position.set(-0.12, 0.24, 0);
  g.add(gps);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.09, 6), MATS.polymer);
  ant.position.set(-0.19, 0.24, 0.05); ant.rotation.z = 0.5;
  g.add(ant);

  // decals
  const decal = textPlate(renderer, 'AEROSPEC · QX-4', 0.22);
  decal.position.set(0.02, 0.13, 0.162);
  g.add(decal);

  // arms @45°
  const stressMat = stressMaterial(renderer);
  for (let i = 0; i < 4; i++) {
    const ang = Math.PI / 4 + i * Math.PI / 2;
    const { pivot, tube } = buildArm(renderer, L, 0.021, { rear: i >= 2, stressMat });
    pivot.position.set(Math.cos(ang) * 0.12, 0.085, Math.sin(ang) * 0.12);
    pivot.rotation.y = -ang;
    g.add(pivot);
    armPivots.push(pivot);
    stressParts.push(tube);

    const m = buildMotor(renderer, propD, { accent: i < 2 });
    m.grp.position.set(L + L * 0.06, 0.012, 0);
    pivot.add(m.grp);
    motors.push({ grp: m.grp, prop: m.prop, blur: m.blur, dir: i % 2 ? 1 : -1, kind: 'lift', pivot });
    stressParts.push(m.plate);
    tagStress(m.plate, () => 0.8);
  }
  return { group: g, motors, stressParts, armPivots, bodyH: 0.30 };
}

function buildHX6(renderer, af) {
  const g = new THREE.Group();
  const motors = [], stressParts = [], armPivots = [];
  const L = af.armLen, propD = af.propD;

  // hexagonal sandwich plates
  const plateGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.022, 6);
  const plateA = new THREE.Mesh(plateGeo, MATS.carbon);
  plateA.position.y = 0.32; plateA.castShadow = true;
  tagStress(plateA, v => 0.5 + 0.45 * Math.hypot(v.x, v.z) / 0.26);
  g.add(plateA); stressParts.push(plateA);
  const plateB = new THREE.Mesh(plateGeo, MATS.carbon);
  plateB.position.y = 0.10; plateB.castShadow = true;
  g.add(plateB);
  // standoffs
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + Math.PI / 6;
    const so = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), MATS.steel);
    so.position.set(Math.cos(a) * 0.21, 0.21, Math.sin(a) * 0.21);
    g.add(so);
  }
  // dome canopy
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.15, 26, 14, 0, Math.PI * 2, 0, Math.PI / 2), MATS.polymerLite);
  dome.position.y = 0.33; dome.castShadow = true;
  g.add(dome);
  const domeBand = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.008, 8, 30), MATS.lime);
  domeBand.rotation.x = Math.PI / 2;
  domeBand.position.y = 0.345;
  g.add(domeBand);
  // GPS mast
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 8), MATS.polymer);
  mast.position.set(-0.1, 0.48, 0);
  g.add(mast);
  const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.025, 16), MATS.polymerLite);
  puck.position.set(-0.1, 0.56, 0);
  g.add(puck);
  // gimbal ball + camera below
  const gimArm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.09, 8), MATS.steelDark);
  gimArm.position.y = 0.055;
  g.add(gimArm);
  const gimBall = new THREE.Mesh(new THREE.SphereGeometry(0.055, 18, 14), MATS.polymer);
  gimBall.position.y = 0.0;
  g.add(gimBall);
  const gimLens = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), MATS.glass);
  gimLens.position.set(0.048, -0.01, 0);
  g.add(gimLens);
  // landing skids
  for (const sz of [-0.2, 0.2]) {
    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 8), MATS.carbon);
    legL.position.set(0.12, -0.15, sz); legL.rotation.z = 0.35;
    g.add(legL);
    const legR = legL.clone(); legR.position.x = -0.12; legR.rotation.z = -0.35;
    g.add(legR);
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 8), MATS.polymerLite);
    skid.geometry.rotateZ(Math.PI / 2);
    skid.position.set(0, -0.31, sz);
    g.add(skid);
    const skidTip = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 8), MATS.lime);
    skidTip.position.set(0.25, -0.31, sz); g.add(skidTip);
    const skidTip2 = skidTip.clone(); skidTip2.position.x = -0.25; g.add(skidTip2);
  }
  const decal = textPlate(renderer, 'HX-6 TITAN', 0.24);
  decal.position.set(0, 0.21, 0.265);
  g.add(decal);

  const stressMat = stressMaterial(renderer);
  for (let i = 0; i < 6; i++) {
    const ang = i * Math.PI / 3;
    const { pivot, tube } = buildArm(renderer, L, 0.024, { rear: i >= 3, stressMat });
    pivot.position.set(Math.cos(ang) * 0.24, 0.30, Math.sin(ang) * 0.24);
    pivot.rotation.y = -ang;
    g.add(pivot);
    armPivots.push(pivot); stressParts.push(tube);
    const m = buildMotor(renderer, propD, { accent: i === 0 || i === 1 });
    m.grp.position.set(L + L * 0.06, 0.012, 0);
    pivot.add(m.grp);
    motors.push({ grp: m.grp, prop: m.prop, blur: m.blur, dir: i % 2 ? 1 : -1, kind: 'lift', pivot });
    stressParts.push(m.plate);
    tagStress(m.plate, () => 0.8);
  }
  return { group: g, motors, stressParts, armPivots, bodyH: 0.62, skidY: -0.33 };
}

function buildVX8(renderer, af) {
  const g = new THREE.Group();
  const motors = [], stressParts = [], armPivots = [];
  const L = af.armLen, propD = af.propD;

  // octagonal body
  const bodyGeo = new THREE.CylinderGeometry(0.30, 0.34, 0.24, 8);
  const body = new THREE.Mesh(bodyGeo, MATS.carbon);
  body.position.y = 0.34; body.castShadow = true;
  tagStress(body, v => 0.45 + 0.5 * Math.hypot(v.x, v.z) / 0.34);
  g.add(body); stressParts.push(body);
  // top rail + battery slider
  const rail = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.04, 0.12, 2, 0.01), MATS.steelDark);
  rail.position.y = 0.49;
  g.add(rail);
  const pack = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.09, 0.1, 2, 0.015), MATS.polymer);
  pack.position.y = 0.55; pack.castShadow = true;
  g.add(pack);
  const packStripe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.102), MATS.lime);
  packStripe.position.y = 0.53;
  g.add(packStripe);
  // canopy brow
  const brow = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), MATS.polymerLite);
  brow.scale.set(1.3, 0.7, 1.05);
  brow.position.y = 0.44;
  g.add(brow);
  // antenna pair
  for (const sz of [-0.08, 0.08]) {
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.16, 6), MATS.polymer);
    a.position.set(-0.2, 0.52, sz); a.rotation.z = 0.35;
    g.add(a);
  }
  // heavy skids
  for (const sz of [-0.26, 0.26]) {
    for (const sx of [-0.2, 0.2]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.42, 8), MATS.carbon);
      leg.position.set(sx, 0.0, sz);
      leg.rotation.z = sx > 0 ? 0.4 : -0.4;
      g.add(leg);
    }
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.72, 8), MATS.polymerLite);
    skid.geometry.rotateZ(Math.PI / 2);
    skid.position.set(0, -0.19, sz);
    g.add(skid);
  }
  const decal = textPlate(renderer, 'VX-8 ATLAS · 12 kg MTOW-PAY', 0.3);
  decal.position.set(0, 0.3, 0.345);
  g.add(decal);

  const stressMat = stressMaterial(renderer);
  for (let i = 0; i < 4; i++) {
    const ang = Math.PI / 4 + i * Math.PI / 2;
    const { pivot, tube } = buildArm(renderer, L, 0.030, { rear: i >= 2, stressMat });
    pivot.position.set(Math.cos(ang) * 0.28, 0.34, Math.sin(ang) * 0.28);
    pivot.rotation.y = -ang;
    g.add(pivot);
    armPivots.push(pivot); stressParts.push(tube);
    // coaxial pair: upper + lower motor, counter-rotating
    for (const [lvl, dy] of [[0, 0.055], [1, -0.045]]) {
      const m = buildMotor(renderer, propD, { accent: lvl === 0 && i < 2 });
      m.grp.position.set(L + L * 0.06, dy, 0);
      if (lvl === 1) m.grp.rotation.z = Math.PI;      // inverted
      pivot.add(m.grp);
      motors.push({ grp: m.grp, prop: m.prop, blur: m.blur, dir: (i + lvl) % 2 ? 1 : -1, kind: 'lift', pivot, inverted: lvl === 1 });
      stressParts.push(m.plate);
      tagStress(m.plate, () => 0.9);
    }
  }
  return { group: g, motors, stressParts, armPivots, bodyH: 0.62, skidY: -0.21 };
}

function buildFW2(renderer, af) {
  const g = new THREE.Group();
  const motors = [], stressParts = [], armPivots = [];
  const span = af.wingSpan, propD = af.propD;

  // fuselage: teardrop lathe along X
  const pts = [];
  const prof = [[0, 0], [0.02, 0.012], [0.05, 0.042], [0.10, 0.075], [0.18, 0.098], [0.30, 0.105], [0.5, 0.095], [0.8, 0.068], [1.15, 0.038], [1.38, 0.014], [1.5, 0.004]];
  for (const [px, pr] of prof) pts.push(new THREE.Vector2(pr, px));
  const fusGeo = new THREE.LatheGeometry(pts, 26);
  fusGeo.rotateZ(-Math.PI / 2);                 // nose → +X
  fusGeo.translate(-0.75, 0.32, 0);             // centre it
  const fus = new THREE.Mesh(fusGeo, MATS.polymerLite);
  fus.castShadow = true;
  g.add(fus);
  // canopy window
  const winGeo = new THREE.SphereGeometry(0.1, 20, 12);
  winGeo.scale(1.6, 0.55, 0.9);
  const win = new THREE.Mesh(winGeo, new THREE.MeshStandardMaterial({ color: 0x0d1418, roughness: 0.08, metalness: 0.6 }));
  win.position.set(0.33, 0.40, 0);
  g.add(win);
  // spine stripe
  const spine = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.012, 0.03, 2, 0.005), MATS.lime);
  spine.position.set(-0.1, 0.43, 0);
  g.add(spine);

  // wing: centre + tapered outer panels (stress mapped)
  const mkWingPanel = (rootChord, tipChord, len, side) => {
    const s = new THREE.Shape();
    s.moveTo(-rootChord / 2, 0);
    s.lineTo(rootChord / 2, 0);
    s.lineTo(tipChord / 2 - 0.04, len);
    s.lineTo(-tipChord / 2 - 0.04, len);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.006, bevelSegments: 1 });
    // +90° maps planform +Y → +Z (right panel); −90° for the left
    geo.rotateX(side * Math.PI / 2);
    return geo;
  };
  // centre panel through fuselage
  const cw = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.022, 0.42, 2, 0.008), MATS.carbon);
  cw.position.set(0, 0.34, 0); cw.castShadow = true;
  tagStress(cw, v => 0.95 - Math.abs(v.z) * 0.6);
  g.add(cw); stressParts.push(cw);

  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.34, side * 0.19);
    pivot.userData.flexAxis = 'x';
    pivot.userData.flexSign = side;
    g.add(pivot);
    const geo = mkWingPanel(0.24, 0.13, span / 2 - 0.19, side);
    const panel = new THREE.Mesh(geo, MATS.carbon);
    panel.castShadow = true;
    tagStress(panel, v => {
      const t = Math.min(1, Math.abs(v.z) / (span / 2 - 0.19));
      return 1.0 - 0.7 * t;
    });
    pivot.add(panel);
    stressParts.push(panel);
    armPivots.push(pivot);
    // winglet
    const wl = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.09, 0.012, 2, 0.004), MATS.carbon);
    wl.position.set(-0.06, 0.045, side * (span / 2 - 0.21));
    g.add(wl);
    // nav LED
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), side > 0 ? MATS.ledGrn : MATS.ledRed);
    led.position.set(-0.06, 0.36, side * (span / 2 - 0.2));
    g.add(led);

    // tail boom from wing rear
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.011, 0.72, 8), MATS.carbon);
    boom.geometry.rotateZ(Math.PI / 2);
    boom.position.set(-0.5, 0.33, side * span * 0.19);
    g.add(boom);

    // lift motors front/rear on boom line
    for (const mx of [0.14, -0.5]) {
      const m = buildMotor(renderer, propD, { accent: mx > 0 });
      m.grp.position.set(mx, 0.345, side * span * 0.19);
      g.add(m.grp);
      motors.push({ grp: m.grp, prop: m.prop, blur: m.blur, dir: (mx > 0 ? side > 0 : side < 0) ? 1 : -1, kind: 'lift' });
      stressParts.push(m.plate);
      tagStress(m.plate, () => 0.72);
    }
  }

  // inverted-V tail joining the booms
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.14, 0.012, 2, 0.004), MATS.carbon);
    fin.position.set(-0.86, 0.40, side * span * 0.19);
    fin.rotation.x = side * 0.5;
    fin.castShadow = true;
    g.add(fin);
  }
  // pusher motor + prop at fuselage tail
  const pm = new THREE.Group();
  const pmBody = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.07, 14), MATS.steel);
  pmBody.rotation.z = Math.PI / 2;
  pm.add(pmBody);
  const pProp = buildProp(renderer, 0.34, 0x9ba1a8);
  pProp.rotation.z = Math.PI / 2;               // spin axis +Y → −X (pusher)
  pProp.position.x = -0.05;
  pm.add(pProp);
  const pBlur = buildBlurDisc(renderer, 0.34);
  pBlur.rotation.set(0, 0, Math.PI / 2);        // disc plane → YZ
  pBlur.position.x = -0.05;
  pm.add(pBlur);
  pm.position.set(-0.78, 0.34, 0);
  g.add(pm);
  motors.push({ grp: pm, prop: pProp, blur: pBlur, dir: 1, kind: 'pusher' });

  // belly skid
  const skid = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.03, 0.06, 2, 0.012), MATS.polymer);
  skid.position.set(0, 0.02, 0);
  g.add(skid);

  const decal = textPlate(renderer, 'FW-2 DART', 0.2);
  decal.position.set(0.1, 0.33, 0.105);
  decal.rotation.x = -0.35;
  g.add(decal);

  return { group: g, motors, stressParts, armPivots, bodyH: 0.5 };
}

/* ========================================================= */
export function buildDrone(renderer, af) {
  let d;
  switch (af.id) {
    case 'hx6': d = buildHX6(renderer, af); break;
    case 'vx8': d = buildVX8(renderer, af); break;
    case 'fw2': d = buildFW2(renderer, af); break;
    default: d = buildQX4(renderer, af);
  }
  d.af = af;
  // shadow flags + stress defaults
  d.group.traverse(o => { if (o.isMesh) o.castShadow = o.castShadow ?? false; });
  return d;
}
