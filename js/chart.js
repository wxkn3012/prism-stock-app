/* ============================================================
 * chart.js — Canvas 图表引擎
 *  KLineChart : 蜡烛图 + 均线 + 成交量 + MACD，支持拖动/缩放/十字光标
 *  TimeChart  : 分时走势 + 均价线 + 成交量
 *  MiniSpark  : 自选列表缩略走势
 * ============================================================ */
const C = {
  up: '#ff4d4f', down: '#22c55e', upFill: 'rgba(255,77,79,.18)', downFill: 'rgba(34,197,94,.18)',
  grid: 'rgba(255,255,255,.045)', axis: '#5c6472', text: '#8b93a3',
  ma: ['#f5c451', '#54b0ff', '#c77dff', '#ff9f43'], yaxis: '#2a3038',
  cross: 'rgba(255,255,255,.5)',
};
const DP = window.devicePixelRatio || 1;

function setupCanvas(cv) {
  const r = cv.getBoundingClientRect();
  const w = Math.max(1, Math.floor(r.width));
  const h = Math.max(1, Math.floor(r.height));
  if (cv.width !== w * DP || cv.height !== h * DP) {
    cv.width = Math.round(w * DP); cv.height = Math.round(h * DP);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(DP, 0, 0, DP, 0, 0);
  return { ctx, w, h };
}
function line(ctx, x1, y1, x2, y2, color, w = 1, dash) {
  ctx.save(); ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = w;
  if (dash) ctx.setLineDash(dash);
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
}
function text(ctx, s, x, y, color = C.text, size = 10, align = 'left', weight = '400') {
  ctx.save(); ctx.fillStyle = color; ctx.font = `${weight} ${size}px -apple-system, "PingFang SC", sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y); ctx.restore();
}

/* ---------------- K 线 ---------------- */
class KLineChart {
  constructor(cv, opt = {}) {
    this.cv = cv;
    this.data = [];
    this.maConf = [5, 10, 20, 30];
    this.zoom = 1;
    this.offset = 0;        // 从最新往前偏移多少根
    this.showMA = true;
    this.showMACD = true;
    this.hover = -1;
    this.hoverY = null;
    this.onHover = opt.onHover;
    this._bind();
    this._ro = new ResizeObserver(() => this.draw());
    this._ro.observe(cv);
  }
  setData(d) {
    this.data = d || [];
    this.ma = this._ma();
    this.macd = this._macd();
    this.draw();
  }
  _ma() {
    const out = {};
    this.maConf.forEach((n) => {
      const arr = new Array(this.data.length).fill(null);
      let sum = 0;
      for (let i = 0; i < this.data.length; i++) {
        sum += this.data[i].close;
        if (i >= n) sum -= this.data[i - n].close;
        if (i >= n - 1) arr[i] = sum / n;
      }
      out[n] = arr;
    });
    return out;
  }
  _ema(arr, n) {
    const k = 2 / (n + 1); const out = [];
    arr.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
    return out;
  }
  _macd() {
    const closes = this.data.map((d) => d.close);
    const e12 = this._ema(closes, 12), e26 = this._ema(closes, 26);
    const dif = closes.map((_, i) => e12[i] - e26[i]);
    const dea = this._ema(dif, 9);
    const macd = dif.map((v, i) => (v - dea[i]) * 2);
    return { dif, dea, macd };
  }
  _bind() {
    let drag = null;
    const cv = this.cv;
    cv.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, off: this.offset };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (drag) {
        const bw = this._bw();
        const shift = Math.round((e.clientX - drag.x) / bw);
        this.offset = Math.max(0, Math.min(this.data.length - this._vis(), drag.off + shift));
      }
      this.hover = this._indexAt(x);
      this.hoverY = y;
      if (this.onHover) this.onHover(this.hover >= 0 ? this.data[this.hover] : null);
      this.draw();
    });
    const end = () => { drag = null; };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { drag = null; this.hover = -1; this.hoverY = null; if (this.onHover) this.onHover(null); this.draw(); });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.min(3, Math.max(0.25, this.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
      this.draw();
    }, { passive: false });
  }
  _vis() { return Math.max(12, Math.round(70 * this.zoom)); }
  _bw() { const { w } = this.cv.getBoundingClientRect(); return (w - 52) / this._vis(); }
  _indexAt(x) {
    const bw = this._bw();
    const i = Math.floor((x - 4) / bw);
    const end = this.data.length - this.offset;
    const start = Math.max(0, end - this._vis());
    const idx = start + i;
    return idx >= start && idx < end ? idx : -1;
  }
  _range() {
    const end = this.data.length - this.offset;
    const start = Math.max(0, end - this._vis());
    return { start, end: Math.min(this.data.length, end) };
  }
  draw() {
    if (!this.data.length) return;
    const { ctx, w, h } = setupCanvas(this.cv);
    ctx.clearRect(0, 0, w, h);
    const { start, end } = this._range();
    const slice = this.data.slice(start, end);
    if (!slice.length) return;

    const padL = 4, padR = 52;
    const plotW = w - padL - padR;
    const n = slice.length;
    const bw = plotW / n;
    const bodyW = Math.max(1, Math.min(bw * 0.68, 13));

    const volH = Math.round(h * 0.17);
    const macdH = this.showMACD ? Math.round(h * 0.2) : 0;
    const gap = 8;
    const mainTop = 18, mainBot = h - volH - macdH - gap * 2 - 16;

    // ---- 价格区间 ----
    let lo = Infinity, hi = -Infinity;
    slice.forEach((d) => { lo = Math.min(lo, d.low); hi = Math.max(hi, d.high); });
    if (this.showMA) [5, 10, 20, 30].forEach((m) => this.ma[m].slice(start, end).forEach((v) => {
      if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }));
    const pad = (hi - lo) * 0.08 || hi * 0.02;
    lo -= pad; hi += pad;
    const Y = (p) => mainTop + (hi - p) / (hi - lo) * (mainBot - mainTop);

    // ---- 网格 + 价格轴 ----
    ctx.save();
    for (let i = 0; i <= 4; i++) {
      const y = mainTop + (mainBot - mainTop) * i / 4;
      line(ctx, padL, y, w - padR, y, C.grid, 1);
      text(ctx, (hi - (hi - lo) * i / 4).toFixed(2), w - padR + 5, y, C.axis, 9.5);
    }
    ctx.restore();

    // ---- 日期轴 ----
    const step = Math.max(1, Math.round(n / 5));
    for (let i = 0; i < n; i += step) {
      const d = slice[i].date;
      if (!d) continue;
      text(ctx, d.slice(5).replace('-', '/'), padL + i * bw + bw / 2, mainBot + 9, C.axis, 9, 'center');
    }

    // ---- 蜡烛 ----
    slice.forEach((d, i) => {
      const xc = padL + i * bw + bw / 2;
      const up = d.close >= d.open;
      const col = up ? C.up : C.down;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(xc) + 0.5, Y(d.high));
      ctx.lineTo(Math.round(xc) + 0.5, Y(d.low));
      ctx.stroke();
      const yo = Y(d.open), yc = Y(d.close);
      const top = Math.min(yo, yc);
      const hh = Math.max(1, Math.abs(yc - yo));
      if (up) { // A股习惯：阳线空心/红，阴线实心/绿
        ctx.fillStyle = '#131820'; ctx.fillRect(xc - bodyW / 2, top, bodyW, hh);
        ctx.strokeRect(xc - bodyW / 2 + 0.5, top + 0.5, bodyW - 1, hh - 1);
      } else {
        ctx.fillRect(xc - bodyW / 2, top, bodyW, hh);
      }
    });

    // ---- 均线 ----
    if (this.showMA) {
      [5, 10, 20, 30].forEach((m, mi) => {
        const arr = this.ma[m].slice(start, end);
        ctx.beginPath(); ctx.strokeStyle = C.ma[mi]; ctx.lineWidth = 1.1;
        let started = false;
        arr.forEach((v, i) => {
          if (v == null) return;
          const x = padL + i * bw + bw / 2;
          if (!started) { ctx.moveTo(x, Y(v)); started = true; } else ctx.lineTo(x, Y(v));
        });
        ctx.stroke();
      });
      // 图例
      let lx = padL + 2;
      [5, 10, 20, 30].forEach((m, mi) => {
        const v = this.ma[m][end - 1];
        const s = `MA${m} ${v ? v.toFixed(2) : '--'}`;
        text(ctx, s, lx, 9, C.ma[mi], 9.5);
        lx += ctx.measureText ? 58 : 58;
      });
    }

    // ---- 成交量 ----
    const volTop = mainBot + 22;
    const volBot = volTop + volH - 20;
    let vmax = 0;
    slice.forEach((d) => { vmax = Math.max(vmax, d.vol); });
    slice.forEach((d, i) => {
      const xc = padL + i * bw + bw / 2;
      const hgt = vmax ? (d.vol / vmax) * (volBot - volTop) : 0;
      ctx.fillStyle = d.close >= d.open ? C.upFill : C.downFill;
      ctx.fillRect(xc - bodyW / 2, volBot - hgt, bodyW, hgt);
    });
    text(ctx, 'VOL ' + Store.fmtVol(slice[n - 1].vol), padL + 2, volTop - 6, C.text, 9.5);

    // ---- MACD ----
    if (this.showMACD) {
      const mTop = volBot + 24;
      const mBot = h - 4;
      const { dif, dea, macd } = this.macd;
      let mmax = 0;
      for (let i = start; i < end; i++) {
        mmax = Math.max(mmax, Math.abs(dif[i] || 0), Math.abs(dea[i] || 0), Math.abs(macd[i] || 0));
      }
      mmax = mmax || 1;
      const MY = (v) => mTop + (mmax - v) / (mmax * 2) * (mBot - mTop);
      const zero = MY(0);
      line(ctx, padL, zero, w - padR, zero, C.grid, 1);
      for (let i = start; i < end; i++) {
        const v = macd[i] || 0;
        const x = padL + (i - start) * bw + bw / 2;
        ctx.fillStyle = v >= 0 ? C.up : C.down;
        const y1 = MY(v), y2 = MY(0);
        ctx.fillRect(x - bodyW / 2, Math.min(y1, y2), bodyW, Math.max(1, Math.abs(y2 - y1)));
      }
      [[dif, C.ma[0]], [dea, C.ma[1]]].forEach(([arr, col], k) => {
        ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = 1.1;
        for (let i = start; i < end; i++) {
          const x = padL + (i - start) * bw + bw / 2;
          const y = MY(arr[i] || 0);
          if (i === start) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
      text(ctx, `MACD(${slice[n - 1] ? '' : ''}12,26,9)  DIF ${(dif[end - 1] || 0).toFixed(2)}  DEA ${(dea[end - 1] || 0).toFixed(2)}`, padL + 2, mTop - 4, C.text, 9.5);
    }

    // ---- 十字光标 ----
    if (this.hover >= start && this.hover < end) {
      const i = this.hover - start;
      const x = padL + i * bw + bw / 2;
      const d = this.data[this.hover];
      line(ctx, x, mainTop, x, h, C.cross, 1, [4, 3]);
      if (this.hoverY && this.hoverY > mainTop && this.hoverY < mainBot) {
        line(ctx, padL, this.hoverY, w - padR, this.hoverY, C.cross, 1, [4, 3]);
        const p = hi - (this.hoverY - mainTop) / (mainBot - mainTop) * (hi - lo);
        const label = p.toFixed(2);
        ctx.fillStyle = '#3a4250'; ctx.fillRect(w - padR + 1, this.hoverY - 9, padR - 2, 18);
        text(ctx, label, w - padR + 5, this.hoverY, '#fff', 10);
      }
      // 当日价格标签
      const y = Y(d.close);
      ctx.fillStyle = d.close >= d.open ? C.up : C.down;
      ctx.fillRect(w - padR + 1, y - 9, padR - 2, 18);
      text(ctx, d.close.toFixed(2), w - padR + 5, y, '#fff', 10, 'left', '600');
    }
  }
}

/* ---------------- 分时图 ---------------- */
class TimeChart {
  constructor(cv, opt = {}) {
    this.cv = cv;
    this.pts = [];
    this.prev = 0;
    this.onHover = opt.onHover;
    this.hover = -1;
    this._ro = new ResizeObserver(() => this.draw());
    this._ro.observe(cv);
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const i = Math.floor((x - 4) / ((r.width - 56) / 241));
      this.hover = i >= 0 && i < this.pts.length ? i : -1;
      if (this.onHover) this.onHover(this.hover >= 0 ? this.pts[this.hover] : null);
      this.draw();
    });
    cv.addEventListener('pointerleave', () => { this.hover = -1; if (this.onHover) this.onHover(null); this.draw(); });
  }
  setData(pts, prev) { this.pts = pts || []; this.prev = prev || (this.pts[0] && this.pts[0].price) || 0; this.draw(); }
  draw() {
    const { ctx, w, h } = setupCanvas(this.cv);
    ctx.clearRect(0, 0, w, h);
    if (!this.pts.length) return;
    const padL = 4, padR = 56;
    const plotW = w - padL - padR;
    const n = 241; // 一个交易日 241 个点
    const bw = plotW / n;
    const volH = Math.round(h * 0.22);
    const top = 12, bot = h - volH - 8;

    const prev = this.prev;
    let maxDev = 0;
    this.pts.forEach((p) => { maxDev = Math.max(maxDev, Math.abs(p.price - prev)); });
    this.pts.forEach((p, i) => {
      const avg = p.vol ? p.amount / (p.vol * 100) : p.price;
      maxDev = Math.max(maxDev, Math.abs(avg - prev));
    });
    maxDev = maxDev || prev * 0.01;
    const hi = prev + maxDev, lo = prev - maxDev;
    const Y = (p) => top + (hi - p) / (hi - lo) * (bot - top);

    // 网格：4 条 + 中间基准
    for (let i = 0; i <= 4; i++) {
      const y = top + (bot - top) * i / 4;
      line(ctx, padL, y, w - padR, y, i === 2 ? 'rgba(255,255,255,.14)' : C.grid, 1);
      const p = hi - (hi - lo) * i / 4;
      const pct = ((p - prev) / prev) * 100;
      text(ctx, p.toFixed(2), w - padR + 4, y - 6, p >= prev ? C.up : C.down, 9.5);
      text(ctx, (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%', w - padR + 4, y + 6, p >= prev ? C.up : C.down, 9);
    }
    ['09:30', '11:00', '13:00', '14:30'].forEach((t, i) => {
      const x = padL + (i / 4) * plotW + (i ? 0 : 4);
      text(ctx, t, i === 0 ? x : x, bot + 10, C.axis, 9, i === 0 ? 'left' : 'center');
    });

    // 价格线 + 渐变填充
    const avgOf = (p) => (p.vol ? p.amount / (p.vol * 100) : p.price);
    const grad = ctx.createLinearGradient(0, top, 0, bot);
    grad.addColorStop(0, 'rgba(96,165,250,.28)');
    grad.addColorStop(1, 'rgba(96,165,250,0)');
    ctx.beginPath();
    this.pts.forEach((p, i) => {
      const x = padL + i * bw + bw / 2;
      const y = Y(p.price);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    const lastX = padL + (this.pts.length - 1) * bw + bw / 2;
    ctx.lineTo(lastX, bot); ctx.lineTo(padL + bw / 2, bot); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    const last = this.pts[this.pts.length - 1];
    const lineCol = last.price >= prev ? C.up : C.down;
    ctx.beginPath(); ctx.strokeStyle = '#6aa9ff'; ctx.lineWidth = 1.4;
    this.pts.forEach((p, i) => {
      const x = padL + i * bw + bw / 2, y = Y(p.price);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 均价线
    ctx.beginPath(); ctx.strokeStyle = '#f5c451'; ctx.lineWidth = 1;
    this.pts.forEach((p, i) => {
      const x = padL + i * bw + bw / 2, y = Y(avgOf(p));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 成交量
    const vTop = bot + 18, vBot = h - 2;
    let vmax = 0;
    this.pts.forEach((p, i) => {
      const dv = i ? p.vol - this.pts[i - 1].vol : p.vol;
      vmax = Math.max(vmax, dv);
    });
    this.pts.forEach((p, i) => {
      const dv = i ? p.vol - this.pts[i - 1].vol : p.vol;
      const x = padL + i * bw;
      const hgt = vmax ? (dv / vmax) * (vBot - vTop) : 0;
      ctx.fillStyle = p.price >= (i ? this.pts[i - 1].price : prev) ? 'rgba(255,77,79,.55)' : 'rgba(34,197,94,.55)';
      ctx.fillRect(x, vBot - hgt, Math.max(1, bw * 0.9), hgt);
    });

    // 最新价标记
    const y = Y(last.price);
    line(ctx, padL, y, w - padR, y, lineCol + '66', 1, [3, 3]);
    ctx.fillStyle = lineCol;
    ctx.fillRect(w - padR + 1, y - 18, padR - 2, 15);
    text(ctx, last.price.toFixed(2), w - padR + 4, y - 10.5, '#fff', 9.5, 'left', '600');

    // 十字光标
    if (this.hover >= 0 && this.hover < this.pts.length) {
      const p = this.pts[this.hover];
      const x = padL + this.hover * bw + bw / 2;
      line(ctx, x, top, x, h, C.cross, 1, [4, 3]);
      const yy = Y(p.price);
      line(ctx, padL, yy, w - padR, yy, C.cross, 1, [4, 3]);
      ctx.fillStyle = '#3a4250'; ctx.fillRect(w - padR + 1, yy - 9, padR - 2, 18);
      text(ctx, p.price.toFixed(2), w - padR + 4, yy, '#fff', 9.5);
    }
  }
}

/* ---------------- 迷你走势 ---------------- */
function drawSpark(cv, closes, prevClose) {
  const { ctx, w, h } = setupCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  if (!closes || closes.length < 2) return;
  let lo = Math.min(...closes), hi = Math.max(...closes);
  if (prevClose) { lo = Math.min(lo, prevClose); hi = Math.max(hi, prevClose); }
  const pad = (hi - lo) * 0.15 || 1;
  lo -= pad; hi += pad;
  const X = (i) => (i / (closes.length - 1)) * (w - 2) + 1;
  const Y = (v) => h - ((v - lo) / (hi - lo)) * (h - 4) - 2;
  const up = closes[closes.length - 1] >= (prevClose || closes[0]);
  const col = up ? C.up : C.down;
  ctx.beginPath();
  ctx.moveTo(X(0), Y(closes[0]));
  closes.forEach((v, i) => ctx.lineTo(X(i), Y(v)));
  ctx.lineTo(X(closes.length - 1), h); ctx.lineTo(X(0), h); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, up ? C.upFill : C.downFill);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fill();
  ctx.beginPath();
  closes.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
  ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke();
}
