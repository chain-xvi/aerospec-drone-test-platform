/* =========================================================
   AEROSPEC — sims.js
   SimDirector drives the four certification programs as
   deterministic timelines with integrated thermal / battery
   dynamics, airframe pose, flow-field state, fan, stress
   heat-map and payload rig. Emits telemetry snapshots and a
   run record at completion.
   ========================================================= */
import * as THREE from 'three';
import { MATS, BAY } from './scene.js';
import { setStress } from './drones.js';
import {
  RHO, G, clamp, lerp, smooth,
  dragN, throttleAt, rpmAt, powerAt, busV, vibAt, stressAt,
  stabilityMargin, enduranceMin,
} from './data.js';

const PHASES = {
  wind: ['SPOOL-UP', 'STEADY MEASURE', 'YAW SWEEP', 'GUST FRONT', 'RECOVERY'],
  speed: ['SPOOL-UP', 'ACCELERATION RUN', 'PEAK HOLD', 'SHUTDOWN'],
  struct: ['BASELINE', 'PAYLOAD RAMP', 'PEAK HOLD', 'UNLOAD'],
  endur: ['SPOOL-UP', 'HOVER DRAW-DOWN', 'RESERVE CHECK'],
};

const CHANNELS = {
  wind: [
    { k: 'wind', label: 'WIND', max: 32, color: '#6fd3ff' },
    { k: 'thrN', label: 'THR', max: 1, color: '#d8ff3d' },
    { k: 'margin', label: 'MARGIN', max: 100, color: '#8b939e' },
  ],
  speed: [
    { k: 'airspeed', label: 'AIRSPD', max: 60, color: '#6fd3ff' },
    { k: 'rpmN', label: 'RPM', max: 1, color: '#d8ff3d' },
    { k: 'temp', label: 'TEMP', max: 115, color: '#ffb03d' },
  ],
  struct: [
    { k: 'payN', label: 'PAYLD', max: 1, color: '#6fd3ff' },
    { k: 'stressN', label: 'STRESS', max: 1, color: '#ff5148' },
    { k: 'flex', label: 'FLEX', max: 6, color: '#8b939e' },
  ],
  endur: [
    { k: 'soc', label: 'SOC', max: 1, color: '#d8ff3d' },
    { k: 'busV', label: 'BUS', max: 0, color: '#6fd3ff' },   // max set per airframe
    { k: 'temp', label: 'PACK', max: 80, color: '#ffb03d' },
  ],
};

