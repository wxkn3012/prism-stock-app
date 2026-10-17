/* ============================================================
 * app.js — 应用主逻辑
 * ============================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = Store.fmt, fmtBig = Store.fmtBig, fmtVol = Store.fmtVol;

/* ---------- 全局状态 ---------- */
const S = {
  tab: 'watch',
  quotes: {},            // code -> quote
  watchQuotes: [],
  indices: [],
  detail: null,          // {code,name,period,chart}
  rankType: 'priceRatio',
  rankDir: 'down',
  rankCache: {},
  newsCache: null,
  sectorCache: null,
  loading: false,
  marketOpen: false,
};

const IDX = ['sh000001', 'sz399001', 'sz399006', 'sh000688'];
const IDX_NAME = { sh000001: '上证指数', sz399001: '深证成指', sz399006: '创业板指', sh000688: '科创50' };
const SPARK_STORE = JSON.parse(localStorage.getItem('stockapp.spark') || '{}');

/* ---------- 工具 ---------- */
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
const clsBg = (v) => (v > 0 ? 'up-bg' : v < 0 ? 'down-bg' : 'flat-bg');
const sgn = (v, d = 2) => (v > 0 ? '+' : '') + v.toFixed(d);
const pctTxt = (v) => (v > 0 ? '+' : '') + v.toFixed(2) + '%';
const money = (v) => (v >= 0 ? '' : '-') + '¥' + fmt(Math.abs(v));

