/* =========================================================
   AEROSPEC — dashboard.js
   Fleet test-operations view: KPI cards with sparklines,
   peak-airspeed history, structural margins per airframe,
   verdict donut and the run register. All canvas-rendered,
   zero dependencies.
   ========================================================= */
import { AIRFRAMES, TESTS } from './data.js';

const C = {
  ink: '#eef1f4', dim: '#8b939e', faint: '#5f6873',
  accent: '#d8ff3d', amber: '#ffb03d', red: '#ff5148', cyan: '#6fd3ff',
  grid: 'rgba(255,255,255,0.08)',
};

const afName = id => (AIRFRAMES.find(a => a.id === id)?.name ?? id).replace(/[“”]/g, '');
const testName = id => TESTS.find(t => t.id === id)?.name ?? id;

function setup(cv) {
  const dpr = devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (W < 2 || H < 2) return null;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const x = cv.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, W, H);
  return { x, W, H };
}

function grid(x, W, H, rows = 4, padL = 30) {
  x.strokeStyle = C.grid; x.lineWidth = 1;
  x.font = '8px Menlo,monospace'; x.fillStyle = C.faint;
  for (let i = 0; i <= rows; i++) {
    const y = (H - 14) * i / rows + 4;
    x.beginPath(); x.moveTo(padL, y); x.lineTo(W, y); x.stroke();
  }
}

/* ---------------- KPI cards + sparklines ---------------- */
export function renderStats(runs) {
  const row = document.getElementById('statRow');
  row.innerHTML = '';
  const total = runs.length;
  const pass = runs.filter(r => r.verdict === 'PASS').length;
  const passRate = total ? Math.round(pass / total * 100) : 0;
  const certified = AIRFRAMES.filter(af =>
    TESTS.every(t => runs.some(r => r.af === af.id && r.test === t.id && r.verdict === 'PASS'))).length;
  const speedRuns = runs.filter(r => r.test === 'speed' || r.test === 'wind');
  const best = speedRuns.length ? Math.max(...speedRuns.map(r => r.peak)) : 0;

  // 7-day run counts for sparkline
  const days = [];
  const now = Date.now();
  for (let d = 6; d >= 0; d--) {
    const t0 = now - (d + 1) * 86400e3, t1 = now - d * 86400e3;
    days.push(runs.filter(r => r.ts > t0 && r.ts <= t1).length);
  }
  const passTrail = [];
  runs.slice(-24).forEach((r, i, arr) => {
    const slice = arr.slice(0, i + 1);
    passTrail.push(slice.filter(s => s.verdict === 'PASS').length / slice.length);
  });

  const cards = [
    { label: 'TEST RUNS LOGGED', val: String(total), unit: '', sub: `${days[6]} RUNS TODAY`, spark: days, sparkMax: Math.max(3, ...days) },
    { label: 'PASS RATE', val: String(passRate), unit: '%', sub: `${pass} PASS · ${total - pass} OTHER`, spark: passTrail, sparkMax: 1 },
    { label: 'AIRFRAMES CERTIFIED', val: String(certified), unit: `/4`, sub: certified === 4 ? 'FLEET CLEAR' : 'CERTIFICATION OPEN', spark: null },
    { label: 'BEST PEAK AIRSPEED', val: best.toFixed(1), unit: 'm/s', sub: 'WIND + SPEED RUNS', spark: speedRuns.slice(-16).map(r => r.peak), sparkMax: Math.max(10, ...speedRuns.map(r => r.peak)) },
  ];

  for (const c of cards) {
    const el = document.createElement('div');
    el.className = 'stat-card';
    el.innerHTML = `<label>${c.label}</label><div class="s-val">${c.val}<b> ${c.unit}</b></div><div class="s-sub">${c.sub}</div>`;
    const cv = document.createElement('canvas');
    cv.width = 148; cv.height = 52;
    el.appendChild(cv);
    row.appendChild(el);
    if (c.spark && c.spark.length > 1) {
      const x = cv.getContext('2d');
      x.strokeStyle = C.accent; x.lineWidth = 2; x.beginPath();
      c.spark.forEach((v, i) => {
        const px = i / (c.spark.length - 1) * 140 + 4;
        const py = 46 - (v / c.sparkMax) * 36;
        i ? x.lineTo(px, py) : x.moveTo(px, py);
      });
      x.stroke();
      x.lineTo(144, 50); x.lineTo(4, 50); x.closePath();
      x.fillStyle = 'rgba(216,255,61,0.10)'; x.fill();
    }
  }
}

