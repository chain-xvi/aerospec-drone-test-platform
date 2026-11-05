/* =========================================================
   AEROSPEC — scene.js
   Renderer, lighting rig and the propulsion test bay:
   open-jet wind tunnel (intake bell → test section → fan
   collector), sting pylon, safety fencing, control cabinets
   and overhead gantry. Exports shared procedural materials.
   ========================================================= */
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';

export const BAY = {
  axisY: 1.62,        // tunnel centerline height
  tunnelX0: -4.6,     // intake mouth
  tunnelX1: 4.6,      // fan housing rear
  testX: 0,           // drone / pylon position on axis
  floorY: 0,
};

/* ---------------- procedural canvas textures ---------------- */
export function canvasTex(renderer, w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(...repeat);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const MATS = {};

function buildSharedMaterials(renderer) {
  // polished concrete
  const concrete = canvasTex(renderer, 512, 512, (x, w, h) => {
    x.fillStyle = '#b7bbc0'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 14000; i++) {
      const v = 150 + Math.random() * 70;
      x.fillStyle = `rgba(${v},${v},${v + 6},${0.05 + Math.random() * 0.08})`;
      x.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
    }
    for (let i = 0; i < 26; i++) {
      const g = x.createRadialGradient(0, 0, 2, 0, 0, 18 + Math.random() * 42);
      g.addColorStop(0, 'rgba(70,74,80,0.10)'); g.addColorStop(1, 'rgba(70,74,80,0)');
      x.save(); x.translate(Math.random() * w, Math.random() * h);
      x.fillStyle = g; x.beginPath(); x.arc(0, 0, 60, 0, 7); x.fill(); x.restore();
    }
    x.strokeStyle = 'rgba(62,66,72,0.55)'; x.lineWidth = 3;
    x.strokeRect(1, 1, w - 2, h - 2);
  }, [9, 9]);

  // carbon fibre twill weave
  const carbon = canvasTex(renderer, 256, 256, (x, w, h) => {
    x.fillStyle = '#16181c'; x.fillRect(0, 0, w, h);
    const s = 16;
    for (let j = 0; j < h / s; j++) for (let i = 0; i < w / s; i++) {
      const over = (i + j) % 2 === 0;
      const g = x.createLinearGradient(i * s, j * s, over ? (i + 1) * s : i * s, over ? j * s : (j + 1) * s);
      g.addColorStop(0, '#101216'); g.addColorStop(0.5, '#2b2f36'); g.addColorStop(1, '#101216');
      x.fillStyle = g; x.fillRect(i * s + 0.5, j * s + 0.5, s - 1, s - 1);
    }
  }, [3, 3]);

  // hazard stripes
  const hazard = canvasTex(renderer, 256, 64, (x, w, h) => {
    x.fillStyle = '#101216'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#d8ff3d';
    for (let i = -2; i < 10; i++) {
      x.beginPath();
      x.moveTo(i * 42, h); x.lineTo(i * 42 + 24, h); x.lineTo(i * 42 + 24 + h, 0); x.lineTo(i * 42 + h, 0);
      x.fill();
    }
  }, [6, 1]);

  // honeycomb flow-straightener
  const honey = canvasTex(renderer, 256, 256, (x, w, h) => {
    x.fillStyle = '#22262c'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(216,255,61,0.35)'; x.lineWidth = 2;
    const r = 9;
    for (let row = 0; row < h / (r * 1.5) + 1; row++) {
      for (let col = 0; col < w / (r * 1.74) + 1; col++) {
        const cx = col * r * 1.74 + (row % 2 ? r * 0.87 : 0);
        const cy = row * r * 1.5;
        x.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 3 * k + Math.PI / 6;
          const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
          k ? x.lineTo(px, py) : x.moveTo(px, py);
        }
        x.closePath(); x.stroke();
      }
    }
  });

  MATS.concrete = new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.32, metalness: 0.06 });
  MATS.carbon = new THREE.MeshStandardMaterial({ map: carbon, roughness: 0.42, metalness: 0.55 });
  MATS.hazard = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.6, metalness: 0.1, emissive: 0xd8ff3d, emissiveMap: hazard, emissiveIntensity: 0.14 });
  MATS.honey = new THREE.MeshStandardMaterial({ map: honey, roughness: 0.7, metalness: 0.4, side: THREE.DoubleSide });
  MATS.duct = new THREE.MeshStandardMaterial({ color: 0x5d646d, roughness: 0.5, metalness: 0.62 });
  MATS.ductDark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.55, metalness: 0.65 });
  MATS.steel = new THREE.MeshStandardMaterial({ color: 0x9ba1a8, roughness: 0.34, metalness: 0.85 });
  MATS.steelDark = new THREE.MeshStandardMaterial({ color: 0x565c64, roughness: 0.42, metalness: 0.9 });
  MATS.polymer = new THREE.MeshStandardMaterial({ color: 0x1d2025, roughness: 0.68, metalness: 0.12 });
  MATS.polymerLite = new THREE.MeshStandardMaterial({ color: 0x353a41, roughness: 0.6, metalness: 0.2 });
  MATS.lime = new THREE.MeshStandardMaterial({ color: 0xd8ff3d, roughness: 0.4, metalness: 0.3, emissive: 0xd8ff3d, emissiveIntensity: 0.55 });
  MATS.ledRed = new THREE.MeshStandardMaterial({ color: 0xff5148, emissive: 0xff2214, emissiveIntensity: 1.6 });
  MATS.ledGrn = new THREE.MeshStandardMaterial({ color: 0xd8ff3d, emissive: 0xd8ff3d, emissiveIntensity: 1.4 });
  MATS.glass = new THREE.MeshPhysicalMaterial({ color: 0x8fb7c9, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  MATS.glowWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.2 });
}

