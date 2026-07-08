'use strict';
// remote-control Phase 1a — Node 標準 http のみの LAN サーバ（追加ライブラリゼロ）。
//
// Phase 0 スパイク（spike-remote-control/server.js）を src へ昇格し、認証境界を本実装した版。
// 役割: スマホのブラウザに操作ページ(phone.html)を配り、POST /api/op を認証してから操作名を
//   eventLike payload に写像し、onOp(payload, op) コールバックに渡す（main が remote:op で renderer へ）。
//
// ★認証境界（Phase 1a 分担・plan §認証設計 / plan_review の 7 層 + 追加条件を実装）:
//   脅威 (a) ブラウザ駆動 cross-origin CSRF / DNS リバインディング、(b) LAN 直クライアント PIN 総当り。
//   層1 method/path ホワイトリスト（GET / と POST /api/op のみ・OPTIONS は 405 で ACAO を返さない）
//   層2 Content-Type=application/json 必須（→ cross-origin simple request を封じ・JSON POST は preflight 必須化）
//        ★条件1: サーバは Access-Control-Allow-Origin を一切返さない（preflight を許可しない）＝層2 の生命線
//   層3 Host ヘッダ許可（localhost / loopback / プライベート IPv4 の【アンカー付き完全一致】＝DNS リバインディング防御）
//        ★条件2: 部分一致は使わず正規表現アンカーで判定（`192.168.1.5.evil.com` 等のサブドメイン偽装を 403）
//   層4 Origin/Referer 検証（存在時は host:port が Host と一致＝同一オリジンのみ許可）
//   層5 body ホワイトリスト（{pin, op} のみ・op は toForwardedKey のホワイトリスト・未知は破棄・過大ボディ拒否）
//   層6 PIN（起動ごと再生成の 6 桁を main が注入・crypto.timingSafeEqual の定数時間比較）
//   層7 レート制限（リモート IP 単位 sliding window で PIN 失敗を集計・閾値超で 429 クールダウン・上限で prune）
//   バインド 0.0.0.0（会場スマホ到達に必須。露出は default OFF + 上記多層 + Windows FW inbound で受容）。
//   セッショントークン・QR・SSE・危険操作 confirm は Phase 1b。

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { toForwardedKey } = require('./op-map');

const MAX_BODY_BYTES = 4096;

// ★条件2: プライベート IPv4（各オクテット厳格）+ loopback を【アンカー付き完全一致】で判定。
//   URL.hostname は port / ブラケットを除去済のホスト名のみ（例 '192.168.1.5' / '::1'）。
const PRIVATE_IPV4_RE = new RegExp(
  '^(?:' +
    '10\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)' +
    '|172\\.(?:1[6-9]|2\\d|3[01])\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)' +
    '|192\\.168\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)' +
    '|127\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)' +
  ')$'
);

// Host ヘッダ / Origin を安全に解釈するためのパーサ。garbage は null（→ 呼出側で 403）。
function parseHostLike(value, assumeScheme) {
  if (typeof value !== 'string' || !value) return null;
  try {
    // Host には scheme が無いので付与。Origin/Referer には既に scheme がある。
    const u = new URL(assumeScheme ? 'http://' + value : value);
    return { hostname: u.hostname, host: u.host }; // host は必要時のみ port を含む正規化済文字列
  } catch (_) {
    return null;
  }
}

// 層3: Host ヘッダのホスト名が許可集合（localhost / loopback / プライベート IPv4）に完全一致するか。
function isAllowedHostname(hostname) {
  if (hostname === 'localhost' || hostname === '::1') return true;
  return PRIVATE_IPV4_RE.test(hostname);
}

// 層6: PIN 定数時間比較（長さ不一致は即 false・crypto.timingSafeEqual は同長必須）。
function pinEqual(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a), 'utf8');
  const bb = Buffer.from(String(b == null ? '' : b), 'utf8');
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch (_) { return false; }
}

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

