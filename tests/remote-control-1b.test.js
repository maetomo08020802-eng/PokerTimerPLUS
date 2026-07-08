/**
 * remote-control Phase 1b — セッショントークン + 状態SSE + 失効 + 後方互換のテスト
 *
 * 対象:
 *   - src/remote/server.js（/api/auth トークン発行・/api/op トークン検証・/api/events SSE・失効・レート制限）
 *   - 配線（main の状態橋渡し=読み取り専用 / preload publishState / renderer 送信）
 *   - 1a 認証7層が弱まっていないこと・致命⑤ 非接触・CSP 無改変
 *
 * 実行: node tests/remote-control-1b.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const http   = require('node:http');

const ROOT      = path.join(__dirname, '..');
const MAIN      = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD   = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const RENDERER  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const SERVERSRC = fs.readFileSync(path.join(ROOT, 'src', 'remote', 'server.js'), 'utf8');
const INDEXHTML = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const PHONE     = fs.readFileSync(path.join(ROOT, 'src', 'remote', 'phone.html'), 'utf8');

const server = require('../src/remote/server');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err && err.message); fail++; }
}

function request(port, { method = 'POST', urlPath = '/api/op', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (body != null && h['Content-Length'] == null) h['Content-Length'] = Buffer.byteLength(body);
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers: h }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

// SSE 接続を開き、ヘッダ取得（レスポンスはストリーム＝終わらないので res を返す）。
function openSSE(port, token, extra = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/events', method: 'GET', headers: { Authorization: 'Bearer ' + token, ...extra } },
      (res) => resolve({ status: res.statusCode, headers: res.headers, res, req })
    );
    req.on('error', reject);
    req.end();
  });
}
// SSE ストリームから最初の data イベントを読む（timeout で null）。
function firstEvent(res, timeoutMs = 1000) {
  return new Promise((resolve) => {
    let buf = '';
    const to = setTimeout(() => resolve(null), timeoutMs);
    res.on('data', (c) => {
      buf += c.toString();
      const idx = buf.indexOf('\n\n');
      if (idx >= 0) {
        const m = /data: ?(.*)/.exec(buf.slice(0, idx));
        if (m) { clearTimeout(to); resolve(m[1]); }
      }
    });
    res.on('end', () => { clearTimeout(to); resolve(null); });
  });
}
function waitClose(res, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const to = setTimeout(() => resolve(false), timeoutMs);
    const done = () => { clearTimeout(to); resolve(true); };
    res.on('end', done);
    res.on('close', done);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const JSON_CT = { 'Content-Type': 'application/json' };
async function withServer(opts, fn) {
  const received = [];
  const state = { playersInitial: 9, playersRemaining: 7, reentryCount: 2, addOnCount: 1, specialCount: 0, tableName: 'テスト卓' };
  const handle = await server.start(Object.assign({
    getPin: () => '123456', port: 0, host: '127.0.0.1',
    onOp: (payload, op) => received.push({ payload, op }),
    getState: () => state
  }, opts || {}));
  try { await fn({ port: handle.port, received, handle, state }); }
  finally { await handle.close(); }
}
async function getToken(port, pin = '123456', extra = {}) {
  const r = await request(port, { urlPath: '/api/auth', headers: { ...JSON_CT, ...extra }, body: JSON.stringify({ pin }) });
  let token = null; try { token = JSON.parse(r.body).token || null; } catch (_) {}
  return { status: r.status, token, headers: r.headers };
}
function op(port, opName, token, extra = {}) {
  return request(port, { headers: { ...JSON_CT, Authorization: 'Bearer ' + token, ...extra }, body: JSON.stringify({ op: opName }) });
}

(async () => {
  // ===== トークン発行 / 検証 =====
  await test('1b: /api/auth 正 PIN → 200 + 64hex トークン', () => withServer(null, async ({ port }) => {
    const { status, token } = await getToken(port);
    assert.equal(status, 200);
    assert.match(token || '', /^[a-f0-9]{64}$/, 'トークンが 256bit hex でない');
  }));

  await test('1b: /api/auth 誤 PIN → 401 + トークンなし', () => withServer(null, async ({ port }) => {
    const { status, token } = await getToken(port, '000000');
    assert.equal(status, 401);
    assert.equal(token, null);
  }));

  await test('1b: 有効トークンで /api/op → 200 + onOp 発火', () => withServer(null, async ({ port, received }) => {
    const { token } = await getToken(port);
    const r = await op(port, 'startPause', token);
    assert.equal(r.status, 200);
    assert.equal(received.length, 1);
  }));

  await test('1b: トークンなしの /api/op → 401 + onOp 非発火', () => withServer(null, async ({ port, received }) => {
    const r = await request(port, { headers: JSON_CT, body: JSON.stringify({ op: 'startPause' }) });
    assert.equal(r.status, 401);
    assert.match(r.body, /bad-token/);
    assert.equal(received.length, 0);
  }));

  await test('1b: 不正トークンの /api/op → 401', () => withServer(null, async ({ port }) => {
    const r = await op(port, 'startPause', 'deadbeef'.repeat(8)); // 64hex だが未発行
    assert.equal(r.status, 401);
  }));

  await test('1b: PIN を /api/op に入れても通らない（PIN 撤去の証明）', () => withServer(null, async ({ port, received }) => {
    const r = await request(port, { headers: JSON_CT, body: JSON.stringify({ pin: '123456', op: 'startPause' }) });
    assert.equal(r.status, 401); // Authorization トークンが無いので 401
    assert.equal(received.length, 0);
  }));

  // ===== 失効 =====
  await test('1b: idle タイムアウトでトークン失効（/api/op → 401）', () => withServer({ tokenIdleMs: 60 }, async ({ port }) => {
    const { token } = await getToken(port);
    assert.equal((await op(port, 'startPause', token)).status, 200); // 直後は有効
    await sleep(120);
    assert.equal((await op(port, 'startPause', token)).status, 401); // idle 超過で失効
  }));

  await test('1b: close()（OFF 相当）で全トークン失効', () => withServer(null, async ({ port, handle }) => {
    const { token } = await getToken(port);
    await handle.close();
    // close 後は接続不可（サーバ停止）。再度 op は接続エラー → それ自体が「失効=到達不能」の担保。
    let errored = false;
    try { await op(port, 'startPause', token); } catch (_) { errored = true; }
    assert.ok(errored, 'close 後もサーバに到達できてしまう');
  }));

  // ===== レート制限にトークン失敗も含む =====
  await test('1b: トークン検証失敗もレート制限集計（11 回目 429）', () => withServer(null, async ({ port }) => {
    for (let i = 0; i < 10; i++) {
      const r = await op(port, 'startPause', 'bad'.repeat(21) + 'a'); // 64hex 相当の未発行
      assert.equal(r.status, 401, `${i} 回目 401`);
    }
    const last = await op(port, 'startPause', 'bad'.repeat(21) + 'a');
    assert.equal(last.status, 429);
  }));

  // ===== 状態 SSE =====
  await test('1b[SSE]: トークンなしの /api/events → 401', () => withServer(null, async ({ port }) => {
    const { status, res } = await openSSE(port, '');
    try { assert.equal(status, 401); } finally { res.destroy(); }
  }));

  await test('1b[SSE]: 有効トークン → 200 text/event-stream + 初期状態が届く', () => withServer(null, async ({ port }) => {
    const { token } = await getToken(port);
    const { status, headers, res } = await openSSE(port, token);
    try {
      assert.equal(status, 200);
      assert.match(String(headers['content-type'] || ''), /text\/event-stream/);
      const ev = await firstEvent(res);
      assert.ok(ev, 'SSE 初期イベントが届かない');
      const parsed = JSON.parse(ev);
      assert.equal(parsed.type, 'state');
      assert.equal(parsed.state.tableName, 'テスト卓');
      assert.equal(parsed.state.playersRemaining, 7);
    } finally { res.destroy(); }
  }));

  await test('1b[SSE]: cross-origin（Origin 不一致）の /api/events → 403', () => withServer(null, async ({ port }) => {
    const { token } = await getToken(port);
    const { status, res } = await openSSE(port, token, { Origin: 'http://evil.example.com' });
    try { assert.equal(status, 403); } finally { res.destroy(); }
  }));

  await test('1b[SSE]: pushState が接続中クライアントへ push される', () => withServer(null, async ({ port, handle }) => {
    const { token } = await getToken(port);
    const { res } = await openSSE(port, token);
    try {
      await firstEvent(res); // 初期状態を消費
      handle.pushState({ playersRemaining: 3, playersInitial: 9, reentryCount: 5, addOnCount: 0, specialCount: 1, tableName: '卓B' });
      const ev = await firstEvent(res);
      const parsed = JSON.parse(ev);
      assert.equal(parsed.state.reentryCount, 5);
      assert.equal(parsed.state.tableName, '卓B');
    } finally { res.destroy(); }
  }));

  await test('1b[SSE・条件3]: トークン失効時に開いている SSE ストリームも即 close', () => withServer({ tokenIdleMs: 60 }, async ({ port }) => {
    const { token } = await getToken(port);
    const { res } = await openSSE(port, token);
    await firstEvent(res);
    await sleep(120); // idle 超過
    // close 監視を sweep 発火より先に登録（op() 処理中に 'end' が先行発火して取り逃すのを防ぐ）。
    const closedP = waitClose(res, 1000);
    // 認証エンドポイント（gateFront 経由）へのリクエストで sweepIdleTokens が走り、
    // 当該トークンの SSE ストリームが即 close される（GET / は gateFront を通らないので op で発火）。
    await op(port, 'startPause', token);
    const closed = await closedP;
    assert.ok(closed, '失効しても SSE ストリームが閉じられない（条件3 違反）');
  }));

  // ===== 1a 認証7層が弱まっていない（3 エンドポイントに適用）=====
  await test('1b: 7層維持 — Host:evil.com は auth/op/events すべて 403', () => withServer(null, async ({ port }) => {
    const a = await request(port, { urlPath: '/api/auth', headers: { ...JSON_CT, Host: 'evil.com' }, body: '{}' });
    assert.equal(a.status, 403);
    const { token } = await getToken(port);
    const o = await op(port, 'startPause', token, { Host: 'evil.com' });
    assert.equal(o.status, 403);
    const e = await openSSE(port, token, { Host: 'evil.com' });
    try { assert.equal(e.status, 403); } finally { e.res.destroy(); }
  }));

  await test('1b: 7層維持 — /api/auth に Content-Type text/plain → 415・ACAO 非返却', () => withServer(null, async ({ port }) => {
    const r = await request(port, { urlPath: '/api/auth', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ pin: '123456' }) });
    assert.equal(r.status, 415);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  }));

  await test('1b: OPTIONS /api/auth → 405 かつ ACAO 非返却', () => withServer(null, async ({ port }) => {
    const r = await request(port, { method: 'OPTIONS', urlPath: '/api/auth', headers: {} });
    assert.equal(r.status, 405);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  }));

  // ===== 配線 / 後方互換（静的）=====
  await test('main.js: 状態橋渡しは読み取り専用（remote:state で _remoteState 更新・store 書込なし）', () => {
    assert.match(MAIN, /ipcMain\.on\(\s*['"]remote:state['"]/, 'remote:state ハンドラなし');
    // remote:state ハンドラ本体に store.set / setRuntime が無い（致命⑤ 非接触）
    const m = MAIN.match(/ipcMain\.on\(\s*['"]remote:state['"][\s\S]*?\}\);/);
    const block = m ? m[0] : '';
    assert.ok(block.length > 0, 'remote:state ブロック抽出失敗');
    assert.doesNotMatch(block, /store\.set|setRuntime|sanitizeRuntime/, 'remote:state が store 書込 / runtime 経路に触れている（致命⑤違反）');
  });

  await test('main.js: startRemoteServer に getState を渡す（SSE 初期状態・読み取り）', () => {
    assert.match(MAIN, /getState:\s*\(\)\s*=>\s*_remoteState/, 'getState 供給なし');
  });

  await test('preload.js: remote.publishState（読み取り送信・一方向 send）を公開', () => {
    assert.match(PRELOAD, /publishState\s*:\s*\(state\)\s*=>/, 'publishState 公開なし');
    assert.match(PRELOAD, /ipcRenderer\.send\(\s*['"]remote:state['"]/, "remote:state send なし");
  });

  await test('renderer.js: publishRemoteState は _remoteEnabled ゲート + hall 除外 + setRuntime を呼ばない（致命⑤）', () => {
    const m = RENDERER.match(/function publishRemoteState\(\)\s*\{[\s\S]*?\n\}/);
    const block = m ? m[0] : '';
    assert.ok(block.length > 0, 'publishRemoteState 抽出失敗');
    assert.match(block, /_remoteEnabled/, 'OFF ゲートなし（後方互換）');
    assert.match(block, /appRole\s*===\s*['"]hall['"]/, 'hall 除外なし');
    assert.doesNotMatch(block, /setRuntime\s*\(/, 'publishRemoteState が setRuntime を呼ぶ（致命⑤違反）');
  });

  await test('server.js: store / fs 書込を新設していない（SSE 読み取り専用）', () => {
    assert.doesNotMatch(SERVERSRC, /electron-store|writeFileSync|writeFile\(/, 'server が永続化書込を持つ');
  });

  await test('後方互換: 本体 CSP（script-src \'self\'）無改変 / phone.html は EventSource 不使用（案A）', () => {
    assert.match(INDEXHTML, /Content-Security-Policy[^>]*script-src 'self'/, 'CSP 改変');
    assert.doesNotMatch(PHONE, /new EventSource/, 'phone.html が EventSource を使っている（案A=fetch streaming のはず）');
    assert.match(PHONE, /Authorization['"]?\s*:\s*['"]Bearer /, 'phone.html が Authorization ヘッダを使っていない');
  });

  await test('後方互換: 既存 hall:forwarded-key 経路・配線点② が無改変で存在', () => {
    assert.match(RENDERER, /window\.appRole\s*===\s*['"]operator['"][\s\S]{0,120}onHallForwardedKey/, '既存 operator 限定経路が消えた');
    assert.match(RENDERER, /appRole\s*===\s*['"]operator-solo['"][\s\S]{0,160}onRemoteOp/, '配線点② が消えた');
  });

  // ============================================================
  console.log(`\n=== remote-control Phase 1b: ${pass} passed / ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.error('FATAL:', err); process.exit(1); });