/* ---------------- peak airspeed line ---------------- */
export function renderLine(runs) {
  const env = setup(document.getElementById('dashLine'));
  if (!env) return;
  const { x, W, H } = env;
  const data = runs.filter(r => r.test === 'wind' || r.test === 'speed').slice(-18);
  const padL = 30, padB = 14;
  grid(x, W, H, 4, padL);
  const max = Math.max(20, ...data.map(r => r.peak)) * 1.15;
  for (let i = 0; i <= 4; i++) x.fillText(`${Math.round(max * (1 - i / 4))}`, 3, (H - padB) * i / 4 + 12);
  if (data.length < 2) { emptyNote(x, W, H, 'AWAITING WIND / SPEED RUNS'); return; }
  // per-airframe colour tracks
  x.font = '8px Menlo,monospace';
  data.forEach((r, i) => {
    const px = padL + i / (17) * (W - padL - 8);
    x.fillStyle = r.verdict === 'PASS' ? C.accent : r.verdict === 'FAIL' ? C.red : C.amber;
    x.beginPath(); x.arc(px, (H - padB) - (r.peak / max) * (H - padB - 8) + 4, 2.6, 0, 7); x.fill();
  });
  x.beginPath();
  data.forEach((r, i) => {
    const px = padL + i / (17) * (W - padL - 8);
    const py = (H - padB) - (r.peak / max) * (H - padB - 8) + 4;
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  });
  x.strokeStyle = C.cyan; x.lineWidth = 1.6; x.stroke();
}

/* ---------------- structural margin bars ---------------- */
export function renderBar(runs) {
  const env = setup(document.getElementById('dashBar'));
  if (!env) return;
  const { x, W, H } = env;
  const padB = 16, padL = 8;
  const bw = (W - padL * 2) / 4;
  AIRFRAMES.forEach((af, i) => {
    const mine = runs.filter(r => r.af === af.id && r.test === 'struct');
    const last = mine[mine.length - 1];
    const marginPct = last ? Math.max(-30, last.margin) : null;
    const bx = padL + i * bw + bw * 0.18, bwi = bw * 0.64;
    const baseY = H - padB;
    if (marginPct === null) {
      x.fillStyle = C.grid;
      x.fillRect(bx, baseY - 6, bwi, 6);
      x.fillStyle = C.faint; x.font = '8px Menlo,monospace'; x.textAlign = 'center';
      x.fillText('NO DATA', bx + bwi / 2, baseY - 12);
    } else {
      const col = marginPct >= 20 ? C.accent : marginPct >= 2 ? C.amber : C.red;
      if (marginPct < 0) {
        // negative margin: red stub below the baseline
        x.fillStyle = C.red;
        x.fillRect(bx, baseY, bwi, Math.min(14, -marginPct * 0.35));
        x.fillStyle = C.red; x.font = '9px Menlo,monospace'; x.textAlign = 'center';
        x.fillText(`${marginPct.toFixed(0)}%`, bx + bwi / 2, baseY + 26);
      } else {
        const h = Math.min(1.25, marginPct / 100) * (H - padB - 22);
        const grad = x.createLinearGradient(0, baseY - h, 0, baseY);
        grad.addColorStop(0, col); grad.addColorStop(1, col + '33');
        x.fillStyle = grad;
        x.fillRect(bx, baseY - h, bwi, h);
        x.fillStyle = C.ink; x.font = '9px Menlo,monospace'; x.textAlign = 'center';
        x.fillText(`${marginPct.toFixed(0)}%`, bx + bwi / 2, baseY - h - 6);
      }
    }
    // 20% pass gate
    const gateY = baseY - 0.2 * (H - padB - 22);
    x.strokeStyle = 'rgba(255,255,255,0.35)';
    x.setLineDash([4, 4]);
    x.beginPath(); x.moveTo(padL, gateY); x.lineTo(W - padL, gateY); x.stroke();
    x.setLineDash([]);
    x.fillStyle = C.dim; x.font = '8px Menlo,monospace'; x.textAlign = 'center';
    x.fillText(af.id.toUpperCase(), bx + bwi / 2, H - 4);
  });
}

