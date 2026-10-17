/* ============================================================
 * server.js — 棱镜 PRISM 服务端
 *  1) 静态资源托管
 *  2) /px      行情代理（绕过浏览器 CORS）
 *  3) /api/*   战绩分享后端（账户令牌 + 快照 + 只读分享链接）
 *  4) /s/:id   只读战绩分享页
 * 依赖：仅 Node 内置模块，零 npm 安装
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.argv[2] || process.env.PORT || 8823;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

/* ---------------- 轻量持久化 ---------------- */
let db = { accounts: {}, shares: {} };
function loadDB() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (parsed && parsed.accounts) db = parsed;
    }
  } catch (e) { console.error('读取数据失败:', e.message); }
}
let saveTimer = null;
function saveDB() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1));
    } catch (e) { console.error('写入数据失败:', e.message); }
  }, 300);
}
loadDB();

/* ---------------- 行情代理白名单 ---------------- */
const ALLOW_HOSTS = new Set([
  'qt.gtimg.cn', 'web.ifzq.gtimg.cn', 'ifzq.gtimg.cn',
  'proxy.finance.qq.com', 'smartbox.gtimg.cn',
  'newsapi.eastmoney.com', 'np-listapi.eastmoney.com',
]);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.md': 'text/markdown; charset=utf-8',
};

/* ---------------- 小工具 ---------------- */
const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Account-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(body);
};

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

const newId = (n = 10) => crypto.randomBytes(n).toString('base64url').slice(0, n);

function getAccount(req) {
  const key = req.headers['x-account-key'];
  if (!key) return null;
  return db.accounts[key] ? { key, acc: db.accounts[key] } : null;
}

/* 只保留分享需要的字段，隐私最小化 */
function publicSnapshot(acc) {
  const s = acc.snapshot || {};
  return {
    name: acc.name || '匿名投资者',
    strategy: acc.strategy || '',
    updatedAt: s.updatedAt || acc.updatedAt || 0,
    initial: s.initial || 1000000,
    cash: s.cash || 0,
    marketValue: s.marketValue || 0,
    total: s.total || 0,
    totalPnl: s.totalPnl || 0,
    totalPnlPct: s.totalPnlPct || 0,
    dayPnl: s.dayPnl || 0,
    positions: Array.isArray(s.positions) ? s.positions.slice(0, 50) : [],
    trades: Array.isArray(s.trades) ? s.trades.slice(0, 50) : [],
    curve: Array.isArray(s.curve) ? s.curve.slice(-120) : [],
    stats: s.stats || {},
  };
}

/* ---------------- 行情代理 ---------------- */
function proxy(req, res, url) {
  const target = url.searchParams.get('url');
  if (!target) { res.writeHead(400); return res.end('missing url'); }
  let u;
  try { u = new URL(target); } catch (e) { res.writeHead(400); return res.end('bad url'); }
  if (!ALLOW_HOSTS.has(u.hostname)) { res.writeHead(403); return res.end('host not allowed'); }
  const lib = require(u.protocol === 'https:' ? 'https' : 'http');
  const preq = lib.request({
    hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      'Referer': 'https://gu.qq.com/', 'Accept': '*/*',
    },
  }, (pres) => {
    const chunks = [];
    pres.on('data', (c) => chunks.push(c));
    pres.on('end', () => {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(Buffer.concat(chunks));
    });
  });
  preq.on('error', (e) => { res.writeHead(502); res.end('proxy error: ' + e.message); });
  preq.setTimeout(10000, () => preq.destroy(new Error('timeout')));
  preq.end();
}