// start({ getPin, port, host, onOp }) → Promise<{ server, port, host, close }>
//   getPin: () => string（main が起動ごと再生成した現行 PIN を返す関数。server 内に PIN を焼き込まない）
//   host='0.0.0.0' で LAN バインド（別端末から到達可能）。port=0 で空きポート自動選択。
//   port!==0 で EADDRINUSE の時は port=0（OS 空きポート）で 1 回だけ自動リトライ。
function start({ getPin = () => '', port = 0, host = '0.0.0.0', onOp = () => {} } = {}) {
  // 層7: レート制限の状態は start() のクロージャに閉じ込める（OFF→ON 再起動で失敗カウンタがリセットされる）。
  const RL_WINDOW_MS = 60_000;   // 失敗を数える窓
  const RL_MAX_FAILS = 10;       // 窓内失敗がこの数に達したらロック
  const RL_LOCKOUT_MS = 60_000;  // ロック時間
  const RL_MAX_IPS = 2000;       // IP マップ上限（肥大防止）
  const rateMap = new Map();     // ip -> { fails: number[], lockedUntil: number, lastSeen: number }

  function rlPrune(now) {
    for (const [ip, e] of rateMap) {
      if (e.lockedUntil <= now && (now - e.lastSeen) > RL_WINDOW_MS) rateMap.delete(ip);
    }
  }
  function rlGet(ip, now) {
    let e = rateMap.get(ip);
    if (!e) {
      if (rateMap.size >= RL_MAX_IPS) rlPrune(now);
      e = { fails: [], lockedUntil: 0, lastSeen: now };
      rateMap.set(ip, e);
    }
    e.lastSeen = now;
    return e;
  }
  function rlRecordFail(e, now) {
    e.fails = e.fails.filter((t) => now - t < RL_WINDOW_MS);
    e.fails.push(now);
    if (e.fails.length >= RL_MAX_FAILS) { e.lockedUntil = now + RL_LOCKOUT_MS; e.fails = []; }
  }
  function rlRecordSuccess(e) { e.fails = []; e.lockedUntil = 0; }

  function handleOp(req, res) {
    // 層7-a: ロック中の IP は認証処理に入る前に 429（総当りコスト増）。
    const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
    const now = Date.now();
    const rl = rlGet(ip, now);
    if (rl.lockedUntil > now) return sendJson(res, 429, { ok: false, reason: 'rate-limited' });

    // 層2: Content-Type=application/json 必須（cross-origin simple request を封じる）。
    const ctype = String(req.headers['content-type'] || '');
    if (!/^application\/json\b/i.test(ctype)) return sendJson(res, 415, { ok: false, reason: 'unsupported-media-type' });

    // 層4: Origin/Referer が存在する場合は Host と同一オリジンでなければ拒否。
    const hostHeader = parseHostLike(req.headers.host, true);
    const originRaw = req.headers.origin || req.headers.referer || '';
    if (originRaw) {
      const origin = parseHostLike(originRaw, false);
      if (!origin || !hostHeader || origin.host !== hostHeader.host) {
        return sendJson(res, 403, { ok: false, reason: 'bad-origin' });
      }
    }

    // 層5: 過大ボディ拒否 + JSON パース。
    let body = '';
    let tooLarge = false;
    req.on('data', (c) => {
      if (tooLarge) return;
      body += c;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) { tooLarge = true; }
    });
    req.on('end', () => {
      if (tooLarge) return sendJson(res, 413, { ok: false, reason: 'body-too-large' });
      let data = null;
      try { data = JSON.parse(body); } catch (_) { /* fallthrough */ }
      if (!data || typeof data !== 'object') return sendJson(res, 400, { ok: false, reason: 'bad-json' });

      // 層6: PIN 認証（定数時間比較）。不一致は失敗を記録して 401。
      if (!pinEqual(data.pin, getPin())) {
        rlRecordFail(rl, Date.now());
        return sendJson(res, 401, { ok: false, reason: 'bad-pin' });
      }

      // 層5: 操作名のホワイトリスト写像（未知 op は破棄）。
      const payload = toForwardedKey(data.op);
      if (!payload) return sendJson(res, 400, { ok: false, reason: 'unknown-op' });

      rlRecordSuccess(rl); // 認証成功で失敗カウンタをクリア
      try { onOp(payload, data.op); } catch (_) { /* never throw from transport */ }
      return sendJson(res, 200, { ok: true, op: data.op, payload });
    });
    req.on('error', () => { try { res.destroy(); } catch (_) { /* ignore */ } });
  }

  const server = http.createServer((req, res) => {
    // 層1: OPTIONS（preflight）には ACAO を含む許可応答を返さない（405・条件1）。
    if (req.method === 'OPTIONS') return sendText(res, 405, 'method not allowed');

    // 層3: Host ヘッダ許可（全リクエスト共通・DNS リバインディング防御）。
    const hostHeader = parseHostLike(req.headers.host, true);
    if (!hostHeader || !isAllowedHostname(hostHeader.hostname)) {
      return sendJson(res, 403, { ok: false, reason: 'bad-host' });
    }

    // 層1: 操作ページ配信（GET / のみ）。
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?') || req.url === '/index.html')) {
      let html = '';
      try { html = readPhoneHtml(); } catch (_) { return sendText(res, 500, 'internal error'); }
      return sendText(res, 200, html, 'text/html; charset=utf-8');
    }
    // 層1: 操作コマンド（POST /api/op のみ）。
    if (req.method === 'POST' && req.url === '/api/op') return handleOp(req, res);

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
          close: () => new Promise((r) => server.close(() => r()))
        });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, host);
    });
  }

  // port!==0 の EADDRINUSE は port=0（OS 空きポート）で 1 回だけ自動リトライ。
  return listenOnce(port).catch((err) => {
    if (err && err.code === 'EADDRINUSE' && port !== 0) return listenOnce(0);
    throw err;
  });
}

module.exports = { start, isAllowedHostname, pinEqual };