let toastTimer;
function toast(msg, ms = 1800) {
  const el = $('#toast');
  el.innerHTML = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

function marketStatus() {
  const d = new Date();
  const day = d.getDay();
  if (day === 0 || day === 6) return { open: false, txt: '休市' };
  const t = d.getHours() * 60 + d.getMinutes();
  const am1 = 9 * 60 + 30, am2 = 11 * 60 + 30, pm1 = 13 * 60, pm2 = 15 * 60;
  if (t >= am1 && t < am2) return { open: true, txt: '交易中' };
  if (t >= pm1 && t < pm2) return { open: true, txt: '交易中' };
  if (t >= am2 && t < pm1) return { open: false, txt: '午间休市' };
  if (t >= 9 * 60 + 15 && t < am1) return { open: false, txt: '集合竞价' };
  if (t < 9 * 60 + 15) return { open: false, txt: '未开盘' };
  return { open: false, txt: '已收盘' };
}

/* ---------- 初始加载 ---------- */
async function bootstrap() {
  const ms = marketStatus();
  S.marketOpen = ms.open;
  $('#mktTxt').textContent = ms.txt;
  $('#mktDot').classList.toggle('closed', !ms.open);

  renderWatchLoading();
  await refreshAll();
  renderWatch();
  renderMarket();
  renderTrade();
  Store.settleT1();
}

async function refreshAll(silent) {
  if (S.loading) return;
  S.loading = true;
  const codes = Store.get().watch.slice(0, 40);
  const all = [...new Set([...IDX, ...codes])];
  try {
    const qs = await API.quotes(all);
    qs.forEach((q) => { S.quotes[q.code] = q; });
    S.watchQuotes = codes.map((c) => S.quotes[c]).filter(Boolean);
    S.indices = IDX.map((c) => S.quotes[c]).filter(Boolean);
    // 缓存成功
    API.disk['q_' + all.join(',')] = { t: Date.now(), v: qs };
    API.saveDisk();
    updateHeader();
    paintWatch();
    paintIndices();
    paintTrade();
    if (S.detail && S.quotes[S.detail.code]) paintDetailHeader(S.quotes[S.detail.code]);
  } catch (e) {
    // 离线：用缓存
    const key = Object.keys(API.disk).filter((k) => k.startsWith('q_')).pop();
    if (key && API.disk[key]) {
      const qs = API.disk[key].v;
      qs.forEach((q) => { S.quotes[q.code] = q; });
      S.watchQuotes = codes.map((c) => S.quotes[c]).filter(Boolean);
      S.indices = IDX.map((c) => S.quotes[c]).filter(Boolean);
      paintWatch(); paintIndices(); paintTrade();
      if (!silent) toast('网络异常，显示缓存行情');
    } else if (!silent) {
      toast('行情获取失败，请检查网络');
    }
  } finally {
    S.loading = false;
  }
}

function updateHeader() {
  const el = $('#mktTxt');
  const idx = S.quotes['sh000001'];
  if (idx) {
    el.innerHTML = `<span class="num ${cls(idx.pct)}">${idx.price.toFixed(2)} ${pctTxt(idx.pct)}</span>`;
  }
}

/* ================= 自选页 ================= */
function renderWatchLoading() {
  $('#v-watch').innerHTML = `
    ${idxSkeleton()}
    <div class="px"><div class="sec-title"><h3>自选</h3><span class="more">加载中…</span></div></div>
    ${Array(6).fill(`<div class="stock-row"><div class="nm"><div class="skel" style="width:64px;height:14px"></div><div class="skel" style="width:40px;height:9px;margin-top:6px"></div></div><div class="skel" style="width:52px;height:16px;margin-left:auto"></div><div class="skel" style="width:56px;height:22px"></div><div></div></div>`).join('')}
  `;
}
function idxSkeleton() {
  return `<div class="idx-row">${IDX.map((c) => `<div class="idx-card"><div class="n">${IDX_NAME[c]}</div><div class="skel" style="width:70px;height:19px;margin:6px 0"></div><div class="skel" style="width:52px;height:10px"></div></div>`).join('')}</div>`;
}

function renderWatch() {
  const w = Store.get().watch;
  const v = $('#v-watch');
  v.innerHTML = `
    ${idxSkeleton()}
    <div class="px">
      <div class="sec-title">
        <h3>自选 <span style="font-size:11px;color:var(--txt3);font-weight:400">${w.length}只</span></h3>
        <span class="more" id="watchEdit" style="cursor:pointer">编辑</span>
      </div>
    </div>
    <div class="stock-list" id="watchList"></div>
    <div class="px" style="margin-top:14px">
      <button class="btn-ghost" id="addWatch" style="width:100%;height:42px;border-style:dashed">＋ 添加自选股</button>
    </div>
  `;
  $('#addWatch').onclick = openSearch;
  $('#watchEdit').onclick = () => toast('长按列表项可删除自选');
  paintIndices();
  paintWatch();
}

function paintIndices() {
  const row = $('.idx-row');
  if (!row) return;
  row.innerHTML = S.indices.length ? S.indices.map((q) => {
    const sp = SPARK_STORE[q.code] || [];
    return `<div class="idx-card" data-code="${q.code}">
      <div class="n">${esc(IDX_NAME[q.code] || q.name)}</div>
      <div class="p num ${cls(q.pct)}">${q.price.toFixed(2)}</div>
      <div class="c num ${cls(q.pct)}">${sgn(q.chg)} ${pctTxt(q.pct)}</div>
      <canvas class="spark" data-c="${q.code}"></canvas>
    </div>`;
  }).join('') : IDX.map((c) => `<div class="idx-card"><div class="n">${IDX_NAME[c]}</div><div class="p num">--</div></div>`).join('');

  $$('.idx-card').forEach((el) => {
    el.onclick = () => openDetail(el.dataset.code, IDX_NAME[el.dataset.code]);
  });
  requestAnimationFrame(() => {
    $$('canvas.spark').forEach((cv) => {
      const c = cv.dataset.c;
      drawSpark(cv, SPARK_STORE[c] || [1, 1.001], S.quotes[c] ? S.quotes[c].prev : 0);
    });
  });
}

function paintWatch() {
  const list = $('#watchList');
  if (!list) return;
  const w = Store.get().watch;
  if (!w.length) {
    list.innerHTML = `<div class="empty"><b>还没有自选股</b>添加关注的股票，随时掌握行情</div>`;
    return;
  }
  if (!S.watchQuotes.length) {
    list.innerHTML = `<div class="empty"><b>行情加载失败</b>点击右上角刷新重试</div>`;
    return;
  }
  list.innerHTML = S.watchQuotes.map((q) => `
    <div class="stock-row" data-code="${q.code}">
      <div class="nm"><b>${esc(q.name)}</b><span>${q.sym} · ${marketTag(q.code)}</span></div>
      <div class="pr num ${cls(q.pct)}">${q.price.toFixed(2)}</div>
      <div class="pc num ${clsBg(q.pct)}">${pctTxt(q.pct)}</div>
      <canvas class="mini" data-c="${q.code}"></canvas>
    </div>`).join('');

  $$('.stock-row', list).forEach((row) => {
    const code = row.dataset.code;
    row.onclick = () => openDetail(code, (S.quotes[code] || {}).name);
    let lp;
    row.addEventListener('pointerdown', () => {
      lp = setTimeout(() => { removeWatch(code); }, 620);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) =>
      row.addEventListener(ev, () => clearTimeout(lp)));
  });

  requestAnimationFrame(() => {
    $$('canvas.mini', list).forEach((cv) => {
      const c = cv.dataset.c;
      const sp = SPARK_STORE[c];
      if (sp && sp.length > 1) drawSpark(cv, sp, S.quotes[c] ? S.quotes[c].prev : 0);
      else if (S.quotes[c]) drawSpark(cv, [S.quotes[c].prev, S.quotes[c].price], S.quotes[c].prev);
    });
  });
  loadSparks(S.watchQuotes.map((q) => q.code));
}

const sparkQueue = new Set();
let sparkTimer;
function loadSparks(codes) {
  codes.forEach((c) => { if (!SPARK_STORE[c]) sparkQueue.add(c); });
  clearTimeout(sparkTimer);
  sparkTimer = setTimeout(async () => {
    const arr = Array.from(sparkQueue).slice(0, 30);
    sparkQueue.clear();
    for (const c of arr) {
      try {
        const k = await API.kline(c, 'day', 30, 'qfq');
        SPARK_STORE[c] = k.map((d) => d.close);
      } catch (e) { /* 忽略 */ }
    }
    try { localStorage.setItem('stockapp.spark', JSON.stringify(SPARK_STORE)); } catch (e) {}
    $$('canvas.mini').forEach((cv) => {
      const c = cv.dataset.c;
      if (SPARK_STORE[c]) drawSpark(cv, SPARK_STORE[c], S.quotes[c] ? S.quotes[c].prev : 0);
    });
    $$('canvas.spark').forEach((cv) => {
      const c = cv.dataset.c;
      if (SPARK_STORE[c]) drawSpark(cv, SPARK_STORE[c], S.quotes[c] ? S.quotes[c].prev : 0);
    });
  }, 300);
}

function marketTag(code) {
  if (code.startsWith('sh688')) return '科创';
  if (code.startsWith('sz30')) return '创业板';
  if (code.startsWith('bj')) return '北交所';
  if (code.startsWith('sh')) return '沪市';
  if (code.startsWith('sz')) return '深市';
  return '市场';
}

function removeWatch(code) {
  const q = S.quotes[code];
  if (!confirm(`从自选中删除 ${q ? q.name : code}？`)) return;
  Store.toggleWatch(code);
  S.watchQuotes = S.watchQuotes.filter((x) => x.code !== code);
  renderWatch();
  toast('已删除');
}

/* ================= 行情页 ================= */
const RANK_TYPES = [
  { k: 'priceRatio', d: 'down', n: '涨幅榜' },
  { k: 'priceRatio', d: 'up', n: '跌幅榜' },
  { k: 'turnover', d: 'down', n: '成交额' },
  { k: 'hsl', d: 'down', n: '换手率' },
  { k: 'speed', d: 'down', n: '涨速榜' },
];

function renderMarket() {
  const v = $('#v-market');
  v.innerHTML = `
    <div class="search-bar" id="mktSearch">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
      <input placeholder="搜索股票代码 / 名称 / 拼音" readonly />
    </div>
    <div class="rank-tabs" id="rankTabs">
      ${RANK_TYPES.map((t, i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-i="${i}">${t.n}</button>`).join('')}
    </div>
    <div class="rank-head"><span>#</span><span>名称/代码</span><span>最新价</span><span>涨跌幅</span></div>
    <div id="rankList">${skelRows(8)}</div>

    <div class="px"><div class="sec-title"><h3>行业板块</h3><span class="more" id="secMore">全部 ›</span></div></div>
    <div class="heat-grid" id="heatGrid">${Array(9).fill(`<div class="skel" style="height:58px"></div>`).join('')}</div>
    <div style="height:10px"></div>
  `;
  $('#mktSearch').onclick = openSearch;
  $$('#rankTabs .chip').forEach((b) => {
    b.onclick = () => {
      $$('#rankTabs .chip').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const t = RANK_TYPES[+b.dataset.i];
      S.rankType = t.k; S.rankDir = t.d;
      loadRank();
    };
  });
  $('#secMore').onclick = () => toast('板块热力按涨跌幅排序');
  loadRank();
  loadSectors();
}

function skelRows(n) {
  return Array(n).fill(`<div class="rank-row"><span class="skel" style="width:12px;height:12px"></span><div><div class="skel" style="width:78px;height:13px"></div><div class="skel" style="width:44px;height:9px;margin-top:5px"></div></div><div class="skel" style="width:50px;height:14px;margin-left:auto"></div><div class="skel" style="width:52px;height:14px;margin-left:auto"></div></div>`).join('');
}

async function loadRank() {
  const key = S.rankType + S.rankDir;
  const box = $('#rankList');
  if (!box) return;
  if (S.rankCache[key]) { paintRank(S.rankCache[key], key); return; }
  box.innerHTML = skelRows(8);
  try {
    const rows = await API.rank({ sort: S.rankType, dir: S.rankDir, count: 30 });
    S.rankCache[key] = rows;
    rows.forEach((r) => {
      S.quotes[r.code] = S.quotes[r.code] || {
        code: r.code, name: r.name, price: r.price, pct: r.pct, chg: r.chg, prev: r.price - r.chg, sym: r.code.slice(2),
      };
    });
    paintRank(rows, key);
  } catch (e) {
    box.innerHTML = `<div class="empty"><b>榜单加载失败</b>${esc(e.message || '')}<br/>接口可能被限流，稍后重试</div>`;
  }
}

function paintRank(rows) {
  const box = $('#rankList');
  if (!box) return;
  const third = S.rankType === 'turnover' ? (r) => (r.turnover / 1e8).toFixed(1) + '亿'
    : S.rankType === 'hsl' ? (r) => r.turnoverRate.toFixed(2) + '%'
      : S.rankType === 'speed' ? (r) => sgn(r.speed) + '%'
        : (r) => r.price.toFixed(2);
  box.innerHTML = rows.map((r, i) => `
    <div class="rank-row" data-code="${r.code}" data-name="${esc(r.name)}">
      <span class="rk ${i < 3 ? 'top' : ''}">${i + 1}</span>
      <div class="nm"><b>${esc(r.name)}</b><span>${r.code.slice(2)}</span></div>
      <div class="pr num ${cls(r.pct)}">${third(r)}</div>
      <div class="pct num ${cls(r.pct)}">${pctTxt(r.pct)}</div>
    </div>`).join('');
  $$('#rankList .rank-row').forEach((el) => {
    el.onclick = () => openDetail(el.dataset.code, el.dataset.name);
  });
}

async function loadSectors() {
  const grid = $('#heatGrid');
  if (!grid) return;
  try {
    const list = S.sectorCache || await API.sectors('down', 30);
    S.sectorCache = list;
    const max = Math.max(...list.map((s) => Math.abs(s.pct)), 0.01);
    grid.innerHTML = list.slice(0, 30).map((s) => {
      const a = Math.min(1, Math.abs(s.pct) / max);
      const bg = s.pct >= 0
        ? `rgba(255,77,79,${(0.08 + a * 0.62).toFixed(2)})`
        : `rgba(34,197,94,${(0.08 + a * 0.62).toFixed(2)})`;
      return `<div class="heat-cell" style="background:${bg}" data-name="${esc(s.name)}" data-lead="${s.lead ? esc(s.lead.name) : ''}">
        <b>${esc(s.name)}</b>
        <div style="display:flex;justify-content:space-between;align-items:flex-end">
          <em class="num" style="color:${s.pct >= 0 ? '#ffd9d9' : '#c8f5d8'}">${pctTxt(s.pct)}</em>
        </div>
      </div>`;
    }).join('');
    $$('#heatGrid .heat-cell').forEach((el) => {
      el.onclick = () => {
        const lead = el.dataset.lead;
        toast(`${el.dataset.name}${lead ? '<br/>领涨：' + lead : ''}`, 1600);
      };
    });
  } catch (e) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">板块数据加载失败</div>`;
  }
}

