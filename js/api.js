/* ============================================================
 * api.js — 行情数据层
 * 数据源：腾讯财经公开接口（实时报价 / K线 / 分时 / 排行 / 板块）
 *         东方财富快讯（资讯）
 * 全部为 GET + CORS 开放接口，浏览器可直连；失败时降级到缓存 / 模拟。
 * ============================================================ */
const API = (() => {
  const QT = 'https://qt.gtimg.cn/q=';
  const KLINE = [
    'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get',
    'https://ifzq.gtimg.cn/appstock/app/newfqkline/get',
  ];
  const MINUTE = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=';
  const RANK = 'https://proxy.finance.qq.com/cgi/cgi-bin/rank/hs/getBoardRankList';
  const SECTOR = 'https://proxy.finance.qq.com/cgi/cgi-bin/rank/pt/getRank';
  const NEWS = 'https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_60_1_.html';
  const SEARCH = 'https://smartbox.gtimg.cn/s3/?v=2&t=all&q=';

  const mem = new Map();
  const LS = 'stockapp.cache.v2';

  /* ---------- 本地缓存（用于离线兜底） ---------- */
  let disk = {};
  try { disk = JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { disk = {}; }
  let flushTimer = null;
  function saveDisk() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      try { localStorage.setItem(LS, JSON.stringify(disk)); } catch (e) {}
    }, 400);
  }

  async function jget(url, { text = false, gbk = false, proxyable = false } = {}) {
    // 排行/板块/资讯等无 CORS 头的接口，优先走本地代理（node server.js），失败再直连。
    // 若页面直接用 file:// 打开（无代理可用），跳过代理直连，失败时由上层降级。
    const httpCtx = location.protocol === 'http:' || location.protocol === 'https:';
    const viaProxy = proxyable && httpCtx;
    const tryUrls = viaProxy ? ['/px?url=' + encodeURIComponent(url), url] : [url];
    let lastErr = null;
    for (const u of tryUrls) {
      try {
        const res = await fetch(u, { credentials: 'omit', mode: 'cors' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        if (text) {
          const buf = await res.arrayBuffer();
          return new TextDecoder(gbk ? 'gbk' : 'utf-8').decode(buf);
        }
        return res.json();
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  /* ---------- 单只股票实时快照 ---------- */
  // fields: 0市场 1名称 2代码 3现价 4昨收 5今开 ...
  function parseQuote(raw, symbol) {
    const a = raw.split('~');
    const price = num(a[3]);
    const prev = num(a[4]);
    const open = num(a[5]);
    const pct = num(a[32]);
    const chg = a[31] !== undefined && a[31] !== '' ? num(a[31]) : price - prev;
    const bid = [], ask = [];
    for (let i = 0; i < 5; i++) {
      const bq = num(a[10 + i * 2]), bp = num(a[9 + i * 2]);
      const aq = num(a[20 + i * 2]), ap = num(a[19 + i * 2]);
      if (bp > 0) bid.push({ p: bp, v: bq });
      if (ap > 0) ask.push({ p: ap, v: aq });
    }
    return {
      code: symbol,
      sym: symbol.slice(2),
      name: a[1],
      price,
      prev,
      open,
      high: num(a[33]),
      low: num(a[34]),
      chg: +chg.toFixed(3),
      pct: +pct.toFixed(2),
      vol: num(a[36]),          // 手
      amount: num(a[37]) * 1e4, // 元
      turnover: num(a[38]),     // 换手率
      pe: num(a[39]),
      amplitude: num(a[43]),
      floatCap: num(a[44]) * 1e8,
      totalCap: num(a[45]) * 1e8,
      pb: num(a[46]),
      limitUp: num(a[47]),
      limitDown: num(a[48]),
      volRatio: num(a[49]),
      avgPrice: num(a[51]),
      time: a[30] || '',
      bid, ask,
      // 盘口剩余字段
      outerVol: num(a[7]), innerVol: num(a[8]),
    };
  }

  async function quotes(codes) {
    if (!codes || !codes.length) return [];
    const out = [];
    for (let i = 0; i < codes.length; i += 50) {
      const chunk = codes.slice(i, i + 50);
      const txt = await jget(QT + chunk.join(','), { text: true, gbk: true });
      txt.split(';').forEach((seg) => {
        const m = seg.match(/v_([a-z]{2}\d+[A-Za-z0-9]*)="([^"]*)"/);
        if (m && m[2]) {
          try { out.push(parseQuote(m[2], m[1])); } catch (e) {}
        }
      });
    }
    return out;
  }

  /* ---------- K 线 ---------- */
  // period: day | week | month ；fq: qfq | (空)
  async function kline(code, period = 'day', count = 160, fq = 'qfq') {
    const key = `k_${code}_${period}_${count}_${fq}`;
    if (mem.has(key)) return mem.get(key);
    const param = `${code},${period},,,${count},${fq}`;
    let data = null, lastErr = null;
    for (const base of KLINE) {
      try {
        const j = await jget(`${base}?param=${param}&_var=&r=0.${Date.now() % 1000000}`);
        const d = j.data && j.data[code];
        if (!d) throw new Error('empty');
        const rows = d[fq + period] || d[period] || d.qfqday || d.day || [];
        data = rows.map((r) => ({
          date: r[0], open: num(r[1]), close: num(r[2]), high: num(r[3]), low: num(r[4]),
          vol: num(r[5]), amount: num(r[8]) * 1e4,
        })).filter((r) => r.close > 0);
        break;
      } catch (e) { lastErr = e; }
    }
    if (!data || !data.length) throw (lastErr || new Error('kline unavailable'));
    mem.set(key, data);
    return data;
  }

  /* ---------- 分时 ---------- */
  async function minute(code) {
    const key = `m_${code}`;
    if (mem.has(key)) return mem.get(key);
    const j = await jget(MINUTE + code + '&_var=&r=' + (Date.now() % 1000000));
    const d = j.data && j.data[code] && j.data[code].data;
    if (!d || !d.data) throw new Error('no minute data');
    const pts = d.data.map((s) => {
      const p = s.split(' ');
      return {
        t: p[0],
        price: num(p[1]),
        vol: num(p[2]),          // 累计量（手）
        amount: num(p[3]),       // 累计额
      };
    });
    const prev = num(d.date && d.date > 0 ? 0 : 0);
    const out = { pts, prev, date: d.date || '' };
    mem.set(key, out);
    return out;
  }

  /* ---------- 排行 ---------- */
  // sort: priceRatio(涨跌幅) | turnover(成交额) | hsl(换手) | zsz(市值) | speed(涨速)
  async function rank({ sort = 'priceRatio', dir = 'down', offset = 0, count = 20, board = 'aStock' } = {}) {
    const url = `${RANK}?board_code=${board}&sort_type=${sort}&direct=${dir}&offset=${offset}&count=${count}&_appver=11.17.0`;
    const j = await jget(url, { proxyable: true });
    const list = (j.data && j.data.rank_list) || [];
    return list.map((r) => ({
      code: r.code,
      name: r.name,
      price: num(r.zxj),
      pct: num(r.zdf),
      chg: num(r.zd),
      turnover: num(r.turnover) * 1e4,
      turnoverRate: num(r.hsl),
      volRatio: num(r.lb),
      pe: num(r.pe_ttm),
      totalCap: num(r.zsz) * 1e8,
      floatCap: num(r.ltsz) * 1e8,
      speed: num(r.speed),
      pct5: num(r.zdf_d5), pct20: num(r.zdf_d20), pct60: num(r.zdf_d60),
      netIn: num(r.zljlr) * 1e4, // 主力净流入
    }));
  }

  /* ---------- 行业板块 ---------- */
  async function sectors(dir = 'down', count = 30) {
    const url = `${SECTOR}?board_type=hy&sort_type=priceRatio&direct=${dir}&offset=0&count=${count}`;
    const j = await jget(url, { proxyable: true });
    const list = (j.data && j.data.rank_list) || [];
    return list.map((r) => ({
      code: r.code,
      name: r.name,
      pct: num(r.zdf),
      price: num(r.zxj),
      lead: r.lzg ? { code: r.lzg.code, name: r.lzg.name, pct: num(r.lzg.zdf) } : null,
      up: num(String(r.zgb || '').split('/')[0]),
      total: num(String(r.zgb || '').split('/')[1]),
      turnover: num(r.turnover) * 1e4,
      netIn: num(r.zljlr) * 1e4,
    }));
  }

  /* ---------- 搜索 ---------- */
  async function search(q) {
    if (!q || !q.trim()) return [];
    const txt = await jget(SEARCH + encodeURIComponent(q.trim()), { text: true, gbk: true });
    const m = txt.match(/="([^"]*)"/);
    if (!m || !m[1]) return [];
    return m[1].split('^').map((row) => {
      const p = row.split('~');
      if (p.length < 3) return null;
      const mk = p[0];
      if (!['sh', 'sz', 'bj', 'hk', 'us'].includes(mk)) return null;
      return { code: mk + p[1], name: p[2], type: p.length > 4 ? p[4] : '' };
    }).filter(Boolean);
  }

  /* ---------- 资讯快讯 ---------- */
  async function news() {
    const txt = await jget(NEWS, { text: true, proxyable: true });
    const m = txt.match(/ajaxResult=(\{[\s\S]*\})/);
    if (!m) throw new Error('news parse');
    const j = JSON.parse(m[1]);
    const strip = (s) => String(s || '').replace(/<[^>]+>/g, '');
    return (j.LivesList || []).map((n) => {
      const title = strip(n.simtitle || n.title);
      let body = strip(n.digest || '');
      body = body.replace(/^【[^】]*】/, '').trim();
      const t = String(n.showtime || n.time || '');
      return {
        id: n.newsid,
        title: title || body.slice(0, 40),
        body: body || title,
        url: n.url_w || n.url_unique || '',
        time: t.length >= 16 ? t.slice(5, 16) : t,
      };
    }).slice(0, 60);
  }

  /* ---------- 带缓存的包装：网络失败则用缓存/兜底 ---------- */
  async function cached(key, fn, fallback) {
    try {
      const v = await fn();
      const pack = { t: Date.now(), v };
      disk[key] = pack; saveDisk();
      return { ...pack, stale: false };
    } catch (e) {
      if (disk[key]) return { ...disk[key], stale: true, error: String(e.message || e) };
      if (fallback) return { t: Date.now(), v: fallback(), stale: true, error: String(e.message || e) };
      throw e;
    }
  }

  return { quotes, kline, minute, rank, sectors, search, news, cached, disk, saveDisk, mem };
})();
