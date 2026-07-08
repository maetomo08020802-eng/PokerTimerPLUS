'use strict';
// remote-control Phase 0 スパイク — Node 標準 http のみの LAN サーバ（追加ライブラリゼロ）。
//
// 役割: スマホのブラウザに操作ページ(phone.html)を配り、POST /api/op を PIN 検証して
//   操作名を eventLike payload に写像し、onOp(payload, op) コールバックに渡す。
// Phase 1 では onOp が `mainWindow.webContents.send('remote:op', payload)` 相当になる
//   （renderer 側で operator-solo でも受信するリスナーが dispatchClockShortcut を呼ぶ）。
// Phase 0 スコープ: 認証は PIN のみ・状態表示(SSE)は未実装・全操作の網羅UIは phone.html に最小掲載。
//   Origin 検証/トークン/レート制限/SSE は Phase 1（認証境界=別格レビュー）。

const http = require('http');
const fs = require('fs');
const path = require('path');
const { toForwardedKey } = require('./op-map');

function readPhoneHtml() {
  return fs.readFileSync(path.join(__dirname, 'phone.html'), 'utf8');
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// start({pin, port, host, onOp}) → Promise<{server, port, host, close}>
// host='0.0.0.0' で LAN バインド（別端末から到達可能）。port=0 で空きポート自動選択。
function start({ pin = '0000', port = 0, host = '0.0.0.0', onOp = () => {} } = {}) {
  const server = http.createServer((req, res) => {
    // 操作ページ配信
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?') || req.url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readPhoneHtml());
      return;
    }
    // 操作コマンド
    if (req.method === 'POST' && req.url === '/api/op') {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 4096) { req.destroy(); } // 過大ボディ拒否（Phase 0 の最小防御）
      });
      req.on('end', () => {
        let data = null;
        try { data = JSON.parse(body); } catch (_) { /* fallthrough */ }
        if (!data || typeof data !== 'object') return sendJson(res, 400, { ok: false, reason: 'bad-json' });
        // PIN 認証（第三者の勝手な操作を防ぐ最小認証。Phase 1 でトークン/Origin に強化）
        if (String(data.pin) !== String(pin)) return sendJson(res, 401, { ok: false, reason: 'bad-pin' });
        // 操作名のホワイトリスト写像（未知 op は破棄＝sanitize 思想）
        const payload = toForwardedKey(data.op);
        if (!payload) return sendJson(res, 400, { ok: false, reason: 'unknown-op' });
        try { onOp(payload, data.op); } catch (_) { /* never throw from transport */ }
        return sendJson(res, 200, { ok: true, op: data.op, payload });
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({
        server,
        host,
        port: server.address().port,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

module.exports = { start };