/* ================= 详情页 ================= */
let klChart = null, tmChart = null;

async function openDetail(code, name) {
  const q = S.quotes[code];
  S.detail = { code, name: name || (q && q.name) || code, period: 'day', fq: 'qfq', view: 'kline' };
  switchTab('detail', true);

  const v = $('#v-detail');
  v.innerHTML = `
    <div class="detail-head" id="dh">
      <div class="dh-top">
        <div>
          <div class="dh-name">${esc(S.detail.name)}</div>
          <div class="dh-code">${code.slice(2)} · ${marketTag(code)}</div>
        </div>
        <button class="watch-btn" id="btnWatch">
          <svg viewBox="0 0 24 24"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/></svg>
          <span>${Store.inWatch(code) ? '已自选' : '自选'}</span>
        </button>
      </div>
      <div class="dh-price"><span class="big num">--</span></div>
      <div class="dh-sub"></div>
    </div>
    <div class="period-tabs">
      <button class="ptab active" data-p="day">日K</button>
      <button class="ptab" data-p="week">周K</button>
      <button class="ptab" data-p="month">月K</button>
      <button class="ptab" data-p="min">分时</button>
      <div style="margin-left:auto;display:flex;gap:6px">
        <button class="ptab active" id="fqQ">前复权</button>
      </div>
    </div>
    <div class="chart-wrap">
      <canvas id="mainChart"></canvas>
      <div class="chart-empty" id="chartEmpty" style="display:none">图表数据加载中…</div>
      <div class="chart-tools">
        <button id="tMA" class="on">MA</button>
        <button id="tMACD" class="on">MACD</button>
      </div>
    </div>
    <div class="detail-grid" id="detailGrid"></div>
    <div class="depth" id="depth"></div>
    <div class="action-bar">
      <button class="btn-ghost" id="btnNews">资讯</button>
      <button class="btn-buy" id="btnBuy">买入</button>
      <button class="btn-sell" id="btnSell">卖出</button>
    </div>
  `;

  $('#btnWatch').onclick = () => {
    const on = Store.toggleWatch(code);
    $('#btnWatch').classList.toggle('on', on);
    $('#btnWatch span').textContent = on ? '已自选' : '自选';
    if ($('#watchList')) { S.watchQuotes = Store.get().watch.map((c) => S.quotes[c]).filter(Boolean); renderWatch(); }
    toast(on ? '已加入自选' : '已移出自选');
  };
  $('#btnWatch').classList.toggle('on', Store.inWatch(code));

  $$('.period-tabs .ptab[data-p]').forEach((b) => {
    b.onclick = () => {
      $$('.period-tabs .ptab[data-p]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const p = b.dataset.p;
      S.detail.period = p;
      loadChart(p);
    };
  });

  $('#tMA').onclick = (e) => {
    e.target.classList.toggle('on');
    if (klChart) { klChart.showMA = e.target.classList.contains('on'); klChart.draw(); }
  };
  $('#tMACD').onclick = (e) => {
    e.target.classList.toggle('on');
    if (klChart) { klChart.showMACD = e.target.classList.contains('on'); klChart.draw(); }
  };

  $('#btnBuy').onclick = () => openOrder(code, 'buy');
  $('#btnSell').onclick = () => openOrder(code, 'sell');
  $('#btnNews').onclick = () => { switchTab('news'); };

  // 头部
  if (q) paintDetailHeader(q);
  else {
    try {
      const [qq] = await API.quotes([code]);
      if (qq) { S.quotes[code] = qq; S.detail.name = qq.name; $('.dh-name').textContent = qq.name; paintDetailHeader(qq); }
    } catch (e) {}
  }
  loadChart('day');
}

function paintDetailHeader(q) {
  const dh = $('#dh');
  if (!dh) return;
  $('.dh-name', dh).textContent = q.name;
  $('.dh-price', dh).innerHTML = `
    <span class="big num ${cls(q.pct)}">${q.price.toFixed(2)}</span>
    <span class="chg num ${cls(q.pct)}">${sgn(q.chg)}　${pctTxt(q.pct)}</span>`;
  $('.dh-sub', dh).innerHTML = `
    <span>今开 <b class="num ${cls(q.open - q.prev)}">${q.open.toFixed(2)}</b></span>
    <span>最高 <b class="num ${cls(q.high - q.prev)}">${q.high.toFixed(2)}</b></span>
    <span>最低 <b class="num ${cls(q.low - q.prev)}">${q.low.toFixed(2)}</b></span>
    <span>昨收 <b class="num">${q.prev.toFixed(2)}</b></span>`;

  const g = $('#detailGrid');
  if (g) {
    g.innerHTML = [
      ['成交量', fmtVol(q.vol)],
      ['成交额', '¥' + fmtBig(q.amount)],
      ['换手率', q.turnover ? q.turnover.toFixed(2) + '%' : '--'],
      ['市盈率TTM', q.pe ? q.pe.toFixed(2) : '亏损'],
      ['市净率', q.pb ? q.pb.toFixed(2) : '--'],
      ['总市值', '¥' + fmtBig(q.totalCap)],
      ['流通市值', '¥' + fmtBig(q.floatCap)],
      ['振幅', q.amplitude ? q.amplitude.toFixed(2) + '%' : '--'],
      ['量比', q.volRatio ? q.volRatio.toFixed(2) : '--'],
    ].map(([k, v]) => `<div class="g"><i>${k}</i><b>${v}</b></div>`).join('');
  }
  const d = $('#depth');
  if (d) {
    const maxV = Math.max(...[...q.bid, ...q.ask].map((x) => x.v), 1);
    const row = (lvl, p, v, side) => `<div class="lvl ${side}">
      <div class="bar" style="width:${(v / maxV * 100).toFixed(0)}%"></div>
      <span>${lvl}</span><span class="num ${side === 'ask' ? 'up' : 'down'}">${p ? p.toFixed(2) : '--'}</span><span class="v num">${v || ''}</span></div>`;
    const asks = [...q.ask].reverse().map((a, i) => row('卖' + (q.ask.length - i), a.p, a.v, 'ask'));
    const bids = q.bid.map((b, i) => row('买' + (i + 1), b.p, b.v, 'bid'));
    d.innerHTML = `<div>${asks.join('')}</div><div>${bids.join('')}</div>`;
  }
}

async function loadChart(period) {
  const cv = $('#mainChart');
  if (!cv) return;
  const { code } = S.detail;
  if (period === 'min') {
    klChart = null;
    if (!tmChart) tmChart = new TimeChart(cv, {
      onHover: (p) => {
        const el = $('#dh .dh-sub');
        if (!el) return;
        if (!p) { const q = S.quotes[code]; if (q) paintDetailHeader(q); return; }
        const prev = tmChart.prev || p.price;
        const pct = ((p.price - prev) / prev) * 100;
        el.innerHTML = `<span>时间 <b>${p.t.slice(0, 2)}:${p.t.slice(2)}</b></span>
          <span>价格 <b class="num ${cls(p.price - prev)}">${p.price.toFixed(2)}</b></span>
          <span>涨跌 <b class="num ${cls(pct)}">${pctTxt(pct)}</b></span>`;
      },
    });
    else tmChart.cv = cv;
    const emp = $('#chartEmpty');
    if (emp) { emp.style.display = 'block'; emp.textContent = '分时加载中…'; }
    try {
      const m = await API.minute(code);
      const q = S.quotes[code];
      tmChart.setData(m.pts, (q && q.prev) || m.prev || (m.pts[0] && m.pts[0].price));
      if (emp) emp.style.display = 'none';
    } catch (e) { if (emp) { emp.style.display = 'block'; emp.textContent = '分时获取失败（可能已收盘）'; } }
    return;
  }
  tmChart = null;
  if (!klChart) klChart = new KLineChart(cv, {
    onHover: (d) => {
      if (!d) { const q = S.quotes[code]; if (q) paintDetailHeader(q); return; }
      const el = $('#dh .dh-sub');
      if (!el) return;
      const pct = ((d.close - d.open) / d.open) * 100;
      el.innerHTML = `<span>${d.date}</span><span>开 <b class="num">${d.open.toFixed(2)}</b></span>
        <span>高 <b class="num up">${d.high.toFixed(2)}</b></span><span>低 <b class="num down">${d.low.toFixed(2)}</b></span>
        <span>收 <b class="num ${cls(pct)}">${d.close.toFixed(2)}</b></span>`;
    },
  });
  else klChart.cv = cv;
  klChart._ro.disconnect(); klChart._ro.observe(cv);
  const emp = $('#chartEmpty');
  if (emp) { emp.style.display = 'block'; emp.textContent = 'K线加载中…'; }
  try {
    const data = await API.kline(code, period, period === 'day' ? 180 : period === 'week' ? 160 : 120, 'qfq');
    klChart.setData(data);
    if (emp) emp.style.display = 'none';
  } catch (e) {
    if (emp) { emp.style.display = 'block'; emp.textContent = 'K线获取失败，点右上角⟳重试'; }
  }
}

/* ================= 交易页 ================= */
function renderTrade() {
  const v = $('#v-trade');
  v.innerHTML = `
    <div class="acct-card" id="acctCard"></div>
    <div class="px">
      <div class="sec-title"><h3>持仓</h3><span class="more" id="posMore">成交记录 ›</span></div>
    </div>
    <div id="posList"></div>
    <div class="px" style="margin-top:18px">
      <div class="sec-title"><h3>快捷交易</h3></div>
    </div>
    <div class="rank-tabs">
      <button class="chip active" id="quickBuy">快速买入</button>
      <button class="chip" id="quickSell">快速卖出</button>
      <button class="chip" id="btnReset">重置账户</button>
    </div>
    <div style="height:6px"></div>
  `;
  $('#quickBuy').onclick = openSearch;
  $('#quickSell').onclick = () => {
    const s = Store.summary(S.quotes);
    if (!s.list.length) return toast('当前没有持仓');
    openOrder(s.list[0].code, 'sell');
  };
  $('#btnReset').onclick = () => {
    if (!confirm('重置账户？将清空持仓与成交记录，资金恢复为 ¥1,000,000')) return;
    Store.reset();
    renderTrade();
    toast('账户已重置');
  };
  $('#posMore').onclick = openTrades;
  paintTrade();
}

function paintTrade() {
  const card = $('#acctCard');
  if (!card) return;
  const s = Store.summary(S.quotes);
  card.innerHTML = `
    <div class="lbl">总资产（元）
      <span style="margin-left:auto;font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(245,196,81,.15);color:var(--gold)">模拟盘</span>
    </div>
    <div class="tot num">${fmt(s.total)}</div>
    <div class="day num ${cls(s.dayPnl)}">今日 ${s.dayPnl >= 0 ? '+' : ''}${fmt(s.dayPnl)}　(${pctTxt(s.total ? s.dayPnl / (s.total - s.dayPnl) * 100 : 0)})</div>
    <div class="acct-split">
      <div><i>可用资金</i><b class="num">${fmt(s.cash)}</b></div>
      <div><i>持仓市值</i><b class="num">${fmt(s.marketValue)}</b></div>
      <div><i>累计盈亏</i><b class="num ${cls(s.totalPnl)}">${s.totalPnl >= 0 ? '+' : ''}${fmt(s.totalPnl)}</b></div>
    </div>
  `;

  const box = $('#posList');
  if (!box) return;
  if (!s.list.length) {
    box.innerHTML = `<div class="empty"><b>暂无持仓</b>用 ¥1,000,000 模拟资金开始练习交易</div>`;
    return;
  }
  box.innerHTML = s.list.map((p) => `
    <div class="pos-row" data-code="${p.code}">
      <div class="pos-top">
        <b>${esc(p.name)}</b>
        <span class="pnl num ${cls(p.pnl)}">${p.pnl >= 0 ? '+' : ''}${fmt(p.pnl)}</span>
      </div>
      <div class="pos-mid">
        <span>持仓 <em>${p.qty}</em></span>
        <span>可用 <em>${p.avail}</em></span>
        <span>成本 <em>${p.cost.toFixed(2)}</em></span>
        <span>现价 <em class="${cls(p.pct)}">${p.price.toFixed(2)}</em></span>
        <span class="${cls(p.pnl)}">${sgn(p.pnlPct)}%</span>
      </div>
      <div class="pos-actions">
        <button class="b" data-act="buy">加仓</button>
        <button class="s" data-act="sell">卖出</button>
      </div>
    </div>`).join('');

  $$('#posList .pos-row').forEach((row) => {
    const code = row.dataset.code;
    row.addEventListener('click', (e) => {
      const act = e.target.dataset.act;
      if (act) { e.stopPropagation(); openOrder(code, act); return; }
      openDetail(code, (S.quotes[code] || {}).name);
    });
  });
}

/* ---------- 下单弹层 ---------- */
let orderCtx = null;
function openOrder(code, side) {
  const q = S.quotes[code];
  const s = Store.summary(S.quotes);
  const name = (q && q.name) || (S.detail && S.detail.code === code ? S.detail.name : code);
  const price = q ? q.price : 0;
  const pos = Store.get().positions[code];
  const maxBuy = q && q.price > 0 ? Math.floor(s.cash / (q.price * 1.0006) / 100) * 100 : 0;
  const maxSell = pos ? pos.avail : 0;

  orderCtx = { code, name, side, price, maxBuy, maxSell };

  const body = `
    <div class="sheet-handle"></div>
    <h4>${side === 'buy' ? '买入' : '卖出'} ${esc(name)}</h4>
    <div class="sub">${code.slice(2)} · ${q ? `现价 ${q.price.toFixed(2)} <span class="${cls(q.pct)}">${pctTxt(q.pct)}</span>` : '价格加载中'} · 模拟成交</div>
    <div class="field"><label>委托价格</label><input id="ordPrice" type="number" step="0.01" value="${price ? price.toFixed(2) : ''}" inputmode="decimal" /></div>
    <div class="field"><label>委托数量（股）</label><input id="ordQty" type="number" step="100" value="" placeholder="100的整数倍" inputmode="numeric" /></div>
    <div class="stepper">
      <button data-f="0.25">1/4</button><button data-f="0.33">1/3</button>
      <button data-f="0.5">1/2</button><button data-f="1">全部</button>
    </div>
    <div class="sheet-summary" id="ordSum"></div>
    <button class="sheet-go" id="ordGo" style="background:${side === 'buy' ? 'linear-gradient(135deg,#ff5c5e,#d9302c)' : 'linear-gradient(135deg,#2bc06a,#14874a)'}">
      确认${side === 'buy' ? '买入' : '卖出'}
    </button>
    <div style="font-size:10.5px;color:var(--txt3);margin-top:10px;line-height:1.7">
      可用资金 ¥${fmt(s.cash)}${side === 'sell' ? ` · 可卖 ${maxSell} 股` : ` · 最多可买 ${maxBuy} 股`}<br/>
      佣金万2.5（最低5元），卖出印花税0.05%；A股T+1，当日买入次日可卖。
    </div>
  `;
  showSheet(body);
  const priceEl = $('#ordPrice'), qtyEl = $('#ordQty');
  const update = () => {
    const p = parseFloat(priceEl.value) || 0;
    const qty = Math.floor((parseInt(qtyEl.value, 10) || 0) / 100) * 100;
    const amt = p * qty;
    const fee = amt > 0 ? Store.feeOf(amt, side) : 0;
    $('#ordSum').innerHTML = qty > 0 && p > 0 ? `
      <div>成交金额<span>¥${fmt(amt)}</span></div>
      <div>预估费用<span>¥${fmt(fee)}</span></div>
      <div>${side === 'buy' ? '应付合计' : '实收金额'}<span style="color:var(--gold)">¥${fmt(side === 'buy' ? amt + fee : amt - fee)}</span></div>
    ` : '<div style="color:var(--txt3)">输入价格与数量后显示预估</div>';
  };
  priceEl.oninput = update; qtyEl.oninput = update;
  $$('.stepper button').forEach((b) => {
    b.onclick = () => {
      const f = +b.dataset.f;
      const p = parseFloat(priceEl.value) || 0;
      if (side === 'buy') {
        const max = p > 0 ? Math.floor((s.cash * f) / (p * 1.0006) / 100) * 100 : 0;
        qtyEl.value = max;
      } else {
        qtyEl.value = Math.floor((maxSell * f) / 100) * 100;
      }
      update();
    };
  });
  update();

  $('#ordGo').onclick = () => {
    const p = parseFloat(priceEl.value);
    const qty = parseInt(qtyEl.value, 10);
    if (!p || p <= 0) return toast('请输入有效价格');
    if (q && q.limitUp && p > q.limitUp + 0.001) return toast(`超过涨停价 ${q.limitUp.toFixed(2)}`);
    if (q && q.limitDown && p < q.limitDown - 0.001) return toast(`低于跌停价 ${q.limitDown.toFixed(2)}`);
    if (!qty || qty % 100 !== 0) return toast('数量需为100股的整数倍');
    const r = side === 'buy' ? Store.buy(code, name, p, qty) : Store.sell(code, name, p, qty);
    toast(r.msg, 1600);
    if (r.ok) {
      hideSheet();
      paintTrade();
      if (S.tab === 'detail' && $('#detailGrid')) paintDetailHeader(S.quotes[code] || {});
    }
  };
}

/* ---------- 成交记录 ---------- */
/* ---------- 分享战绩 ---------- */
function openShare() {
  const cl = Store.cloud;
  const prof = Store.getProfile();
  const s = Store.summary(S.quotes);

  if (location.protocol === 'file:') {
    showSheet(`
      <div class="sheet-handle"></div>
      <h4>分享战绩</h4>
      <div class="sub">当前是本地文件模式</div>
      <div style="font-size:13px;line-height:1.9;color:var(--txt2);padding:8px 0 14px">
        生成分享链接需要把 APP 部署到服务器上（运行 <code style="color:var(--gold)">node server.js</code>），
        并且对方能通过网络访问到这个地址：
        <br/><br/>
        · 本地测试：<code style="color:var(--gold)">http://localhost:8823</code>（只有你自己的电脑能打开）
        <br/>
        · 分享给别人：需要公网 IP 或域名，例如 <code style="color:var(--gold)">http://你的域名/s/xxx</code>
      </div>
      <button class="sheet-go" id="shareOk" style="background:linear-gradient(135deg,#f5c451,#d99a24);color:#1a1206">知道了</button>
    `);
    $('#shareOk').onclick = hideSheet;
    return;
  }

  const shareUrl = cl.shareId ? location.origin + '/s/' + cl.shareId : '';

  showSheet(`
    <div class="sheet-handle"></div>
    <h4>分享我的战绩</h4>
    <div class="sub">生成一条只读链接，任何人打开都能看到你的实时持仓与交易记录</div>

    ${shareUrl ? `
      <div style="background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.22);border-radius:12px;padding:13px;margin-bottom:14px">
        <div style="font-size:11px;color:#22c55e;font-weight:600;margin-bottom:7px">✓ 分享已开启</div>
        <div id="shareUrlTxt" style="font-size:12px;color:var(--txt);word-break:break-all;line-height:1.6;font-family:ui-monospace,monospace">${esc(shareUrl)}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="sheet-go" id="btnCopy" style="margin-top:0;background:linear-gradient(135deg,#f5c451,#d99a24);color:#1a1206;font-size:14px">复制链接</button>
        <button class="sheet-go" id="btnOpen" style="margin-top:0;background:rgba(255,255,255,.07);color:var(--txt);font-size:14px;border:1px solid var(--line2)">预览</button>
      </div>
      <button id="btnRevoke" style="width:100%;margin-top:10px;height:40px;border-radius:10px;font-size:12.5px;color:#ff6b6b;border:1px solid rgba(255,77,79,.28);background:rgba(255,77,79,.06)">停用这个分享链接</button>
    ` : `
      <div style="font-size:12.5px;color:var(--txt2);line-height:1.9;margin-bottom:14px">
        链接内容包含：<br/>
        · 总资产、累计收益率、每日收益曲线<br/>
        · 当前持仓与浮动盈亏<br/>
        · 最近 50 笔交易记录
        <br/><br/>
        <span style="color:var(--txt3);font-size:11.5px">对方只能查看，无法操作。你的资金账户信息不会暴露。</span>
      </div>
    `}

    <div class="field" style="margin-top:6px"><label>显示昵称</label>
      <input id="shareName" value="${esc(prof.name)}" maxlength="20" style="width:130px;font-size:14px" />
    </div>
    <div class="field"><label>策略标签（可选）</label>
      <input id="shareStrat" value="${esc(prof.strategy)}" maxlength="24" placeholder="如 低吸不追高" style="width:150px;font-size:13px" />
    </div>

    ${shareUrl ? `
      <button class="sheet-go" id="btnGen" style="background:rgba(255,255,255,.08);color:var(--txt);font-size:14px;margin-top:12px">更新资料并同步</button>
    ` : `
      <button class="sheet-go" id="btnGen" style="background:linear-gradient(135deg,#f5c451,#d99a24);color:#1a1206">生成分享链接</button>
    `}

    <div style="font-size:10.5px;color:var(--txt3);margin-top:12px;line-height:1.8;text-align:center">
      ${cl.err ? `<span style="color:#ff6b6b">${esc(cl.err)}</span> · ` : ''}
      ${cl.lastSync ? '上次同步 ' + new Date(cl.lastSync).toLocaleTimeString('zh-CN') : '尚未同步'}
    </div>
  `);

  const gen = $('#btnGen');
  gen.onclick = async () => {
    const name = $('#shareName').value.trim() || '匿名投资者';
    const strat = $('#shareStrat').value.trim();
    Store.setProfile(name, strat);
    gen.disabled = true; gen.textContent = '正在上传战绩…';
    try {
      const r = await Store.createShare();
      hideSheet();
      setTimeout(() => openShare(), 320);
      toast('分享链接已生成', 1200);
    } catch (e) {
      gen.disabled = false; gen.textContent = '重试';
      toast('生成失败：' + (e.message || '请检查服务器'));
    }
  };

  if (shareUrl) {
    $('#btnCopy').onclick = async () => {
      const txt = shareUrl;
      try {
        if (navigator.share) {
          await navigator.share({ title: '我的模拟盘战绩', text: `${prof.name} 的模拟盘战绩，来看看`, url: txt });
        } else {
          await navigator.clipboard.writeText(txt);
          toast('链接已复制');
        }
      } catch (e) {
        try { await navigator.clipboard.writeText(txt); toast('链接已复制'); }
        catch (e2) { toast('复制失败，请长按链接手动复制'); }
      }
    };
    $('#btnOpen').onclick = () => window.open(shareUrl, '_blank');
    $('#btnRevoke').onclick = async () => {
      if (!confirm('停用后，这个链接将无法打开。确定吗？')) return;
      await Store.revokeShare();
      hideSheet();
      setTimeout(() => openShare(), 320);
      toast('分享已停用');
    };
  }
}

/* ---------- 编辑资料 ---------- */
function openProfile() {
  const prof = Store.getProfile();
  const s = Store.summary(S.quotes);
  showSheet(`
    <div class="sheet-handle"></div>
    <h4>个人资料</h4>
    <div class="sub">会显示在你的分享页上</div>
    <div class="field"><label>昵称</label>
      <input id="pName" value="${esc(prof.name)}" maxlength="20" placeholder="匿名投资者" />
    </div>
    <div class="field"><label>策略标签</label>
      <input id="pStrat" value="${esc(prof.strategy)}" maxlength="24" placeholder="如 低吸不追高" />
    </div>
    <div class="field"><label>累计收益率</label>
      <span class="num ${cls(s.totalPnlPct)}" style="font-size:16px;font-weight:600">${sgn(s.totalPnlPct)}%</span>
    </div>
    <button class="sheet-go" id="pSave" style="background:linear-gradient(135deg,#f5c451,#d99a24);color:#1a1206">保存</button>
  `);
  $('#pSave').onclick = () => {
    Store.setProfile($('#pName').value.trim() || '匿名投资者', $('#pStrat').value.trim());
    hideSheet();
    renderMe();
    toast('资料已保存');
  };
}

function openTrades() {
  const s = Store.get();
  const rows = s.trades.slice(0, 60);
  const body = `
    <div class="sheet-handle"></div>
    <h4>成交记录</h4>
    <div class="sub">共 ${s.trades.length} 笔 · 模拟交易</div>
    ${rows.length ? rows.map((t) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:1px solid var(--line)">
        <div>
          <div style="font-size:13.5px;font-weight:600">
            <span style="color:${t.side === 'buy' ? 'var(--up)' : 'var(--down)'};margin-right:6px">${t.side === 'buy' ? '买' : '卖'}</span>${esc(t.name)}
          </div>
          <div style="font-size:10.5px;color:var(--txt3);margin-top:3px">${t.time} · ${t.code.slice(2)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:13.5px;font-weight:600">${t.qty} 股 @ ${t.price.toFixed(2)}</div>
          <div style="font-size:10.5px;color:var(--txt3);margin-top:3px">¥${fmt(t.amount)}${t.pnl != null ? ` · <span class="${cls(t.pnl)}">${t.pnl >= 0 ? '+' : ''}${fmt(t.pnl)}</span>` : ''}</div>
        </div>
      </div>`).join('') : '<div class="empty">还没有成交记录</div>'}
  `;
  showSheet(body);
}

/* ================= 资讯页 ================= */
let newsTab = 'flash';

function renderNews() {
  const v = $('#v-news');
  v.innerHTML = `
    <div class="feed-head">
      <div class="feed-tabs">
        <button class="on" data-nt="flash">7×24快讯</button>
        <button data-nt="news">要闻</button>
        <button data-nt="feed">讨论</button>
      </div>
    </div>
    <div id="newsBody"></div>
    <button class="fab" id="fabPost" style="display:none">＋</button>
  `;
  $$('.feed-tabs button').forEach((b) => {
    b.onclick = () => {
      $$('.feed-tabs button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      newsTab = b.dataset.nt;
      renderNewsBody();
    };
  });
  renderNewsBody();
}

async function renderNewsBody() {
  const box = $('#newsBody');
  if (!box) return;
  $('#fabPost').style.display = newsTab === 'feed' ? 'grid' : 'none';
  $('#fabPost').onclick = openPost;
  if (newsTab === 'feed') { renderFeed(); return; }

  box.innerHTML = Array(5).fill(`<div class="news-item"><div class="skel" style="height:14px;width:88%;margin-bottom:8px"></div><div class="skel" style="height:11px;width:100%;margin-bottom:5px"></div><div class="skel" style="height:11px;width:70%"></div></div>`).join('');
  try {
    if (!S.newsCache) S.newsCache = await API.news();
    const list = S.newsCache;
    const rows = newsTab === 'flash' ? list : list.filter((n) => n.body.length > 60);
    box.innerHTML = rows.map((n) => newsTab === 'flash'
      ? `<div class="news-flash"><div class="time num">${esc(n.time)}</div>
          <div style="font-size:13.5px;line-height:1.7">${esc(n.body || n.title)}</div>
          ${n.url ? `<div style="font-size:10.5px;color:var(--accent);margin-top:6px" data-url="${esc(n.url)}">查看原文 ›</div>` : ''}
        </div>`
      : `<div class="news-item"><div class="t">${esc(n.title)}</div><div class="b">${esc(n.body)}</div>
          <div class="m"><span>${esc(n.time)}</span><span>东方财富快讯</span></div></div>`).join('') ||
      '<div class="empty">暂无数据</div>';

    $$('#newsBody [data-url]').forEach((el) => {
      el.onclick = () => window.open(el.dataset.url, '_blank');
    });
  } catch (e) {
    box.innerHTML = `<div class="empty"><b>资讯加载失败</b>接口可能被限制，稍后重试</div>`;
  }
}

/* ---------- 社区（本地） ---------- */
const FEED_KEY = 'stockapp.feed.v1';
function seedFeed() {
  const now = Date.now();
  return [
    { id: 'a1', who: '趋势猎手', color: '#f5c451', when: now - 3.2e6, likes: 42, comments: 8, text: '指数缩量整理，权重不动题材先动。今天题材的持续性要看午后能否放量，缩量反抽不追高。', tag: '大盘观点' },
    { id: 'a2', who: '稳健老张', color: '#54b0ff', when: now - 5.6e6, likes: 27, comments: 5, text: '军工这波是事件驱动，短线情绪票为主。真要看基本面，我更关注订单能见度高的主机厂，别在情绪高点接盘。', tag: '板块拆解' },
    { id: 'a3', who: '半仓小王子', color: '#c77dff', when: now - 8.1e6, likes: 66, comments: 14, text: '记录一下：今天把仓位从七成降到五成，浮盈落袋。纪律比预测重要，看不懂就减仓，等趋势明确了再上。', tag: '交易记录' },
    { id: 'a4', who: '量化猫', color: '#ff9f43', when: now - 1.1e7, likes: 19, comments: 3, text: '复盘过去20个交易日：涨停家数连续3天回落，赚钱效应在收缩。这种环境下做首板的胜率低于做低吸。', tag: '数据复盘' },
  ];
}
function getFeed() {
  try {
    const v = JSON.parse(localStorage.getItem(FEED_KEY) || 'null');
    return Array.isArray(v) && v.length ? v : seedFeed();
  } catch (e) { return seedFeed(); }
}
function saveFeed(v) { localStorage.setItem(FEED_KEY, JSON.stringify(v)); }

function timeAgo(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return '刚刚';
  if (d < 3600) return Math.floor(d / 60) + '分钟前';
  if (d < 86400) return Math.floor(d / 3600) + '小时前';
  return Math.floor(d / 86400) + '天前';
}

function renderFeed() {
  const box = $('#newsBody');
  const feed = getFeed();
  const myLikes = JSON.parse(localStorage.getItem('stockapp.likes') || '{}');
  const top = S.rankCache['priceRatiodown'];
  box.innerHTML = `
    <div class="post" style="background:rgba(245,196,81,.04)">
      <div class="post-head"><div class="avatar" style="background:#f5c451">棱</div>
        <div><div class="who">棱镜 AI</div><div class="when">今日市场速览</div></div></div>
      <div class="txt">${top && top.length ? `今日涨幅居前：<span class="hl">${top.slice(0, 3).map((r) => r.name).join('、')}</span>。跌幅榜以高位股为主，注意情绪退潮节奏。` : '正在获取今日榜单…'}</div>
      <div class="tag">自动生成 · 仅供参考</div>
    </div>
    ${feed.map((p) => `
      <div class="post" data-id="${p.id}">
        <div class="post-head"><div class="avatar" style="background:${p.color}">${esc(p.who[0])}</div>
          <div><div class="who">${esc(p.who)}</div></div><div class="when">${timeAgo(p.when)}</div></div>
        <div class="txt">${esc(p.text)}</div>
        ${p.tag ? `<span class="tag">#${esc(p.tag)}</span>` : ''}
        <div class="post-foot">
          <span data-act="like" class="${myLikes[p.id] ? 'liked' : ''}">♡ ${p.likes + (myLikes[p.id] ? 1 : 0)}</span>
          <span data-act="cmt">💬 ${p.comments}</span>
          <span data-act="share">↗ 分享</span>
        </div>
      </div>`).join('')}
  `;
  $$('#newsBody .post').forEach((el) => {
    el.addEventListener('click', (e) => {
      const act = e.target.dataset.act;
      const id = el.dataset.id;
      if (!act || !id) return;
      if (act === 'like') {
        myLikes[id] = !myLikes[id];
        localStorage.setItem('stockapp.likes', JSON.stringify(myLikes));
        renderFeed();
      } else if (act === 'cmt') toast('评论功能演示中');
      else toast('链接已复制');
    });
  });
}

function openPost() {
  const body = `
    <div class="sheet-handle"></div>
    <h4>发布观点</h4>
    <div class="sub">与其他投资者交流你的看法</div>
    <textarea id="postTxt" rows="5" placeholder="说说你的判断、交易记录或复盘…"
      style="width:100%;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:10px;padding:12px;color:var(--txt);font-size:14px;outline:none;resize:none;line-height:1.6;font-family:inherit"></textarea>
    <div class="stepper" style="margin-top:10px">
      ${['大盘观点', '个股分析', '交易记录', '复盘总结'].map((t, i) => `<button class="ptag ${i === 0 ? 'active' : ''}" data-t="${t}" style="${i === 0 ? 'background:rgba(245,196,81,.7);color:#1a1206' : ''}">${t}</button>`).join('')}
    </div>
    <button class="sheet-go" id="postGo" style="background:linear-gradient(135deg,#f5c451,#d99a24);color:#1a1206">发布</button>
  `;
  showSheet(body);
  let tag = '大盘观点';
  $$('.ptag').forEach((b) => {
    b.onclick = () => {
      $$('.ptag').forEach((x) => {
        x.classList.remove('active');
        x.style.background = 'rgba(255,255,255,.055)'; x.style.color = 'var(--txt2)';
      });
      b.style.background = 'rgba(245,196,81,.7)'; b.style.color = '#1a1206';
      tag = b.dataset.t;
    };
  });
  $('#postGo').onclick = () => {
    const txt = $('#postTxt').value.trim();
    if (txt.length < 5) return toast('至少写5个字吧');
    const feed = getFeed();
    feed.unshift({ id: 'u' + Date.now(), who: '我', color: '#4d8dff', when: Date.now(), likes: 0, comments: 0, text: txt, tag, mine: true });
    saveFeed(feed);
    hideSheet();
    newsTab = 'feed';
    $$('.feed-tabs button').forEach((x) => x.classList.toggle('on', x.dataset.nt === 'feed'));
    renderNewsBody();
    toast('发布成功');
  };
}

/* ================= 我的 ================= */
function renderMe() {
  const s = Store.summary(S.quotes);
  const st = Store.get();
  const winRate = (() => {
    const sells = st.trades.filter((t) => t.side === 'sell');
    if (!sells.length) return null;
    return (sells.filter((t) => t.pnl > 0).length / sells.length) * 100;
  })();
  const risk = Math.min(100, (s.marketValue / Math.max(1, s.total)) * 100);
  const prof = Store.getProfile();
  const cl = Store.cloud;

  $('#v-me').innerHTML = `
    <div class="profile-card">
      <div class="me-head">
        <div class="me-avatar">${esc(prof.name[0] || 'P')}</div>
        <div style="flex:1;min-width:0">
          <div class="me-name">${esc(prof.name)} <span class="tier">模拟账户</span></div>
          <div class="me-id">${prof.strategy ? esc(prof.strategy) : 'ID · ' + String(st.created).slice(-8)}</div>
        </div>
        <button class="menu-item" id="mProfile" style="width:auto;padding:6px 10px;border:1px solid var(--line2);border-radius:8px;font-size:11.5px;color:var(--txt2);background:none">编辑</button>
      </div>
      <div class="me-stats">
        <div><b class="num ${cls(s.totalPnl)}">${s.totalPnl >= 0 ? '+' : ''}${fmt(s.totalPnl)}</b><i>累计盈亏</i></div>
        <div><b class="num ${cls(s.totalPnl)}">${sgn(s.totalPnlPct)}%</b><i>收益率</i></div>
        <div><b class="num">${winRate == null ? '--' : winRate.toFixed(0) + '%'}</b><i>卖出胜率</i></div>
      </div>
      <div style="font-size:11px;color:var(--txt3);display:flex;justify-content:space-between">
        <span>仓位</span><span>${risk.toFixed(1)}%</span>
      </div>
      <div class="risk-bar"><i style="width:${Math.max(3, risk)}%"></i></div>
    </div>

    <div class="menu-list">
      <button class="menu-item" id="mShare">
        <svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>
        分享我的战绩
        <span class="arr" id="shareState">${cl.shareId ? '<span style="color:#22c55e">已开启</span> ›' : '›'}</span>
      </button>
      <button class="menu-item" id="mSync">
        <svg viewBox="0 0 24 24"><path d="M4 4v6h6"/><path d="M20 20v-6h-6"/><path d="M4 10a8 8 0 0114-4M20 14a8 8 0 01-14 4"/></svg>
        云端同步
        <span class="arr" id="syncState">${cl.ok ? '<span style="color:#22c55e">已同步</span>' : cl.err ? '<span style="color:#ff4d4f">未连接</span>' : '未同步'} ›</span>
      </button>
    </div>

    <div class="menu-list">
      <button class="menu-item" id="mTrades">
        <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10"/></svg>成交记录
        <span class="arr">${st.trades.length} 笔 ›</span>
      </button>
      <button class="menu-item" id="mWatch">
        <svg viewBox="0 0 24 24"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/></svg>我的自选
        <span class="arr">${st.watch.length} 只 ›</span>
      </button>
      <button class="menu-item" id="mReset">
        <svg viewBox="0 0 24 24"><path d="M4 4v6h6"/><path d="M20 20v-6h-6"/><path d="M4 10a8 8 0 0114-4M20 14a8 8 0 01-14 4"/></svg>重置模拟账户
        <span class="arr">›</span>
      </button>
      <button class="menu-item" id="mClear">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>清空本地数据
        <span class="arr">›</span>
      </button>
    </div>

    <div class="menu-list">
      <button class="menu-item" id="mAbout">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>关于棱镜
        <span class="arr">v1.1 ›</span>
      </button>
    </div>

    <div class="px" style="margin-top:18px;font-size:10.5px;color:var(--txt3);line-height:1.8">
      行情数据来自腾讯财经公开接口，资讯来自东方财富。<br/>
      战绩分享后，任何人打开链接只能查看，无法操作你的账户。<br/>
      所有交易均为模拟，不构成任何投资建议。
    </div>
    <div style="height:10px"></div>
  `;
  $('#mProfile').onclick = openProfile;
  $('#mShare').onclick = openShare;
  $('#mSync').onclick = async () => {
    toast('正在同步…', 900);
    await Store.syncNow(0);
    setTimeout(() => { renderMe(); toast(Store.cloud.ok ? '已同步到云端' : '同步失败：' + (Store.cloud.err || '未知错误')); }, 900);
  };
  $('#mTrades').onclick = openTrades;
  $('#mWatch').onclick = () => switchTab('watch');
  $('#mReset').onclick = () => {
    if (!confirm('重置模拟账户？将清空持仓和成交记录，资金恢复 100 万')) return;
    Store.reset(); renderMe(); renderTrade(); toast('账户已重置');
  };
  $('#mClear').onclick = () => {
    if (!confirm('清空本地数据？自选、持仓、帖子都会被删除，且无法恢复')) return;
    localStorage.clear();
    location.reload();
  };
  $('#mAbout').onclick = () => { showSheet(`
    <div class="sheet-handle"></div>
    <h4>棱镜 PRISM</h4>
    <div class="sub">A股行情 · 模拟交易 · 投资社区</div>
    <div style="font-size:13px;line-height:1.9;color:var(--txt2)">
      <p>这是一款用纯前端实现的原型产品：</p>
      <p style="margin:8px 0">
        · <b>行情</b>：腾讯财经实时报价，1–3 秒刷新<br/>
        · <b>K线</b>：日/周/月前复权，MA + MACD + 成交量，支持拖动缩放<br/>
        · <b>交易</b>：模拟撮合，佣金/印花税/T+1 规则完整<br/>
        · <b>资讯</b>：7×24 财经快讯实时抓取<br/>
        · <b>数据</b>：账户与帖子存于本地，不上传
      </p>
      <p style="color:var(--txt3);font-size:11.5px">仅供学习与产品演示使用，不构成投资建议。</p>
    </div>
    <button class="sheet-go" id="aboutOk" style="background:linear-gradient(135deg,#f5c451,#d99a24);color:#1a1206">知道了</button>
  `); $('#aboutOk').onclick = hideSheet; };
}

/* ================= 搜索 ================= */
function openSearch() {
  const ov = $('#searchOverlay');
  ov.classList.add('on');
  ov.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:14px 16px 6px">
      <div class="search-bar" style="margin:0;flex:1">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <input id="sInput" placeholder="代码 / 名称 / 拼音首字母" autocomplete="off" />
      </div>
      <button id="sClose" style="font-size:14px;color:var(--txt2)">取消</button>
    </div>
    <div class="sr-list" id="srList">
      <div style="padding:16px">
        <div style="font-size:11px;color:var(--txt3);margin-bottom:10px">热门</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${['sh600519|贵州茅台', 'sz300750|宁德时代', 'sz000001|平安银行', 'sh601318|中国平安', 'sz002594|比亚迪', 'sh601899|紫金矿业'].map((s) => {
            const [c, n] = s.split('|');
            return `<button class="chip" data-code="${c}" data-name="${n}">${n}</button>`;
          }).join('')}
        </div>
      </div>
    </div>`;
  $('#sClose').onclick = () => { ov.classList.remove('on'); ov.innerHTML = ''; };
  $$('#srList .chip').forEach((b) => {
    b.onclick = () => {
      const c = b.dataset.code;
      if (!Store.inWatch(c)) Store.toggleWatch(c);
      ov.classList.remove('on'); ov.innerHTML = '';
      S.watchQuotes = Store.get().watch.map((x) => S.quotes[x]).filter(Boolean);
      refreshAll().then(() => { if (S.tab === 'watch') renderWatch(); });
      openDetail(c, b.dataset.name);
    };
  });

  const inp = $('#sInput');
  inp.focus();
  let timer;
  inp.oninput = () => {
    clearTimeout(timer);
    const q = inp.value.trim();
    if (!q) return;
    timer = setTimeout(async () => {
      const list = $('#srList');
      list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--txt3);font-size:12px">搜索中…</div>`;
      try {
        const rows = await API.search(q);
        if (!rows.length) { list.innerHTML = `<div class="empty">没有找到 “${esc(q)}”</div>`; return; }
        list.innerHTML = rows.slice(0, 25).map((r) => `
          <div class="rank-row" style="grid-template-columns:1.6fr 1fr auto" data-code="${r.code}" data-name="${esc(r.name)}">
            <div class="nm"><b>${esc(r.name)}</b><span>${r.code.slice(2)}</span></div>
            <div style="font-size:10.5px;color:var(--txt3);text-align:right">${marketTag(r.code)}</div>
            <button style="font-size:11px;color:var(--gold);padding:4px 8px">${Store.inWatch(r.code) ? '已加' : '＋自选'}</button>
          </div>`).join('');
        $$('#srList .rank-row').forEach((el) => {
          el.onclick = (e) => {
            const c = el.dataset.code;
            if (e.target.tagName === 'BUTTON') {
              e.stopPropagation();
              const on = Store.toggleWatch(c);
              e.target.textContent = on ? '已加' : '＋自选';
              S.watchQuotes = Store.get().watch.map((x) => S.quotes[x]).filter(Boolean);
              refreshAll(true).then(() => { if (S.tab === 'watch') renderWatch(); });
              return;
            }
            ov.classList.remove('on'); ov.innerHTML = '';
            openDetail(c, el.dataset.name);
          };
        });
      } catch (e) {
        list.innerHTML = `<div class="empty">搜索失败，请检查网络</div>`;
      }
    }, 220);
  };
}