/* ---------------- floor markings ---------------- */
function floorText(renderer, lines, w = 1024, h = 256, fg = '#3d434b') {
  return canvasTex(renderer, w, h, (x) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = fg;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    lines.forEach((ln, i) => {
      x.font = `${ln.bold ? '700' : '500'} ${ln.size}px ${ln.mono ? 'Menlo, monospace' : 'Inter, sans-serif'}`;
      x.globalAlpha = ln.alpha ?? 0.9;
      x.fillText(ln.t, w / 2, (i + 0.5) * (h / lines.length));
    });
  });
}

/* =========================================================
   buildScene — assembles everything, returns handles
   ========================================================= */
export function buildScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe3e8);
  scene.fog = new THREE.Fog(0xdfe3e8, 15, 36);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(42, 2, 0.1, 120);

  /* ---- lights ---- */
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a929e, 0.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e6, 1.9);
  sun.position.set(6, 10, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -9; sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 9; sun.shadow.camera.bottom = -9;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.0006; sun.shadow.radius = 7;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xcfe0ff, 0.7);
  rim.position.set(-6, 7, -6);
  scene.add(rim);

  const baySpots = [];
  for (const [sx, sz] of [[-2.4, 0.2], [2.4, 0.2], [0, -2.6]]) {
    const spot = new THREE.SpotLight(0xffffff, 13, 13, 0.62, 0.55, 1.2);
    spot.position.set(sx, 6.4, sz);
    spot.target.position.set(sx * 0.6, BAY.axisY, sz * 0.4);
    scene.add(spot, spot.target);
    baySpots.push(spot);
  }

  buildSharedMaterials(renderer);
  const glowMats = [];      // emissive materials boosted at night
  const edgeGlowMeshes = []; // shown only at night

  /* ---- floor ---- */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), MATS.concrete);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // reflective-ish dark inlay around the test zone
  const inlay = new THREE.Mesh(
    new THREE.PlaneGeometry(12.6, 7.2),
    new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.22, metalness: 0.5 })
  );
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = 0.006;
  inlay.receiveShadow = true;
  scene.add(inlay);

  // floor texts
  const mkMarking = (tex, w, h, px, pz, ry = 0, op = 0.92) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: op, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = ry;
    m.position.set(px, 0.012, pz);
    scene.add(m);
    return m;
  };
  mkMarking(floorText(renderer, [
    { t: 'BAY 03', size: 150, bold: true },
    { t: 'PROPULSION TEST ZONE', size: 44 },
  ]), 6.4, 1.6, 0, 2.6);
  mkMarking(floorText(renderer, [{ t: 'WT-03 · OPEN-JET · MAX 42 m/s', size: 54, mono: true }]), 5.2, 0.5, 0, -2.9, 0, 0.7);
  mkMarking(floorText(renderer, [{ t: '⚠ KEEP CLEAR — ROTOR ARC', size: 58, bold: true }], 1024, 128, '#8a4a3a'), 4.4, 0.66, -3.4, 0, Math.PI / 2, 0.85);

  // hazard frame around the test section
  for (const [w, h, px, pz] of [[11.2, 0.28, 0, 3.4], [11.2, 0.28, 0, -3.4], [0.28, 7.1, -5.6, 0], [0.28, 7.1, 5.6, 0]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, h), MATS.hazard);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(px, 0.014, pz);
    scene.add(strip);
  }

  /* ---- open-jet wind tunnel ---- */
  const tunnel = new THREE.Group();
  scene.add(tunnel);
  const Y = BAY.axisY;

  // intake bell: trumpet profile via lathe (mouth r≈1.15 → throat 0.78)
  {
    const pts = [];
    pts.push(new THREE.Vector2(1.15, -0.62));
    pts.push(new THREE.Vector2(1.12, -0.4));
    pts.push(new THREE.Vector2(1.02, -0.18));
    pts.push(new THREE.Vector2(0.88, 0.0));
    pts.push(new THREE.Vector2(0.79, 0.14));
    pts.push(new THREE.Vector2(0.78, 0.32));
    pts.push(new THREE.Vector2(0.78, 0.72));
    const bell = new THREE.Mesh(new THREE.LatheGeometry(pts, 42), MATS.duct);
    bell.rotation.z = -Math.PI / 2;           // axis → X, mouth faces −X
    bell.position.set(-2.72, Y, 0);
    bell.castShadow = true;
    tunnel.add(bell);

    // lip ring
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.045, 12, 42), MATS.steelDark);
    lip.rotation.y = Math.PI / 2;
    lip.position.set(-3.34, Y, 0);
    tunnel.add(lip);

    // honeycomb straightener just inside the bell throat
    const hc = new THREE.Mesh(new THREE.CircleGeometry(0.77, 36), MATS.honey);
    hc.rotation.y = Math.PI / 2;
    hc.position.set(-2.35, Y, 0);
    tunnel.add(hc);
  }

  // collector + fan housing on the right (opens toward −X, expands to fan)
  const fanGrp = new THREE.Group();
  {
    const pts = [];
    pts.push(new THREE.Vector2(0.78, 0));
    pts.push(new THREE.Vector2(0.84, 0.16));
    pts.push(new THREE.Vector2(0.98, 0.38));
    pts.push(new THREE.Vector2(1.04, 0.62));
    pts.push(new THREE.Vector2(1.04, 1.35));
    const col = new THREE.Mesh(new THREE.LatheGeometry(pts, 42), MATS.duct);
    col.rotation.z = -Math.PI / 2;            // +Y → +X : wide end at fan
    col.position.set(2.32, Y, 0);
    col.castShadow = true;
    tunnel.add(col);

    // motor hub
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.55, 20), MATS.ductDark);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(3.1, Y, 0);
    tunnel.add(hub);

    // 9-blade axial fan
    const bladeGeo = new THREE.BoxGeometry(0.05, 0.68, 0.16);
    bladeGeo.translate(0, 0.44, 0);
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Mesh(bladeGeo, MATS.steelDark);
      const holder = new THREE.Group();
      b.rotation.x = 0.6;                      // blade pitch
      holder.rotation.x = (i / 9) * Math.PI * 2;
      holder.add(b);
      fanGrp.add(holder);
    }
    fanGrp.position.set(3.1, Y, 0);
    tunnel.add(fanGrp);

    // protective grille over the collector mouth
    for (let r = 0; r < 3; r++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26 + r * 0.25, 0.01, 6, 40), MATS.steel);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(2.3, Y, 0);
      tunnel.add(ring);
    }
    for (let i = 0; i < 6; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.52, 6), MATS.steel);
      spoke.rotation.x = (i / 6) * Math.PI;
      spoke.rotation.y = Math.PI / 2;
      spoke.position.set(2.3, Y, 0);
      tunnel.add(spoke);
    }
  }

  // tunnel support saddles
  for (const [px, r] of [[-2.6, 0.95], [2.9, 1.06], [3.6, 1.06]]) {
    const leg = new THREE.Mesh(new RoundedBoxGeometry(0.34, Y - 0.2, 0.5, 3, 0.05), MATS.ductDark);
    leg.position.set(px, (Y - 0.2) / 2, 0);
    leg.castShadow = true;
    tunnel.add(leg);
    const saddle = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 10, 30, Math.PI), MATS.steelDark);
    saddle.rotation.y = Math.PI / 2;
    saddle.rotation.z = Math.PI;
    saddle.position.set(px, Y - 0.12, 0);
    tunnel.add(saddle);
  }

  // jet-boundary guide rings between bell and collector (visualise the open jet)
  const jetRings = [];
  for (let i = 0; i < 5; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.007, 6, 48),
      new THREE.MeshBasicMaterial({ color: 0xd8ff3d, transparent: true, opacity: 0.0 }));
    ring.rotation.y = Math.PI / 2;
    ring.position.set(-1.8 + i * 0.9, Y, 0);
    tunnel.add(ring);
    jetRings.push(ring);
  }

  /* ---- sting pylon + load cell ---- */
  const pylon = new THREE.Group();
  {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 0.12, 28), MATS.ductDark);
    base.position.y = 0.06; base.castShadow = true;
    pylon.add(base);
    const cell = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.22, 0.3, 3, 0.03), MATS.steelDark);
    cell.position.y = 0.24; cell.castShadow = true;
    pylon.add(cell);
    // streamlined strut
    const strut = new THREE.Mesh(new RoundedBoxGeometry(0.1, Y - 0.55, 0.34, 3, 0.04), MATS.steel);
    strut.position.y = 0.35 + (Y - 0.55) / 2;
    strut.castShadow = true;
    pylon.add(strut);
    // chartreuse load-cell band
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 8, 24), MATS.lime);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.36;
    pylon.add(band);
    // mount plate at drone interface
    const plate = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.05, 0.34, 3, 0.02), MATS.ductDark);
    plate.position.y = Y - 0.14;
    plate.castShadow = true;
    pylon.add(plate);
  }
  pylon.position.set(BAY.testX, 0, 0);
  scene.add(pylon);

  /* ---- safety fence (chartreuse posts + dark rails) ---- */
  const fence = new THREE.Group();
  const postGeo = new THREE.CylinderGeometry(0.035, 0.035, 1.05, 10);
  const railMat = MATS.polymer;
  const F = 5.0, FZ = 2.9;
  const posts = [];
  for (let x = -F; x <= F + 0.01; x += 1.25) { posts.push([x, -FZ], [x, FZ]); }
  for (let z = -FZ + 1.16; z <= FZ - 0.01; z += 1.16) { posts.push([-F, z], [F, z]); }
  for (const [px, pz] of posts) {
    const p = new THREE.Mesh(postGeo, MATS.lime);
    p.position.set(px, 0.53, pz);
    p.castShadow = true;
    fence.add(p);
  }
  for (const [w, px, pz, ry] of [[2 * F, 0, -FZ, 0], [2 * F, 0, FZ, 0], [2 * FZ, -F, 0, Math.PI / 2], [2 * FZ, F, 0, Math.PI / 2]]) {
    for (const hy of [0.98, 0.62]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, w, 8), railMat);
      rail.rotation.z = Math.PI / 2; rail.rotation.y = ry;
      rail.position.set(px, hy, pz);
      fence.add(rail);
    }
  }
  scene.add(fence);

  /* ---- control cabinets with live screens (back wall) ---- */
  const scrMats = [];
  for (let c = 0; c < 3; c++) {
    const cab = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.9, 1.7, 0.5, 3, 0.04), MATS.ductDark);
    body.position.y = 0.85; body.castShadow = true;
    cab.add(body);
    const scrTex = canvasTex(renderer, 128, 96, (x, w, h) => {
      x.fillStyle = '#0a0f0c'; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#d8ff3d'; x.lineWidth = 2; x.beginPath();
      for (let i = 0; i < w; i++) {
        const y = h / 2 + Math.sin(i * 0.14 + c * 2) * 14 * Math.sin(i * 0.02);
        i ? x.lineTo(i, y) : x.moveTo(i, y);
      }
      x.stroke();
    });
    scrTex.wrapS = scrTex.wrapT = THREE.ClampToEdgeWrapping;
    const scrMat = new THREE.MeshStandardMaterial({ map: scrTex, emissive: 0xffffff, emissiveMap: scrTex, emissiveIntensity: 0.85, roughness: 0.4 });
    scrMats.push(scrMat);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.44), scrMat);
    scr.position.set(0, 1.12, 0.26);
    cab.add(scr);
    const kb = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.04, 0.2, 2, 0.01), MATS.polymer);
    kb.position.set(0, 0.82, 0.3); kb.rotation.x = 0.25;
    cab.add(kb);
    cab.position.set(-3.4 + c * 1.35, 0, -5.6);
    scene.add(cab);
  }

  /* ---- overhead gantry + high-bay lamps ---- */
  {
    const beam = new THREE.Mesh(new RoundedBoxGeometry(11, 0.22, 0.3, 2, 0.03), MATS.ductDark);
    beam.position.set(0, 6.2, 0);
    scene.add(beam);
    for (const px of [-5.3, 5.3]) {
      const col = new THREE.Mesh(new RoundedBoxGeometry(0.26, 6.2, 0.26, 2, 0.03), MATS.ductDark);
      col.position.set(px, 3.1, 0);
      scene.add(col);
    }
    const trolley = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.4, 0.44, 2, 0.04), MATS.steelDark);
    trolley.position.set(1.6, 5.95, 0);
    scene.add(trolley);
  }
  const lampGlowMats = [];
  for (const [px, pz] of [[-2.4, 0.2], [2.4, 0.2], [0, -2.6], [-4.6, -2.6], [4.6, -2.6]]) {
    const g = new THREE.Group();
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6), MATS.polymer);
    cord.position.y = 0.45; g.add(cord);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.34, 0.3, 20, 1, true), MATS.ductDark);
    shade.position.y = -0.05; g.add(shade);
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 2.4 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), bulbMat);
    bulb.position.y = -0.16; g.add(bulb);
    lampGlowMats.push(bulbMat);
    g.position.set(px, 6.0, pz);
    scene.add(g);
  }

  // night-mode edge glow frame around the test zone
  {
    const egMat = new THREE.MeshBasicMaterial({ color: 0xd8ff3d, transparent: true, opacity: 0.5 });
    for (const [w, px, pz, ry] of [[11.2, 0, 3.4, 0], [11.2, 0, -3.4, 0], [7.1, -5.6, 0, Math.PI / 2], [7.1, 5.6, 0, Math.PI / 2]]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.05), egMat);
      bar.rotation.x = -Math.PI / 2; bar.rotation.z = ry;
      bar.position.set(px, 0.02, pz);
      bar.visible = false;
      edgeGlowMeshes.push(bar);
      scene.add(bar);
    }
  }

  return {
    renderer, scene, camera,
    hemi, sun, rim, baySpots, lampGlowMats, glowMats, edgeGlowMeshes, scrMats,
    fanGrp, jetRings, pylon,
  };
}
