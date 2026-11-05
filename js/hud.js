/* =========================================================
   AEROSPEC — hud.js
   SVG gauges, mini tiles, rolling channel chart, terminal.
   All DOM-side presentation for the simulation view.
   ========================================================= */

export function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), ms = Math.floor((t % 1) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
export function setText(el, s) { if (el && el.textContent !== s) el.textContent = s; }

/* ---------------- SVG gauge ---------------- */
const A0 = -210;                       // dial sweep: −210° → +30°
const A1 = 30;
function pol(cx, cy, r, deg) {
  const a = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function arcPath(cx, cy, r, a0, a1) {
  const [x0, y0] = pol(cx, cy, r, a0), [x1, y1] = pol(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function createGauge(label, size, big) {
  const el = document.createElement('div');
  el.className = 'gauge' + (big ? ' g-big' : '');
  const cx = size / 2, cy = size / 2, r = size * 0.4;
  const ticks = [];
  for (let i = 0; i <= 8; i++) {
    const a = A0 + (A1 - A0) * i / 8;
    const [x0, y0] = pol(cx, cy, r, a), [x1, y1] = pol(cx, cy, r * 0.88, a);
    ticks.push(`<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="rgba(255,255,255,.25)" stroke-width="1"/>`);
  }
  el.innerHTML = `
    <svg width="${size}" height="${size * 0.86}" viewBox="0 0 ${size} ${size * 0.86}">
      <path d="${arcPath(cx, cy, r, A0, A1)}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="${big ? 5 : 4}" stroke-linecap="round"/>
      <path class="g-prog" d="" fill="none" stroke="#d8ff3d" stroke-width="${big ? 5 : 4}" stroke-linecap="round"/>
      ${ticks.join('')}
      <line class="g-needle" x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r * 0.8}" stroke="#eef1f4" stroke-width="1.6"/>
      <circle cx="${cx}" cy="${cy}" r="3" fill="#eef1f4"/>
      <text class="g-val" x="${cx}" y="${cy + (big ? 22 : 18)}" text-anchor="middle"
        font-family="Menlo,monospace" font-size="${big ? 17 : 13}" fill="#eef1f4">0</text>
      <text x="${cx}" y="${cy + (big ? 36 : 29)}" text-anchor="middle"
        font-size="6.5" letter-spacing="1.2" fill="#5f6873" font-family="Inter,sans-serif" font-weight="700">${label}</text>
    </svg>`;
  const prog = el.querySelector('.g-prog');
  const needle = el.querySelector('.g-needle');
  const valNum = el.querySelector('.g-val');
  let lastA = null;
  return {
    el,
    /** v fraction 0..1, display string, hot flag → amber/red */
    set(frac, display, tone = '') {
      frac = Math.min(1, Math.max(0, frac));
      const a = A0 + (A1 - A0) * frac;
      if (a !== lastA) {
        lastA = a;
        prog.setAttribute('d', arcPath(cx, cy, r, A0, Math.max(a, A0 + 0.01)));
        const [nx, ny] = pol(cx, cy, r * 0.8, a);
        needle.setAttribute('x2', nx); needle.setAttribute('y2', ny);
      }
      if (valNum.textContent !== display) valNum.textContent = display;
      const col = tone === 'crit' ? '#ff5148' : tone === 'warn' ? '#ffb03d' : '#d8ff3d';
      if (prog.getAttribute('stroke') !== col) prog.setAttribute('stroke', col);
    },
  };
}

/* ---------------- mini tiles ---------------- */
export function createTiles(root, defs) {
  const out = {};
  for (const [key, label] of defs) {
    const d = document.createElement('div');
    d.className = 'mini-tile';
    d.innerHTML = `<label>${label}</label><span class="mono">—</span><div class="mini-bar"><i></i></div>`;
    root.appendChild(d);
    out[key] = { val: d.querySelector('.mono'), bar: d.querySelector('.mini-bar i') };
  }
  return out;
}
export function setTile(tile, text, frac, tone = '') {
  setText(tile.val, text);
  tile.val.className = 'mono' + (tone ? ' ' + tone : '');
  tile.bar.style.width = `${Math.min(100, Math.max(0, frac * 100))}%`;
  tile.bar.className = tone;
}

/* ---------------- rolling channel chart ---------------- */
export class Chart {
  constructor(canvas, legendEl) {
    this.cv = canvas;
    this.cx = canvas.getContext('2d');
    this.legendEl = legendEl;
    this.hist = [];             // per-channel arrays
    this.channels = [];
    this.N = 240;
  }
  setChannels(chs) {
    this.channels = chs;
    this.hist = chs.map(() => []);
    this.legendEl.innerHTML = chs.map(c =>
      `<span><i class="lg" style="background:${c.color}"></i>${c.label}</span>`).join('');
  }
  push(sample) {
    this.channels.forEach((c, i) => {
      this.hist[i].push(sample[c.k] ?? 0);
      if (this.hist[i].length > this.N) this.hist[i].shift();
    });
  }
  clear() { for (const h of this.hist) h.length = 0; }
  draw() {
    const { cv, cx } = this;
    const dpr = devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (W < 2 || H < 2) return;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, W, H);
    cx.strokeStyle = 'rgba(255,255,255,0.10)';
    cx.lineWidth = 1;
    cx.font = '8px Menlo,monospace';
    cx.fillStyle = '#6b7480';
    for (let i = 0; i <= 4; i++) {
      const y = H * i / 4 + 0.5;
      cx.beginPath(); cx.moveTo(0, y); cx.lineTo(W, y); cx.stroke();
      const vmax = this.channels[0]?.max ?? 1;
      cx.fillText(`${Math.round(vmax * (1 - i / 4))}`, 3, y + 9);
    }
    for (let i = 1; i < 8; i++) {
      cx.beginPath(); cx.moveTo(W * i / 8 + 0.5, 0); cx.lineTo(W * i / 8 + 0.5, H); cx.stroke();
    }
    this.channels.forEach((c, ci) => {
      const hist = this.hist[ci];
      if (hist.length < 2) return;
      const max = c.max || 1;
      const off = this.N - hist.length;          // right-align the rolling window
      cx.beginPath();
      for (let i = 0; i < hist.length; i++) {
        const x = (i + off) / (this.N - 1) * W;
        const y = H - 3 - Math.min(1.05, Math.max(0, hist[i] / max)) * (H - 14);
        i ? cx.lineTo(x, y) : cx.moveTo(x, y);
      }
      cx.strokeStyle = c.color;
      cx.lineWidth = ci === 0 ? 1.8 : 1.2;
      cx.stroke();
      if (ci === 0) {
        cx.lineTo((hist.length - 1 + off) / (this.N - 1) * W, H);
        cx.lineTo(off / (this.N - 1) * W, H);
        cx.closePath();
        cx.fillStyle = c.color + '14';
        cx.fill();
      }
    });
  }
}

/* ---------------- terminal ---------------- */
export function makeTerm(el) {
  return {
    log(simT, msg, cls = 'sys') {
      const div = document.createElement('div');
      div.innerHTML = `<span class="t-time">${fmtTime(simT)}</span><span class="${cls}">&gt;&gt; ${msg}</span>`;
      el.appendChild(div);
      while (el.children.length > 46) el.removeChild(el.firstChild);
      el.scrollTop = el.scrollHeight;
    },
  };
}