/* ---------------- API 路由 ---------------- */
async function handleApi(req, res, url) {
  const p = url.pathname;

  // 创建账户（客户端首次同步时调用，返回令牌）
  if (p === '/api/account' && req.method === 'POST') {
    const body = await readBody(req);
    const key = newId(16);
    db.accounts[key] = {
      key,
      name: String(body.name || '匿名投资者').slice(0, 20),
      strategy: String(body.strategy || '').slice(0, 60),
      snapshot: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveDB();
    return json(res, 200, { ok: true, key });
  }

  // 同步快照（需令牌）
  if (p === '/api/sync' && req.method === 'POST') {
    const auth = getAccount(req);
    if (!auth) return json(res, 401, { ok: false, err: 'invalid key' });
    const body = await readBody(req);
    if (body.name) auth.acc.name = String(body.name).slice(0, 20);
    if (body.strategy !== undefined) auth.acc.strategy = String(body.strategy).slice(0, 60);
    auth.acc.snapshot = {
      updatedAt: Date.now(),
      initial: +body.initial || 1000000,
      cash: +body.cash || 0,
      marketValue: +body.marketValue || 0,
      total: +body.total || 0,
      totalPnl: +body.totalPnl || 0,
      totalPnlPct: +body.totalPnlPct || 0,
      dayPnl: +body.dayPnl || 0,
      positions: (body.positions || []).slice(0, 50).map((x) => ({
        code: String(x.code || '').slice(0, 12),
        name: String(x.name || '').slice(0, 20),
        qty: +x.qty || 0,
        cost: +x.cost || 0,
        price: +x.price || 0,
        value: +x.value || 0,
        pnl: +x.pnl || 0,
        pnlPct: +x.pnlPct || 0,
      })),
      trades: (body.trades || []).slice(0, 50).map((t) => ({
        time: String(t.time || '').slice(0, 20),
        code: String(t.code || '').slice(0, 12),
        name: String(t.name || '').slice(0, 20),
        side: t.side === 'sell' ? 'sell' : 'buy',
        price: +t.price || 0,
        qty: +t.qty || 0,
        amount: +t.amount || 0,
        pnl: t.pnl == null ? null : +t.pnl,
      })),
      curve: (body.curve || []).slice(-120).map((c) => ({
        t: +c.t || 0, v: +c.v || 0,
      })),
      stats: {
        trades: +((body.stats || {}).trades) || 0,
        winRate: body.stats && body.stats.winRate != null ? +body.stats.winRate : null,
        positionRate: +((body.stats || {}).positionRate) || 0,
      },
    };
    auth.acc.updatedAt = Date.now();
    saveDB();
    return json(res, 200, { ok: true, updatedAt: auth.acc.updatedAt });
  }

  // 生成 / 复用分享链接（需令牌）
  if (p === '/api/share' && req.method === 'POST') {
    const auth = getAccount(req);
    if (!auth) return json(res, 401, { ok: false, err: 'invalid key' });
    let sid = auth.acc.shareId;
    if (!sid || !db.shares[sid]) {
      sid = newId(8);
      db.shares[sid] = { id: sid, owner: auth.key, createdAt: Date.now(), views: 0 };
      auth.acc.shareId = sid;
    }
    db.shares[sid].enabled = true;
    saveDB();
    return json(res, 200, { ok: true, shareId: sid, path: '/s/' + sid });
  }

  // 关闭分享（需令牌）
  if (p === '/api/share' && req.method === 'DELETE') {
    const auth = getAccount(req);
    if (!auth) return json(res, 401, { ok: false, err: 'invalid key' });
    if (auth.acc.shareId && db.shares[auth.acc.shareId]) {
      db.shares[auth.acc.shareId].enabled = false;
      saveDB();
    }
    return json(res, 200, { ok: true });
  }

  // 只读快照（公开，凭 shareId）
  if (p.startsWith('/api/share/') && req.method === 'GET') {
    const sid = p.slice('/api/share/'.length);
    const share = db.shares[sid];
    if (!share || !share.enabled) return json(res, 404, { ok: false, err: 'not found' });
    const acc = db.accounts[share.owner];
    if (!acc) return json(res, 404, { ok: false, err: 'not found' });
    share.views = (share.views || 0) + 1;
    saveDB();
    return json(res, 200, { ok: true, data: publicSnapshot(acc), views: share.views });
  }

  // 当前账户信息（需令牌）
  if (p === '/api/me' && req.method === 'GET') {
    const auth = getAccount(req);
    if (!auth) return json(res, 401, { ok: false, err: 'invalid key' });
    return json(res, 200, {
      ok: true,
      name: auth.acc.name,
      strategy: auth.acc.strategy,
      shareId: auth.acc.shareId || null,
      updatedAt: auth.acc.updatedAt,
    });
  }

  return json(res, 404, { ok: false, err: 'no route' });
}

/* ---------------- 静态文件 ---------------- */
function serveStatic(req, res, url) {
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  if (p === '/s' || p.startsWith('/s/')) p = '/share.html';
  p = decodeURIComponent(p);
  p = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

/* ---------------- 主入口 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Account-Key',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }
  try {
    if (url.pathname === '/px') return proxy(req, res, url);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error('请求处理异常:', e.message);
    return json(res, 500, { ok: false, err: e.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  棱镜 PRISM 已启动`);
  console.log(`  APP      : http://localhost:${PORT}`);
  console.log(`  数据目录 : ${DATA_DIR}\n`);
});
