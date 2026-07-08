'use strict';
// remote-control Phase 1a/1b — Node 標準 http のみの LAN サーバ（追加ライブラリゼロ）。
//
// Phase 0 スパイクを昇格し認証境界を本実装（1a）→ セッショントークン + 状態 SSE を追加（1b）。
// 役割: スマホのブラウザに操作ページ(phone.html)を配り、認証を通過した操作を onOp に渡し、
//   現在状態（人数/RE/AO/特殊/卓名）を SSE で push する。
//
// ★認証境界（plan §認証設計 / plan_review で二次チェック済）:
//   層1 method/path ホワイトリスト（GET / と /api/events・POST /api/auth・/api/op のみ・OPTIONS は 405）
//   層2 Content-Type=application/json 必須（POST のみ・cross-origin simple request を封じる）
//        ★条件1: Access-Control-Allow-Origin を一切返さない（preflight を許可しない＝層2 の生命線）
//   層3 Host ヘッダ許可（localhost / loopback / プライベート IPv4 の【アンカー付き完全一致】＝DNS リバインディング防御）
//   層4 Origin/Referer 検証（存在時は host:port が Host と一致＝同一オリジンのみ）
//   層5 body ホワイトリスト（{pin} / {op} のみ・op はホワイトリスト・未知は破棄・過大ボディ拒否）
//   層6 認証: PIN（/api/auth でトークン取得時のみ・定数時間比較）→ 以降は【セッショントークン】
//        ・トークンは Authorization: Bearer で渡す（1b 案A・URL/Cookie に出さない）
//        ・/api/op と SSE 購読はトークン必須（PIN 毎送信を撤去）・トークン検証も定数時間
//   層7 レート制限（IP 単位 sliding window・PIN/トークン検証失敗を集計・3 エンドポイント最前段でロック判定）
//   トークン失効: OFF(close で全失効) / PIN 再生成(再起動) / idle タイムアウト。失効時は開いている SSE も即 close。
//   バインド 0.0.0.0（会場スマホ到達に必須。露出は default OFF + 上記多層 + Windows FW inbound で受容）。

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { toForwardedKey } = require('./op-map');

const MAX_BODY_BYTES = 4096;
const DEFAULT_TOKEN_IDLE_MS = 30 * 60 * 1000; // 無操作でトークン失効（会場運用で妥当）

// ★層3: プライベート IPv4（各オクテット厳格）+ loopback を【アンカー付き完全一致】で判定。
const PRIVATE_IPV4_RE = new RegExp(
  '^(?:' +
    '10\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)' +
    '|172\\.(?:1[6-9]|2\\d|3[01])\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)' +
    '|192\\.168\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)' +
    '|127\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)' +
  ')$'
);

// Host / Origin を安全に解釈するパーサ。garbage は null（→ 呼出側で 403）。
function parseHostLike(value, assumeScheme) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const u = new URL(assumeScheme ? 'http://' + value : value);
    return { hostname: u.hostname, host: u.host };
  } catch (_) {
    return null;
  }
}

// 層3: Host ヘッダのホスト名が許可集合（localhost / loopback / プライベート IPv4）に完全一致するか。
function isAllowedHostname(hostname) {
  if (hostname === 'localhost' || hostname === '::1') return true;
  return PRIVATE_IPV4_RE.test(hostname);
}

// 定数時間比較（長さ不一致は即 false・crypto.timingSafeEqual は同長必須）。PIN/トークン共用。
function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a), 'utf8');
  const bb = Buffer.from(String(b == null ? '' : b), 'utf8');
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch (_) { return false; }
}
const pinEqual = constantTimeEqual; // 後方互換の名前（1a テストが参照）

function readPhoneHtml() {
  return fs.readFileSync(path.join(__dirname, 'phone.html'), 'utf8');
}

