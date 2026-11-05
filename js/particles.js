/* =========================================================
   AEROSPEC — particles.js
   Open-jet wind-tunnel flow visualisation. A Points cloud
   advects through a cylindrical jet with a shear layer,
   potential-flow deflection around the airframe, propwash
   acceleration behind the rotors, sin-curl turbulence and a
   travelling gust front. Vertex colour encodes local speed.
   ========================================================= */
import * as THREE from 'three';
import { BAY } from './scene.js';

const X0 = -3.45, X1 = 3.45;    // flow domain (bell mouth → collector)
const JET_R = 0.78;             // core jet radius
const SHEAR = 0.42;             // shear layer thickness

export class FlowField {
  constructor(scene, count = 1700) {
    this.scene = scene;
    this.geo = null;
    this.points = null;
    this.count = 0;
    this._build(count);

    this._c = new THREE.Color();
    this.cSlow = new THREE.Color(0x11151a);     // near-invisible haze
    this.cMid = new THREE.Color(0x5a7d68);
    this.cFast = new THREE.Color(0xd8ff3d);
    this.cMax = new THREE.Color(0xf4ffd0);
  }

  _build(n) {
    if (this.points) {
      this.scene.remove(this.points);
      this.geo.dispose();
      this.points.material.dispose();
    }
    this.count = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.spd = new Float32Array(n);             // last speed for colour
    this.seed = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) this._spawn(i, true);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.034, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
      sizeAttenuation: true, opacity: 0.9,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  setCount(n) { if (n !== this.count) this._build(n); }
  setVisible(v) { this.points.visible = v; }

  _spawn(i, anywhere = false) {
    const r = JET_R * 1.16 * Math.sqrt(Math.random());
    const th = Math.random() * Math.PI * 2;
    this.pos[i * 3] = anywhere ? X0 + Math.random() * (X1 - X0) : X0 + Math.random() * 0.4;
    this.pos[i * 3 + 1] = BAY.axisY + r * Math.cos(th);
    this.pos[i * 3 + 2] = r * Math.sin(th);
    this.seed[i * 2] = Math.random() * 100;
    this.seed[i * 2 + 1] = Math.random() * 100;
    this.spd[i] = 0;
  }

  /**
   * @param dt    sim timestep (s)
   * @param t     sim time (s)
   * @param S     { wind, turb(0..1), drone:Vector3|null, droneR, propwash(0..1), gust:{x,boost}|null }
   */
  update(dt, t, S) {
    const p = this.pos, n = this.count;
    const wind = S.wind;
    const turb = S.turb;
    const D = S.drone;
    const dR2 = (S.droneR * 1.9) ** 2;
    const washOn = S.propwash > 0.02 && D;
    const gust = S.gust;

    for (let i = 0; i < n; i++) {
      let x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      const ry = y - BAY.axisY, rz = z;
      const r = Math.hypot(ry, rz);

      // jet velocity profile: core + shear-layer decay
      let vx = r < JET_R ? wind : wind * Math.max(0, 1 - (r - JET_R) / SHEAR);

      // travelling gust front
      if (gust && x < gust.x) vx *= gust.boost;

      // deflection around the airframe (3D doublet-ish)
      if (D) {
        const dx = x - D.x, dy = y - D.y, dz = z - D.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < dR2 * 2.4 && vx > 0.01) {
          const d = Math.sqrt(d2) + 1e-5;
          const k = vx * (S.droneR ** 3) / (d2 * d) * 0.85;   // radial push
          vx -= k * dx / d * 2.2;                              // slow ahead, speed around
          p[i * 3 + 1] += (k * dy / d) * dt * 3.2;
          p[i * 3 + 2] += (k * dz / d) * dt * 3.2;
        }
        // propwash: accelerated churning wake downstream of the disc plane
        if (washOn && dx > 0.05 && dx < 2.6) {
          const wr = Math.hypot(dy, dz);
          if (wr < S.droneR * 1.35) {
            const w = S.propwash * (1 - dx / 2.6);
            vx += w * 5.5 * dt * (1 - wr / (S.droneR * 1.35));
            const sw = w * 2.4 * dt;
            p[i * 3 + 1] += Math.sin(t * 9 + this.seed[i * 2]) * sw * 0.4;
            p[i * 3 + 2] += Math.cos(t * 7.3 + this.seed[i * 2 + 1]) * sw * 0.4;
          }
        }
      }

      // turbulence: cheap sin-curl jitter
      if (turb > 0.001 && vx > 0.05) {
        const s1 = this.seed[i * 2], s2 = this.seed[i * 2 + 1];
        const tb = turb * vx * 0.42;
        p[i * 3 + 1] += Math.sin(y * 2.9 + t * 3.1 + s1) * tb * dt;
        p[i * 3 + 2] += Math.sin(x * 2.2 - t * 2.6 + s2) * tb * dt;
        vx += Math.sin(z * 3.3 + t * 4.2 + s1 + s2) * tb * 0.35;
      }

      x += vx * dt;
      if (x > X1 || r > 3.4) { this._spawn(i); continue; }
      p[i * 3] = x;

      // colour from local speed (normalised to 32 m/s reference)
      const vref = Math.min(1, Math.abs(vx) / 32);
      this.spd[i] = vref;
      const c = this._c;
      if (vref < 0.45) c.copy(this.cSlow).lerp(this.cMid, vref / 0.45);
      else if (vref < 0.8) c.copy(this.cMid).lerp(this.cFast, (vref - 0.45) / 0.35);
      else c.copy(this.cFast).lerp(this.cMax, (vref - 0.8) / 0.2);
      // fade at domain ends (additive blending: dark = invisible)
      const fade = Math.min(1, (x - X0) / 0.7) * Math.min(1, (X1 - x) / 0.9);
      this.col[i * 3] = c.r * fade;
      this.col[i * 3 + 1] = c.g * fade;
      this.col[i * 3 + 2] = c.b * fade;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