/* ================= 弹层控制 ================= */
function showSheet(html) {
  const sh = $('#sheet');
  sh.innerHTML = html;
  $('#sheetMask').classList.add('on');
  sh.classList.add('on');
}
function hideSheet() {
  $('#sheet').classList.remove('on');
  $('#sheetMask').classList.remove('on');
  setTimeout(() => { if (!$('#sheet').classList.contains('on')) $('#sheet').innerHTML = ''; }, 300);
}
$('#sheetMask').onclick = hideSheet;

/* ================= Tab 切换 ================= */
function switchTab(tab, instant) {
  S.tab = tab;
  $$('.view').forEach((v) => v.classList.remove('active'));
  $$('.tab').forEach((t) => t.classList.remove('active'));
  const view = $('#v-' + tab);
  if (view) view.classList.add('active');
  const btn = $(`.tab[data-tab="${tab}"]`);
  if (btn) btn.classList.add('active');
  $('#tabbar').style.display = tab === 'detail' ? 'none' : 'grid';
  $('#topbar').style.display = tab === 'detail' ? 'none' : 'flex';
  const dv = $('#v-detail');
  if (dv) dv.style.paddingBottom = tab === 'detail' ? '0' : '';
  if (view) view.scrollTop = tab === 'detail' ? 0 : view.scrollTop;

  if (tab === 'news' && !$('#newsBody')) renderNews();
  if (tab === 'me') renderMe();
  if (tab === 'trade') paintTrade();
}