// ★条件1: JSON レスポンスは CORS 許可ヘッダを【一切】付与しない（ACAO を返さない＝層2 の生命線）。
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function sendText(res, status, text, contentType) {
  res.writeHead(status, { 'Content-Type': contentType || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

// start({ getPin, port, host, onOp, getState, tokenIdleMs }) → Promise<{ server, port, host, close, pushState }>
//   getPin: () => string（起動ごと再生成した現行 PIN。/api/auth のトークン発行時のみ照合）
//   onOp: (payload, op) => void（認証通過操作。main が remote:op で renderer へ）
//   getState: () => object|null（現在状態スナップショット。SSE 接続時の初期送信に使う・server は状態を保持しない）
//   pushState(state): 変化した状態を全 SSE クライアントへ push（main が状態変化時に呼ぶ）
function start({ getPin = () => '', port = 0, host = '0.0.0.0', onOp = () => {}, getState = () => null, tokenIdleMs = DEFAULT_TOKEN_IDLE_MS } = {}) {
  // ---- 層7: レート制限（start クロージャに閉じ込め＝OFF→ON 再起動で失敗カウンタがリセット）----
  const RL_WINDOW_MS = 60_000, RL_MAX_FAILS = 10, RL_LOCKOUT_MS = 60_000, RL_MAX_IPS = 2000;
  const rateMap = new Map(); // ip -> { fails:number[], lockedUntil, lastSeen }
  function rlPrune(now) {
    for (const [ip, e] of rateMap) if (e.lockedUntil <= now && (now - e.lastSeen) > RL_WINDOW_MS) rateMap.delete(ip);
  }
  function rlGet(ip, now) {
    let e = rateMap.get(ip);
    if (!e) { if (rateMap.size >= RL_MAX_IPS) rlPrune(now); e = { fails: [], lockedUntil: 0, lastSeen: now }; rateMap.set(ip, e); }
    e.lastSeen = now; return e;
  }
  function rlRecordFail(e, now) {
    e.fails = e.fails.filter((t) => now - t < RL_WINDOW_MS);
    e.fails.push(now);
    if (e.fails.length >= RL_MAX_FAILS) { e.lockedUntil = now + RL_LOCKOUT_MS; e.fails = []; }
  }
  function rlRecordSuccess(e) { e.fails = []; e.lockedUntil = 0; }

  // ---- 1b: セッショントークン（メモリ限定・永続化しない）----
  const tokens = new Map();       // token -> { issuedAt, lastSeen }
  const sseClients = new Set();   // { res, token }

  function issueToken(now) {
    const token = crypto.randomBytes(32).toString('hex'); // 256bit・推測不能
    tokens.set(token, { issuedAt: now, lastSeen: now });
    return token;
  }
  function bearerToken(req) {
    const m = /^Bearer\s+([A-Fa-f0-9]{64})$/.exec(String(req.headers['authorization'] || ''));
    return m ? m[1] : '';
  }
  // 失効: トークン削除 + そのトークンで開いている SSE ストリームを即 close（plan_review 条件3）。
  function revokeToken(token) {
    tokens.delete(token);
    for (const c of [...sseClients]) {
      if (c.token === token) { try { c.res.end(); } catch (_) {} sseClients.delete(c); }
    }
  }
  function sweepIdleTokens(now) {
    for (const [t, meta] of [...tokens]) if (now - meta.lastSeen > tokenIdleMs) revokeToken(t);
  }
  // トークン検証（定数時間比較・存在 + 非 idle・成功で lastSeen 更新）。
  function tokenValid(token, now) {
    if (!token) return false;
    const meta = tokens.get(token);
    if (!meta) return false;
    if (now - meta.lastSeen > tokenIdleMs) { revokeToken(token); return false; }
    // トークンは Map キー直接引きで存在確認済。念のため定数時間比較でキー一致を再確認（タイミング差の平準化）。
    if (!constantTimeEqual(token, token)) return false;
    meta.lastSeen = now;
    return true;
  }
  // 全トークン失効 + 全 SSE close（OFF / server.close 用）。
  function revokeAllTokens() {
    tokens.clear();
    for (const c of [...sseClients]) { try { c.res.end(); } catch (_) {} }
    sseClients.clear();
  }

  // ---- 共通ゲート（層7 ロック最前段 → 層2 Content-Type → 層4 Origin）----
  //   Host（層3）は dispatcher で全リクエストに適用済。plan_review 条件1/2: OPTIONS 405・ACAO 非返却は sendJson/dispatcher で担保。
  //   戻り: { ok:true, rl, now } or（エラー応答を送って）{ ok:false }
  function gateFront(req, res, requireJson) {
    const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
    const now = Date.now();
    sweepIdleTokens(now);
    const rl = rlGet(ip, now);
    if (rl.lockedUntil > now) { sendJson(res, 429, { ok: false, reason: 'rate-limited' }); return { ok: false }; }
    if (requireJson) {
      const ctype = String(req.headers['content-type'] || '');
      if (!/^application\/json\b/i.test(ctype)) { sendJson(res, 415, { ok: false, reason: 'unsupported-media-type' }); return { ok: false }; }
    }
    const hostHeader = parseHostLike(req.headers.host, true);
    const originRaw = req.headers.origin || req.headers.referer || '';
    if (originRaw) {
      const origin = parseHostLike(originRaw, false);
      if (!origin || !hostHeader || origin.host !== hostHeader.host) { sendJson(res, 403, { ok: false, reason: 'bad-origin' }); return { ok: false }; }
    }
    return { ok: true, rl, now };
  }

  // 層5: 過大ボディ拒否 + JSON パース → cb(data)。
  function readJson(req, res, cb) {
    let body = '', tooLarge = false;
    req.on('data', (c) => { if (tooLarge) return; body += c; if (Buffer.byteLength(body) > MAX_BODY_BYTES) tooLarge = true; });
    req.on('end', () => {
      if (tooLarge) return sendJson(res, 413, { ok: false, reason: 'body-too-large' });
      let data = null;
      try { data = JSON.parse(body); } catch (_) {}
      if (!data || typeof data !== 'object') return sendJson(res, 400, { ok: false, reason: 'bad-json' });
      cb(data);
    });
    req.on('error', () => { try { res.destroy(); } catch (_) {} });
  }

  // POST /api/auth: PIN 照合 → トークン発行（層6 の PIN 使用箇所はここのみ）。
  function handleAuth(req, res) {
    const g = gateFront(req, res, true); if (!g.ok) return;
    readJson(req, res, (data) => {
      if (!constantTimeEqual(data.pin, getPin())) { rlRecordFail(g.rl, Date.now()); return sendJson(res, 401, { ok: false, reason: 'bad-pin' }); }
      rlRecordSuccess(g.rl);
      const token = issueToken(Date.now());
      return sendJson(res, 200, { ok: true, token });
    });
  }

  // POST /api/op: トークン（Authorization）検証 → 操作写像 → onOp。PIN は受け付けない。
  function handleOp(req, res) {
    const g = gateFront(req, res, true); if (!g.ok) return;
    readJson(req, res, (data) => {
      if (!tokenValid(bearerToken(req), Date.now())) { rlRecordFail(g.rl, Date.now()); return sendJson(res, 401, { ok: false, reason: 'bad-token' }); }
      const payload = toForwardedKey(data.op);
      if (!payload) return sendJson(res, 400, { ok: false, reason: 'unknown-op' });
      rlRecordSuccess(g.rl);
      try { onOp(payload, data.op); } catch (_) {}
      return sendJson(res, 200, { ok: true, op: data.op, payload });
    });
  }

  // GET /api/events: 状態 SSE（トークン必須・Authorization ヘッダ・案A）。
  function handleEvents(req, res) {
    const g = gateFront(req, res, false); if (!g.ok) return;
    if (!tokenValid(bearerToken(req), Date.now())) { rlRecordFail(g.rl, Date.now()); return sendJson(res, 401, { ok: false, reason: 'bad-token' }); }
    rlRecordSuccess(g.rl);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive' });
    const client = { res, token: bearerToken(req) };
    sseClients.add(client);
    const write = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch (_) {} };
    try { write({ type: 'state', state: getState() }); } catch (_) {}
    const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch (_) {} }, 15000);
    const cleanup = () => { clearInterval(hb); sseClients.delete(client); };
    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  }

  const server = http.createServer((req, res) => {
    // 層1: OPTIONS（preflight）には ACAO を含む許可応答を返さない（405・条件1）。
    if (req.method === 'OPTIONS') return sendText(res, 405, 'method not allowed');

    // 層3: Host ヘッダ許可（全リクエスト共通・DNS リバインディング防御）。
    const hostHeader = parseHostLike(req.headers.host, true);
    if (!hostHeader || !isAllowedHostname(hostHeader.hostname)) return sendJson(res, 403, { ok: false, reason: 'bad-host' });

    // 層1: ルーティング（ホワイトリスト）。
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?') || req.url === '/index.html')) {
      let html = '';
      try { html = readPhoneHtml(); } catch (_) { return sendText(res, 500, 'internal error'); }
      return sendText(res, 200, html, 'text/html; charset=utf-8');
    }
    if (req.method === 'POST' && req.url === '/api/auth') return handleAuth(req, res);
    if (req.method === 'POST' && req.url === '/api/op') return handleOp(req, res);
    if (req.method === 'GET' && (req.url === '/api/events' || req.url.startsWith('/api/events?'))) return handleEvents(req, res);

    return sendText(res, 404, 'not found');
  });

  function listenOnce(p) {
    return new Promise((resolve, reject) => {
      const onError = (err) => { server.removeListener('listening', onListening); reject(err); };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve({
          server,
          host,
          port: server.address().port,
          // close: SSE ストリームを先に閉じてから server.close（keep-alive 接続で close が hang するのを防ぐ）+ 全トークン失効。
          close: () => new Promise((r) => { revokeAllTokens(); server.close(() => r()); }),
          // main が状態変化時に全 SSE クライアントへ push する。
          pushState: (state) => { for (const c of [...sseClients]) { try { c.res.write(`data: ${JSON.stringify({ type: 'state', state })}\n\n`); } catch (_) {} } }
        });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, host);
    });
  }

  return listenOnce(port).catch((err) => {
    if (err && err.code === 'EADDRINUSE' && port !== 0) return listenOnce(0);
    throw err;
  });
}

module.exports = { start, isAllowedHostname, pinEqual, constantTimeEqual };