export class SimDirector {
  /**
   * ctx: { scene, droneHolder:Group, flow:FlowField, fanGrp, jetRings,
   *        log(msg,cls), finish(rec), paramsGetter() }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.af = null;
    this.drone = null;
    this.test = null;
    this.state = 'idle';           // idle | running | done
    this.t = 0;
    this.tele = this._zeroTele();
    this._phase = -1;
    this._stressOn = false;
    this._gust = null;
    this._markers = null;
    this._payloadRig = null;
    this.runNo = 40 + Math.floor(Math.random() * 40);
    this.mountPos = new THREE.Vector3(BAY.testX, BAY.axisY - 0.115, 0);
    // pose state (smoothed)
    this.pose = { pitch: 0, yaw: 0, bob: 0, shake: 0 };
  }

  _zeroTele() {
    return {
      t: 0, airspeed: 0, wind: 0, thr: 0, thrN: 0, rpm: 0, rpmN: 0,
      busV: 0, amps: 0, temp: 22, vib: 0.05, soc: 1, stressMpa: 0, stressN: 0,
      payN: 0, flex: 0, margin: 100, phaseName: 'STANDBY', phaseIdx: 0,
      phaseCount: 1, verdict: null, turbVis: 0,
    };
  }

  get channels() {
    const ch = CHANNELS[this.test?.id ?? 'wind'];
    if (this.test?.id === 'endur' && this.af) ch[1].max = this.af.cells * 4.25;
    if (this.test?.id === 'speed' && this.af) ch[0].max = Math.max(60, this.af.vne + 6);
    return ch;
  }

  /* ---------------- airframe mounting ---------------- */
  mount(af, drone) {
    this.af = af;
    if (this.drone) this.ctx.droneHolder.remove(this.drone.group);
    this.drone = drone;
    // normalise display size: largest horizontal extent ≈ 1.16 m test article
    if (!drone.normalized) {
      drone.normalized = true;
      const bb = new THREE.Box3().setFromObject(drone.group);
      const size = bb.getSize(new THREE.Vector3());
      const s = 1.16 / Math.max(size.x, size.z);
      drone.group.scale.setScalar(s);
      drone.radius = Math.max(size.x, size.z) * s * 0.5;
      drone.centerOff = size.y * s * 0.5;
    }
    // rest the airframe on the pylon plate: belly origin minus skid drop
    this.mountPos.set(BAY.testX, BAY.axisY - 0.115 - (drone.skidY ?? 0) * drone.group.scale.x, 0);
    drone.group.position.copy(this.mountPos);
    this.ctx.droneHolder.add(drone.group);
    // strong-point markers at each arm root
    if (this._markers) this.drone.group.remove(this._markers);
    this._markers = new THREE.Group();
    const mkGeo = new THREE.OctahedronGeometry(0.05);
    for (const piv of drone.armPivots) {
      const mk = new THREE.Mesh(mkGeo, new THREE.MeshBasicMaterial({ color: 0xd8ff3d, transparent: true, opacity: 0 }));
      mk.position.copy(piv.position);
      this._markers.add(mk);
    }
    drone.group.add(this._markers);
    // payload rig (hidden until struct test)
    if (!this._payloadRig) {
      const rig = new THREE.Group();
      const block = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.24, 10), MATS.steel);
      block.castShadow = true;
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 6, 18), MATS.lime);
      band.rotation.x = Math.PI / 2;
      rig.add(block, band);
      const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x8b939e }));
      line.name = 'sling';
      rig.add(line);
      this._payloadRig = rig;
    }
    this._payloadRig.visible = false;
    this.ctx.scene.add(this._payloadRig);
    this.abort(true);
  }

  /* ---------------- test selection / params ---------------- */
  select(test) {
    if (this.state === 'running') return false;
    this.test = test;
    this.tele = this._zeroTele();
    return true;
  }

  params() {
    const p = {};
    for (const d of this.test.params) p[d.key] = this.ctx.paramsGetter(d.key, d.def);
    return p;
  }

  start() {
    if (!this.af || !this.test || this.state === 'running') return false;
    this.state = 'running';
    this.t = 0;
    this._phase = -1;
    this._done = false;
    this.runNo++;
    this.prm = this.params();
    if (this.test.id === 'speed' && !this.prm.target) this.prm.target = this.af.maxSpeed;
    // integrators
    this.tempM = 22; this.tempP = 22;
    this.soc = clamp(this.prm.soc ?? 100, 5, 100) / 100;
    if (this.test.id === 'endur') {
      // scale the draw-down so the hover phase consumes ≈82% of the pack
      const pay = (this.prm.payload ?? 30) / 100;
      const thrH = clamp(this.af.hoverT * ((this.af.mass + this.af.maxPay * pay) / this.af.mass), 0.2, 0.98);
      const pH = powerAt(this.af, thrH, 0);
      this._endurK = 0.82 / (pH / (this.af.capWh * 3600) * 26);
    }
    this._peakWind = 0; this._minMargin = 100; this._peakSpeed = 0;
    this._maxTemp = 22; this._maxVib = 0; this._maxStress = 0; this._peakReached = 0;
    this.ctx.log(`RUN #${this.runNo} ${this.test.name} on ${this.af.name} — article clamped, interlocks OK`, 'a2');
    return true;
  }

  abort(silent = false) {
    if (this.state === 'running' && !silent) {
      this.ctx.log(`RUN #${this.runNo} ABORTED by operator — drives to idle`, 'warn');
      this._finish('ABORT');
    }
    this.state = 'idle';
    this.t = 0;
    this._setStressMode(false);
    if (this._payloadRig) this._payloadRig.visible = false;
  }

  _finish(forced) {
    if (this._done) return;
    this._done = true;
    const af = this.af, T = this.test;
    let verdict = forced, margin = 0, peak = 0;
    if (!forced) {
      switch (T.id) {
        case 'wind': {
          margin = this._minMargin;
          peak = this._peakWind;
          verdict = margin > 25 ? 'PASS' : margin > 10 ? 'MARGINAL' : 'FAIL';
          break;
        }
        case 'speed': {
          const tempOK = this._maxTemp < 105, vibOK = this._maxVib < 4.2, vneOK = this.prm.target <= af.vne;
          margin = Math.min((105 - this._maxTemp) * 1.4, (4.2 - this._maxVib) * 22, (af.vne - this._peakReached) * 6);
          peak = this._peakReached;
          verdict = tempOK && vibOK && vneOK ? (margin < 8 ? 'MARGINAL' : 'PASS') : 'FAIL';
          break;
        }
        case 'struct': {
          margin = (1 - this._maxStress / af.armYield) * 100;
          peak = this._maxStress;
          verdict = this._maxStress < af.armYield * 0.8 ? 'PASS' : this._maxStress < af.armYield * 0.98 ? 'MARGINAL' : 'FAIL';
          break;
        }
        case 'endur': {
          const proj = this._projEndur;
          const target = enduranceMin(af, 0.3) * 0.92;
          margin = (proj - target) / target * 100;
          peak = proj;
          verdict = proj >= target ? 'PASS' : proj >= target * 0.9 ? 'MARGINAL' : 'FAIL';
          break;
        }
      }
    }
    const rec = {
      n: this.runNo, ts: Date.now(), af: af.id, test: T.id,
      peak: +peak.toFixed(1), dur: Math.round(this.t), verdict, margin: +margin.toFixed(1),
    };
    const cls = verdict === 'PASS' ? 'a2' : verdict === 'FAIL' ? 'err' : 'warn';
    this.ctx.log(`RUN #${this.runNo} ${verdict} — margin ${rec.margin}% · peak ${rec.peak}`, cls);
    this.ctx.finish(rec);
    this.state = 'done';
  }

  /* ---------------- stress heat-map mode ---------------- */
  _setStressMode(on) {
    if (!this.drone || on === this._stressOn) return;
    this._stressOn = on;
    if (!this._stressMat) {
      this._stressMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.5 });
    }
    for (const m of this.drone.stressParts) {
      if (on) {
        if (!m.userData.normalMat) m.userData.normalMat = m.material;
        m.material = this._stressMat;
        setStress(m, 0);
      } else if (m.userData.normalMat) {
        m.material = m.userData.normalMat;
      }
    }
  }

  /* ---------------- per-frame update ----------------
     dt: sim-delta (already scaled by play state) */
  update(dt) {
    const T = this.tele;
    if (this.state === 'running') {
      this.t += dt;
      this._stepTest(Math.min(this.t, this.test.dur), dt);
      if (this.t >= this.test.dur) this._finish(null);
    } else {
      this._idlePose(dt);
    }
    this._applyPose(dt);
    this._updateVisualSystems(dt);
    T.t = this.t;
    return T;
  }

  seek(t) {
    if (this.state !== 'running') return;
    // re-integrate coarse from 0 for thermal/battery state
    this.t = 0;
    this.tempM = 22; this.tempP = 22;
    this.soc = clamp(this.prm.soc ?? 100, 5, 100) / 100;
    this._minMargin = 100; this._peakWind = 0; this._peakSpeed = 0;
    this._maxTemp = 22; this._maxVib = 0; this._maxStress = 0; this._peakReached = 0;
    const steps = Math.floor(t / 0.1);
    for (let i = 0; i < steps; i++) {
      this.t += 0.1;
      this._stepTest(this.t, 0.1, true);
    }
    this._phase = -1;   // re-announce
  }

  _idlePose(dt) {
    const T = this.tele;
    T.thrN = lerp(T.thrN, 0.12, dt * 2);
    T.rpm = rpmAt(this.af, T.thrN) * 0.55;
    T.rpmN = T.rpm / rpmAt(this.af, 1);
    T.airspeed = lerp(T.airspeed, 0, dt * 2);
    T.wind = lerp(T.wind, 0, dt * 2);
    T.busV = busV(this.af, this.soc ?? 1, 0.1);
    T.amps = lerp(T.amps, 1.2, dt);
    T.temp = lerp(T.temp, 22, dt * 0.3);
    T.vib = lerp(T.vib, 0.05, dt * 2);
    T.stressN = lerp(T.stressN, 0, dt * 3);
    T.payN = 0; T.flex = lerp(T.flex, 0, dt * 3);
    T.margin = lerp(T.margin, 100, dt);
    T.soc = this.soc ?? 1;
    T.phaseName = this.state === 'done' ? 'COMPLETE' : 'STANDBY';
    T.turbVis = lerp(T.turbVis, 0, dt * 2);
    this._gust = null;
    this.pose.pitch = lerp(this.pose.pitch, 0, dt * 2);
    this.pose.yaw = lerp(this.pose.yaw, 0, dt * 2);
    this.pose.shake = 0;
  }

  _announce(idx, name, coarse = false) {
    this.tele.phaseIdx = idx;
    this.tele.phaseName = name;
    if (idx !== this._phase && !coarse) {
      this._phase = idx;
      this.ctx.log(`PHASE ${idx + 1}/${PHASES[this.test.id].length} — ${name}`, 'sys');
    }
  }

  _stepTest(t, dt, coarse = false) {
    const af = this.af, P = this.prm, T = this.tele;
    const id = this.test.id;
    const names = PHASES[id];
    T.phaseCount = names.length;

    if (id === 'wind') {
      const sp = P.wind, turb = P.turb / 100, yawAmp = P.yaw * Math.PI / 180;
      let wind = 0, ph = 0;
      if (t < 6) { ph = 0; wind = sp * smooth(t / 6); }
      else if (t < 16) { ph = 1; wind = sp; }
      else if (t < 26) { ph = 2; wind = sp; T.yawT = (t - 16) / 10; }
      else if (t < 31) { ph = 3; wind = sp * 1.06; this._gust = { x: -3.45 + (t - 26) / 5 * 7.2, boost: 1.55 }; }
      else { ph = 4; wind = sp * (1 - smooth((t - 31) / 5)); this._gust = null; }
      this._announce(ph, names[ph], coarse);
      T.wind = wind;
      T.turbVis = turb * (ph === 3 ? 1.8 : 1);
      // trim: pitch into wind, hold position
      const thr = throttleAt(af, wind) * 1.06;
      T.thrN = clamp(thr, 0, 1);
      T.airspeed = wind;
      // yaw sweep pose
      this.pose.yaw = ph === 2 ? Math.sin((t - 16) / 10 * Math.PI * 2) * yawAmp : lerp(this.pose.yaw, 0, 0.1);
      this.pose.pitch = -clamp(wind / af.vne, 0, 1) * 0.16;
      // stability margin
      const gustBoost = (this._gust && this.drone.group.position.x < this._gust.x) ? 1.55 : 1;
      T.margin = stabilityMargin(af, wind * gustBoost, P.turb);
      if (ph >= 1 && ph <= 3) {
        this._minMargin = Math.min(this._minMargin, T.margin);
        this._peakWind = Math.max(this._peakWind, wind * (ph === 3 ? gustBoost : 1));
      }
      T.stressN = clamp(wind / af.vne, 0, 1) * 0.4;
      T.payN = 0;
      this.tempM += dt * ((T.thrN * 95 - this.tempM) / 26);
      T.temp = this.tempM;
      T.vib = vibAt(af, rpmAt(af, T.thrN), t);
      T.amps = powerAt(af, T.thrN, wind) / Math.max(8, busV(af, this.soc, T.thrN));
      T.busV = busV(af, this.soc, T.thrN);
    }

    else if (id === 'speed') {
      const target = P.target, dwell = P.dwell;
      const tAccel = this.test.dur - dwell - 9;
      let v = 0, ph = 0;
      if (t < 4) { ph = 0; v = 0; }
      else if (t < 4 + tAccel) { ph = 1; v = target * smooth((t - 4) / tAccel); }
      else if (t < 4 + tAccel + dwell) { ph = 2; v = target; }
      else { ph = 3; v = target * (1 - smooth((t - 4 - tAccel - dwell) / 5)); }
      this._announce(ph, names[ph], coarse);
      T.airspeed = v; T.wind = v;               // virtual ram air
      T.turbVis = 0.06;
      const thr = clamp(throttleAt(af, v) * (ph === 1 ? 1.35 : 1.1), 0, 1.04);
      T.thrN = clamp(thr, 0, 1);
      const rpm = rpmAt(af, T.thrN);
      T.rpm = rpm; T.rpmN = rpm / rpmAt(af, 1);
      this.tempM += dt * (((30 + T.thrN * 95) - this.tempM) / 22);
      T.temp = this.tempM;
      T.vib = vibAt(af, rpm, t) + (v > af.vne ? (v - af.vne) * 0.1 : 0);
      T.busV = busV(af, this.soc, T.thrN);
      T.amps = powerAt(af, T.thrN, v) / Math.max(8, T.busV);
      this.soc = Math.max(0.05, this.soc - dt * powerAt(af, T.thrN, v) / (af.capWh * 3600) * 12); // accelerated
      T.soc = this.soc;
      if (ph === 1 || ph === 2) {
        this._peakReached = Math.max(this._peakReached, v);
        this._maxTemp = Math.max(this._maxTemp, T.temp);
        this._maxVib = Math.max(this._maxVib, T.vib);
        if (T.temp > 100 && !this._warnedHot) { this._warnedHot = true; this.ctx.log('MOTOR TEMP APPROACHING LIMIT — 100°C', 'warn'); }
        if (v > af.vne && !this._warnedVne) { this._warnedVne = true; this.ctx.log(`AIRSPEED BEYOND VNE (${af.vne} m/s)`, 'err'); }
      }
      this.pose.pitch = -clamp(v / af.vne, 0, 1.1) * 0.34;
      this.pose.shake = clamp(T.vib / 4.2, 0, 1.4);
      T.stressN = clamp(v / af.vne, 0, 1.15) * 0.7;
      T.margin = clamp((1 - v / af.vne) * 100, -40, 100);
    }

    else if (id === 'struct') {
      const peakPay = P.payload / 100;          // fraction of rated
      const payRate = P.rate;                   // kg/s (display only)
      let pay = 0, ph = 0;
      if (t < 5) { ph = 0; pay = 0; }
      else if (t < 24) { ph = 1; pay = peakPay * smooth((t - 5) / 19); }
      else if (t < 28) { ph = 2; pay = peakPay; }
      else { ph = 3; pay = peakPay * (1 - smooth((t - 28) / 4)); }
      this._announce(ph, names[ph], coarse);
      if (!this._stressOn) { this._setStressMode(true); if (!coarse) this.ctx.log('STRESS MAP ONLINE — 214 nodes instrumented', 'sys'); }
      this._payloadRig.visible = pay > 0.02;
      const totalKg = af.mass + af.maxPay * pay;
      const dyn = 1 + 0.12 * Math.sin(t * 3.1) * pay;   // dynamic amplification
      const stress = stressAt(af, totalKg, dyn);
      T.stressMpa = stress;
      T.stressN = stress / af.armYield;
      T.payN = pay;
      T.flex = clamp(T.stressN * 5.2, 0, 6);
      T.thrN = clamp(af.hoverT * (totalKg / af.mass), 0, 1.05);
      if (T.thrN > 1) T.thrN = 1;
      const rpm = rpmAt(af, T.thrN);
      T.rpm = rpm; T.rpmN = rpm / rpmAt(af, 1);
      T.vib = vibAt(af, rpm, t) * 0.8;
      T.busV = busV(af, this.soc, T.thrN);
      T.amps = powerAt(af, T.thrN, 0) / Math.max(8, T.busV);
      this.tempM += dt * ((28 + T.thrN * 80 - this.tempM) / 25);
      T.temp = this.tempM;
      if (ph >= 1 && ph <= 2) {
        this._maxStress = Math.max(this._maxStress, stress);
        if (T.stressN > 0.8 && !this._warned80) { this._warned80 = true; this.ctx.log('ARM-ROOT STRESS > 80% YIELD — WATCH ZONE', 'warn'); }
        if (T.stressN > 0.98 && !this._warned98) { this._warned98 = true; this.ctx.log('!! STRESS AT YIELD — PERMANENT SET LIKELY', 'err'); }
      }
      // flex the arm pivots (tips rise under lift load)
      for (const piv of this.drone.armPivots) {
        const ax = piv.userData.flexAxis || 'z';
        piv.rotation[ax] = (piv.userData.flexSign || 1) * T.stressN * 0.09;
      }
      // live heat-map refresh
      for (const m of this.drone.stressParts) setStress(m, T.stressN);
      // payload rig slung forward of the sting so it clears the pylon
      const belly = this.mountPos.y + 0.02;
      const fwd = (this.drone.radius ?? 0.5) * 0.62;
      this._payloadRig.position.set(
        this.mountPos.x + fwd,
        belly - 0.62 * Math.min(1, pay * 3) - 0.11 * pay,
        this.mountPos.z);
      const sling = this._payloadRig.getObjectByName('sling');
      if (sling) {
        const pts = [new THREE.Vector3(0, 0.11, 0), new THREE.Vector3(-fwd, belly - this._payloadRig.position.y, 0)];
        sling.geometry.setFromPoints(pts);
      }
      this.pose.pitch = -T.stressN * 0.045;      // nose dips under the slung load
      T.margin = (1 - T.stressN) * 100;
      T.wind = 0; T.turbVis = 0;
    }

    else if (id === 'endur') {
      const pay = (P.payload ?? 30) / 100;
      let ph = 0;
      if (t < 4) ph = 0;
      else if (t < 30) ph = 1;
      else ph = 2;
      this._announce(ph, names[ph], coarse);
      const totalMass = af.mass + af.maxPay * pay;
      const thr = clamp(af.hoverT * (totalMass / af.mass) * (1.06 - this.soc * 0.08), 0, 0.98);
      T.thrN = ph === 0 ? thr * smooth(t / 4) : thr;
      const rpm = rpmAt(af, T.thrN);
      T.rpm = rpm; T.rpmN = rpm / rpmAt(af, 1);
      const p = powerAt(af, T.thrN, 0);
      if (ph >= 1) {
        // accelerated draw-down, scaled per airframe (see start())
        this.soc = Math.max(0, this.soc - dt * (p / (af.capWh * 3600)) * (this._endurK ?? 300));
        this.tempP += dt * ((26 + p / 42 - this.tempP) / 22);
      }
      T.soc = this.soc;
      T.temp = this.tempP;
      T.busV = busV(af, this.soc, T.thrN);
      T.amps = p / Math.max(8, T.busV);
      T.vib = vibAt(af, rpm, t) * 0.7;
      // projected endurance: time spent so far scaled
      const usedFrac = 1 - this.soc;
      const elapsedMin = (t - 4) / 26 * (enduranceMin(af, pay) * (clamp(this.prm.soc ?? 100, 5, 100) / 100) * 0.8);
      this._projEndur = usedFrac > 0.02 ? elapsedMin / usedFrac * 0.8 : enduranceMin(af, pay);
      if (this.soc < 0.2 && !this._warnedSoc) { this._warnedSoc = true; this.ctx.log('PACK AT 20% — RESERVE THRESHOLD', 'warn'); }
      T.margin = clamp((this._projEndur / (enduranceMin(af, 0.3) * 0.92) - 1) * 100, -50, 60);
      T.payN = pay;
      this.pose.bob = Math.sin(t * 1.7) * 0.02 * T.thrN;
      T.stressN = clamp(thr * 0.5, 0, 1);
      T.wind = 0; T.turbVis = 0.02;
    }

    if (!coarse) {
      T.rpm = T.rpm || rpmAt(af, T.thrN);
      T.rpmN = T.rpm / rpmAt(af, 1);
    }
  }

  /* ---------------- pose + environment visuals ---------------- */
  _applyPose(dt) {
    if (!this.drone) return;
    const g = this.drone.group;
    const s = this.pose;
    const shakeAmp = (s.shake || 0) * 0.006;
    const tt = performance.now() * 0.02;
    g.position.set(
      this.mountPos.x + (Math.sin(tt * 1.13) * shakeAmp),
      this.mountPos.y + (s.bob || 0) + Math.abs(Math.sin(tt * 1.7)) * shakeAmp,
      this.mountPos.z + (Math.cos(tt * 0.91) * shakeAmp)
    );
    g.rotation.set(0, s.yaw, s.pitch);

    // spin props, fade blur discs
    const rpmN = this.tele.rpmN;
    const om = rpmN * 95 + 3;
    for (const m of this.drone.motors) {
      const k = m.kind === 'pusher'
        ? clamp((this.tele.airspeed - 8) / 20, 0, 1)
        : 1;
      m.prop.rotation.y += m.dir * om * k * dt;
      const blurOn = rpmN > 0.32 && this.blurEnabled !== false;
      m.blur.material.opacity = lerp(m.blur.material.opacity, blurOn ? clamp((rpmN - 0.3) * 1.6, 0, 0.85) * k : 0, dt * 6);
      if (blurOn) m.prop.visible = rpmN < 0.86;
    }
  }

  _updateVisualSystems(dt) {
    const T = this.tele;
    // flow field state — deflection centred on the airframe body
    if (this.drone) {
      this._dc = this._dc || new THREE.Vector3();
      this._dc.copy(this.drone.group.position);
      this._dc.y += this.drone.centerOff ?? 0.2;
    }
    const S = {
      wind: T.wind,
      turb: T.turbVis ?? 0,
      drone: this.drone ? this._dc : null,
      droneR: this.drone?.radius ?? 0.55,
      propwash: T.thrN * (this.test?.id === 'wind' ? 0.8 : 1),
      gust: this._gust,
    };
    this.flowState = S;
  }
}