$$('.tab').forEach((b) => {
  b.onclick = () => switchTab(b.dataset.tab);
});

/* ================= 定时刷新 ================= */
let timer;
function startTimer() {
  clearInterval(timer);
  const ms = marketStatus();
  timer = setInterval(() => {
    const st = marketStatus();
    $('#mktTxt').dataset.st = st.txt;
    // 交易时段 3 秒刷新，非交易时段 60 秒
    if (st.open) {
      refreshAll(true);
    } else {
      clearInterval(timer);
      timer = setInterval(() => {
        refreshAll(true);
        if (marketStatus().open) startTimer();
      }, 60000);
    }
  }, ms.open ? 3000 : 60000);
}

$('#btnRefresh').onclick = async () => {
  $('#mktTxt').textContent = '刷新中…';
  S.rankCache = {}; S.newsCache = null; S.sectorCache = null; API.mem.clear();
  await refreshAll();
  if (S.tab === 'market') { loadRank(); loadSectors(); }
  if (S.tab === 'detail' && S.detail) loadChart(S.detail.period);
  toast('已刷新');
  const ms = marketStatus();
  $('#mktTxt').textContent = ms.txt;
  updateHeader();
};

/* 返回手势：详情页左滑返回 */
$('#views').addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  window.__ts = { x: t.clientX, y: t.clientY, t: Date.now() };
}, { passive: true });
$('#views').addEventListener('touchend', (e) => {
  const st = window.__ts;
  if (!st) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - st.x, dy = t.clientY - st.y;
  if (S.tab === 'detail' && dx > 80 && Math.abs(dy) < 60) switchTab('watch');
});

/* 键盘：Esc 关闭 */
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideSheet();
    $('#searchOverlay').classList.remove('on');
    if (S.tab === 'detail') switchTab('watch');
  }
});

/* 启动 */
bootstrap().then(async () => {
  startTimer();
  // 云端：恢复账户状态，首次同步
  await Store.loadShareState();
  Store.syncNow(800);
  // 行情刷新后，每 60 秒推送一次最新权益快照
  setInterval(() => { if (Store.cloud.shareId) Store.syncNow(0); }, 60000);
  Store.onCloud((c) => {
    if (S.tab === 'me') {
      const ss = $('#syncState'), sh = $('#shareState');
      if (ss) ss.innerHTML = (c.ok ? '<span style="color:#22c55e">已同步</span>' : c.err ? '<span style="color:#ff4d4f">未连接</span>' : '未同步') + ' ›';
      if (sh) sh.innerHTML = c.shareId ? '<span style="color:#22c55e">已开启</span> ›' : '›';
    }
  });
});
