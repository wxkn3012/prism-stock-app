/* ============================================================
 * store.js — 账户、持仓、委托、自选（localStorage 持久化）
 * 模拟交易规则：A股 T+1，按手(100股)交易，佣金万2.5最低5元，卖出印花税0.05%
 * ============================================================ */
const Store = (() => {
  const KEY = 'stockapp.account.v1';
  const FEE = { commissionRate: 0.00025, minCommission: 5, stampRate: 0.0005, transferRate: 0.00001 };

  const DEFAULT_WATCH = [
    'sh600519', 'sz000001', 'sh601318', 'sz300750', 'sh600036',
    'sz000858', 'sh601899', 'sz002594', 'sh688981', 'sh600030',
  ];

  let state = null;
  const listeners = new Set();

  function blank() {
    return {
      cash: 1000000,
      positions: {},   // code -> {code,name,qty,avail,cost,lastBuy}
      orders: [],      // 委托记录
      trades: [],      // 成交记录
      watch: DEFAULT_WATCH.slice(),
      created: Date.now(),
      frozen: 0,
      initial: 1000000,
      history: [],
    };
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      state = s && s.cash !== undefined ? s : blank();
    } catch (e) { state = blank(); }
    if (!Array.isArray(state.watch)) state.watch = DEFAULT_WATCH.slice();
    return state;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    listeners.forEach((fn) => fn(state));
  }
  const get = () => state || load();
  const sub = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const reset = () => { state = blank(); save(); syncNow(300); };
  const disconnect = () => {
    localStorage.removeItem(KEY_LS);
    accountKey = null;
    CLOUD.shareId = null; CLOUD.available = false; CLOUD.ok = false;
    emitCloud();
  };

  /* ---------- 费用 ---------- */
  function feeOf(amount, side) {
    const commission = Math.max(FEE.minCommission, amount * FEE.commissionRate);
    const transfer = amount * FEE.transferRate;
    const stamp = side === 'sell' ? amount * FEE.stampRate : 0;
    return +(commission + transfer + stamp).toFixed(2);
  }

  /* ---------- 自选 ---------- */
  function inWatch(code) { return get().watch.includes(code); }
  function toggleWatch(code) {
    const s = get();
    const i = s.watch.indexOf(code);
    if (i >= 0) s.watch.splice(i, 1); else s.watch.unshift(code);
    save();
    return s.watch.includes(code);
  }

  /* ---------- 云端同步（战绩分享） ---------- */
  const KEY_LS = 'stockapp.accountKey';
  let accountKey = null;
  try { accountKey = localStorage.getItem(KEY_LS); } catch (e) {}
  let profile = { name: '匿名投资者', strategy: '' };
  try { profile = JSON.parse(localStorage.getItem('stockapp.profile') || 'null') || profile; } catch (e) {}

  const CLOUD = { available: false, ok: false, lastSync: 0, syncing: false, err: '', shareId: null };
  const cloudSubs = new Set();
  const onCloud = (fn) => { cloudSubs.add(fn); return () => cloudSubs.delete(fn); };
  const emitCloud = () => cloudSubs.forEach((f) => { try { f(CLOUD); } catch (e) {} });

  function cloudCtx() {
    return location.protocol === 'http:' || location.protocol === 'https:';
  }

  async function ensureAccount() {
    if (!cloudCtx()) { CLOUD.err = '当前为本地文件模式，无法云端同步'; return null; }
    if (accountKey) return accountKey;
    try {
      const r = await fetch('/api/account', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: profile.name, strategy: profile.strategy }),
      });
      const j = await r.json();
      if (!j.ok || !j.key) throw new Error('创建账户失败');
      accountKey = j.key;
      localStorage.setItem(KEY_LS, j.key);
      CLOUD.err = '';
      return accountKey;
    } catch (e) {
      CLOUD.err = '连接服务器失败';
      return null;
    }
  }

  function buildSnapshot() {
    // 用缓存的行情估算市值（同步时不额外请求，避免抖动）
    const qs = (typeof S !== 'undefined' && S.quotes) ? S.quotes : {};
    const sum = summary(qs);
    const sells = get().trades.filter((t) => t.side === 'sell');
    const winRate = sells.length ? (sells.filter((t) => t.pnl > 0).length / sells.length) * 100 : null;
    const hist = get().history || [];
    // 记录当日权益点，形成曲线
    const dayKey = today();
    const last = hist[hist.length - 1];
    if (last && String(last.t).slice(0, 8) === String(dayKey) && Date.now() - last.t < 86400000) {
      last.v = +sum.total.toFixed(2);
    } else {
      hist.push({ t: Date.now(), v: +sum.total.toFixed(2) });
    }
    if (hist.length > 120) hist.splice(0, hist.length - 120);
    const s = get();
    if (s.history !== hist) s.history = hist;
    localStorage.setItem(KEY, JSON.stringify(s));

    return {
      name: profile.name,
      strategy: profile.strategy,
      initial: s.initial,
      cash: +sum.cash.toFixed(2),
      marketValue: +sum.marketValue.toFixed(2),
      total: +sum.total.toFixed(2),
      totalPnl: +sum.totalPnl.toFixed(2),
      totalPnlPct: +sum.totalPnlPct.toFixed(2),
      dayPnl: +sum.dayPnl.toFixed(2),
      positions: sum.list.map((p) => ({
        code: p.code, name: p.name, qty: p.qty, cost: +p.cost.toFixed(3),
        price: +p.price.toFixed(2), value: +p.value.toFixed(2),
        pnl: +p.pnl.toFixed(2), pnlPct: +p.pnlPct.toFixed(2),
      })),
      trades: get().trades.slice(0, 50),
      curve: hist,
      stats: {
        trades: get().trades.length,
        winRate,
        positionRate: sum.total > 0 ? (sum.marketValue / sum.total) * 100 : 0,
      },
    };
  }

  let syncTimer = null, syncAgain = false;
  function syncNow(delay = 1200) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(doSync, delay);
  }
  async function doSync() {
    if (CLOUD.syncing) { syncAgain = true; return; }
    CLOUD.syncing = true; emitCloud();
    try {
      const key = await ensureAccount();
      if (!key) { CLOUD.ok = false; emitCloud(); return; }
      const body = buildSnapshot();
      const r = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Account-Key': key },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.err || 'sync failed');
      CLOUD.available = true; CLOUD.ok = true; CLOUD.lastSync = Date.now(); CLOUD.err = '';
    } catch (e) {
      CLOUD.ok = false; CLOUD.err = e.message || '同步失败';
    } finally {
      CLOUD.syncing = false; emitCloud();
      if (syncAgain) { syncAgain = false; syncNow(300); }
    }
  }

  async function createShare() {
    const key = await ensureAccount();
    if (!key) throw new Error(CLOUD.err || '未连接服务器');
    await doSync();
    const r = await fetch('/api/share', { method: 'POST', headers: { 'X-Account-Key': key } });
    const j = await r.json();
    if (!j.ok) throw new Error('生成链接失败');
    CLOUD.shareId = j.shareId;
    CLOUD.available = true;
    emitCloud();
    return {
      shareId: j.shareId,
      url: location.origin + '/s/' + j.shareId,
      short: location.origin.replace(/^https?:\/\//, '') + '/s/' + j.shareId,
    };
  }

  async function revokeShare() {
    if (!accountKey) return;
    await fetch('/api/share', { method: 'DELETE', headers: { 'X-Account-Key': accountKey } });
    CLOUD.shareId = null;
    emitCloud();
  }

  async function loadShareState() {
    if (!accountKey || !cloudCtx()) return;
    try {
      const r = await fetch('/api/me', { headers: { 'X-Account-Key': accountKey } });
      const j = await r.json();
      if (j.ok) {
        CLOUD.available = true;
        CLOUD.shareId = j.shareId || null;
        if (j.name) profile.name = j.name;
        if (j.strategy !== undefined) profile.strategy = j.strategy;
        emitCloud();
      }
    } catch (e) {}
  }

  function setProfile(name, strategy) {
    profile.name = String(name || '匿名投资者').slice(0, 20);
    profile.strategy = String(strategy || '').slice(0, 60);
    localStorage.setItem('stockapp.profile', JSON.stringify(profile));
    syncNow(100);
  }

  const getProfile = () => ({ ...profile });

  /* ---------- 下单 ---------- */
  function buy(code, name, price, qty) {
    const s = get();
    qty = Math.floor(qty / 100) * 100;
    if (qty <= 0) return { ok: false, msg: '数量需为100股的整数倍' };
    const amount = +(price * qty).toFixed(2);
    const fee = feeOf(amount, 'buy');
    if (amount + fee > s.cash) return { ok: false, msg: `可用资金不足，需 ¥${fmt(amount + fee)}` };

    const pos = s.positions[code] || { code, name, qty: 0, avail: 0, cost: 0 };
    pos.name = name || pos.name;
    pos.cost = +(((pos.cost * pos.qty) + amount + fee) / (pos.qty + qty)).toFixed(3);
    pos.qty += qty;
    pos.lastBuy = today();
    s.positions[code] = pos;
    s.cash = +(s.cash - amount - fee).toFixed(2);

    const t = { id: uid(), time: now(), code, name: pos.name, side: 'buy', price, qty, amount, fee, status: '已成' };
    s.trades.unshift(t); s.orders.unshift(t);
    save();
    syncNow(400);
    return { ok: true, msg: `买入 ${pos.name} ${qty}股 成交`, trade: t };
  }

  function sell(code, name, price, qty) {
    const s = get();
    const pos = s.positions[code];
    if (!pos || pos.qty <= 0) return { ok: false, msg: '没有可卖持仓' };
    qty = Math.floor(qty / 100) * 100;
    if (qty <= 0) return { ok: false, msg: '数量需为100股的整数倍' };
    if (qty > pos.avail) return { ok: false, msg: `可卖 ${pos.avail} 股（当日买入 T+1）` };

    const amount = +(price * qty).toFixed(2);
    const fee = feeOf(amount, 'sell');
    const pnl = +((price - pos.cost) * qty - fee).toFixed(2);

    pos.qty -= qty; pos.avail -= qty;
    if (pos.qty === 0) delete s.positions[code]; else s.positions[code] = pos;
    s.cash = +(s.cash + amount - fee).toFixed(2);

    const t = { id: uid(), time: now(), code, name: pos.name || name, side: 'sell', price, qty, amount, fee, pnl, status: '已成' };
    s.trades.unshift(t); s.orders.unshift(t);
    save();
    syncNow(400);
    return { ok: true, msg: `卖出 ${pos.name || name} ${qty}股 成交`, trade: t };
  }

  /* 每日 T+1 解锁（跨日把 avail 拉到 qty） */
  function settleT1() {
    const s = get();
    let changed = false;
    Object.values(s.positions).forEach((p) => {
      if (p.avail < p.qty && p.lastBuy !== today()) { p.avail = p.qty; changed = true; }
    });
    if (changed) { save(); return true; }
    return false;
  }

  /* ---------- 统计 ---------- */
  function summary(quoteMap) {
    const s = get();
    let mv = 0, cost = 0, dayPnl = 0;
    const list = Object.values(s.positions).map((p) => {
      const q = quoteMap && quoteMap[p.code];
      const price = q ? q.price : p.cost;
      const value = price * p.qty;
      const pnl = (price - p.cost) * p.qty;
      const pnlPct = p.cost > 0 ? (pnl / (p.cost * p.qty)) * 100 : 0;
      mv += value; cost += p.cost * p.qty;
      if (q) dayPnl += (q.price - q.prev) * p.qty;
      return { ...p, price, value, pnl, pnlPct, pct: q ? q.pct : 0, prev: q ? q.prev : p.cost };
    });
    const total = s.cash + mv;
    return {
      cash: s.cash,
      marketValue: mv,
      cost,
      total,
      totalPnl: total - s.initial,
      totalPnlPct: ((total - s.initial) / s.initial) * 100,
      floatPnl: mv - cost,
      dayPnl,
      list: list.sort((a, b) => b.value - a.value),
    };
  }

  /* ---------- 工具 ---------- */
  const uid = () => Math.random().toString(36).slice(2, 10);
  const pad = (n) => String(n).padStart(2, '0');
  function today() { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; }
  function now() { const d = new Date(); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
  function fmt(n, d = 2) {
    if (!Number.isFinite(n)) return '--';
    return n.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtBig(n) {
    if (!Number.isFinite(n)) return '--';
    if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(2) + '万亿';
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + '亿';
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + '万';
    return n.toFixed(0);
  }
  function fmtVol(n) {
    if (!Number.isFinite(n)) return '--';
    if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿手';
    if (n >= 1e4) return (n / 1e4).toFixed(1) + '万手';
    return n.toFixed(0) + '手';
  }

  load();

  return {
    get, save, sub, reset, inWatch, toggleWatch, buy, sell, settleT1, summary, feeOf,
    fmt, fmtBig, fmtVol, today, now, FEE,
    cloud: CLOUD, onCloud, syncNow, createShare, revokeShare, loadShareState,
    setProfile, getProfile, disconnect,
  };
})();