/* ---------------- verdict donut ---------------- */
export function renderDonut(runs) {
  const env = setup(document.getElementById('dashDonut'));
  if (!env) return;
  const { x, W, H } = env;
  const cats = [
    { k: 'PASS', c: C.accent }, { k: 'MARGINAL', c: C.amber },
    { k: 'FAIL', c: C.red }, { k: 'ABORT', c: C.faint },
  ];
  const counts = cats.map(c => runs.filter(r => r.verdict === c.k).length);
  const total = counts.reduce((a, b) => a + b, 0);
  document.getElementById('donutTotal').textContent = `${total} RUNS`;
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 8, r2 = R * 0.62;
  let a0 = -Math.PI / 2;
  cats.forEach((c, i) => {
    if (!counts[i]) return;
    const a1 = a0 + counts[i] / total * Math.PI * 2;
    x.beginPath();
    x.arc(cx, cy, R, a0 + 0.02, a1 - 0.02);
    x.arc(cx, cy, r2, a1 - 0.02, a0 + 0.02, true);
    x.closePath();
    x.fillStyle = c.c; x.fill();
    a0 = a1;
  });
  x.fillStyle = C.ink; x.font = '300 20px Menlo,monospace'; x.textAlign = 'center';
  x.fillText(`${total ? Math.round(counts[0] / total * 100) : 0}%`, cx, cy + 2);
  x.font = '7px Inter,sans-serif'; x.fillStyle = C.faint;
  x.fillText('PASS', cx, cy + 14);
  document.getElementById('donutLegend').innerHTML = cats.map((c, i) =>
    `<div class="dl-row"><span class="dl-sw" style="background:${c.c}"></span>${c.k}<span class="dl-val">${counts[i]}</span></div>`).join('');
}

/* ---------------- register table ---------------- */
export function renderTable(runs) {
  const body = document.getElementById('regBody');
  const empty = document.getElementById('regEmpty');
  const table = document.getElementById('regTable');
  document.getElementById('regCount').textContent = `${runs.length} RECORDS`;
  const rows = runs.slice(-40).reverse();
  body.innerHTML = '';
  if (!rows.length) { empty.classList.remove('hidden'); table.classList.add('hidden'); return; }
  empty.classList.add('hidden'); table.classList.remove('hidden');
  for (const r of rows) {
    const d = new Date(r.ts);
    const tr = document.createElement('tr');
    const vcls = r.verdict === 'PASS' ? 'pass' : r.verdict === 'FAIL' ? 'fail' : 'marg';
    const unit = r.test === 'struct' ? 'MPa' : r.test === 'endur' ? 'min' : 'm/s';
    tr.innerHTML = `
      <td>${d.toLocaleDateString('en-GB')} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
      <td>${afName(r.af)}</td>
      <td>${testName(r.test)}</td>
      <td>${r.peak} ${unit}</td>
      <td>${r.dur}s</td>
      <td><span class="v-chip ${vcls}">${r.verdict}</span></td>
      <td>${r.margin > 0 ? '+' : ''}${r.margin}%</td>`;
    body.appendChild(tr);
  }
}

function emptyNote(x, W, H, msg) {
  x.fillStyle = C.faint; x.font = '9px Menlo,monospace'; x.textAlign = 'center';
  x.fillText(msg, W / 2, H / 2);
}

export function renderDashboard(runs) {
  renderStats(runs);
  renderLine(runs);
  renderBar(runs);
  renderDonut(runs);
  renderTable(runs);
  const d = new Date();
  document.getElementById('dashStamp').textContent =
    `LOCAL ${d.toLocaleDateString('en-GB')} · HISTORY STORED IN THIS BROWSER ONLY`;
}

export function exportCsv(runs) {
  const head = 'run,timestamp,airframe,program,peak,duration_s,verdict,margin_pct\n';
  const body = runs.map(r =>
    [r.n, new Date(r.ts).toISOString(), r.af, r.test, r.peak, r.dur, r.verdict, r.margin].join(',')).join('\n');
  const blob = new Blob([head + body], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `aerospec_test_register_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
