/**
 * remote-control Phase 1a — 認証コア + トランスポート常設 + 配線 + 後方互換のテスト
 *
 * 対象:
 *   - src/remote/op-map.js（全 17 操作写像 + DANGEROUS）
 *   - src/remote/server.js（認証境界 7 層 + plan_review 追加条件 1・2）
 *   - src/remote/discover.js（LAN IPv4）
 *   - 配線点①（main.js の remote:op send）/ 配線点②（renderer.js の operator-solo 受信リスナー）
 *   - 後方互換（サーバ OFF 既定・既存 hall:forwarded-key 無改変・CSP 無改変・追加ライブラリなし）
 *
 * 実行: node tests/remote-control.test.js
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
const INDEXHTML = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const PKG       = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');

const opMap  = require('../src/remote/op-map');
const server = require('../src/remote/server');
const discover = require('../src/remote/discover');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err && err.message); fail++; }
}

// HTTP クライアント（Host / Origin / Content-Type を明示指定できる）。
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

// テスト用サーバを 127.0.0.1 に立て、コールバックに { port, received } を渡し、必ず close する。
//   host='127.0.0.1'（テストではファイアウォールプロンプト回避。本番は 0.0.0.0＝静的テストで確認）。
//   rateMap は start() クロージャ内なので withServer 毎に新品＝レート制限テストが他へ漏れない。
async function withServer(pin, fn) {
  const received = [];
  const handle = await server.start({
    getPin: () => pin,
    port: 0,
    host: '127.0.0.1',
    onOp: (payload, op) => received.push({ payload, op })
  });
  try {
    await fn({ port: handle.port, received });
  } finally {
    await handle.close();
  }
}

const JSON_CT = { 'Content-Type': 'application/json' };
function validOp(port, op, pin = '123456', extra = {}) {
  return request(port, { headers: { ...JSON_CT, ...extra }, body: JSON.stringify({ pin, op }) });
}

(async () => {
  // ============================================================
  // op-map（写像・Phase 0 一致）
  // ============================================================
  await test('op-map: 全 17 操作が toForwardedKey で写像可能', () => {
    const ops = Object.keys(opMap.OPS);
    assert.equal(ops.length, 17, `操作数が 17 でない（=${ops.length}）`);
    assert.ok(ops.every((o) => opMap.toForwardedKey(o) !== null), '写像不能な op がある');
  });

  await test('op-map: DANGEROUS 集合が期待 5 件と完全一致', () => {
    const expected = ['resetDialog', 'reentryMinus', 'addOnMinus', 'specialMinus', 'entryCancel'].sort();
    const actual = [...opMap.DANGEROUS].sort();
    assert.deepEqual(actual, expected);
  });

  await test('op-map: 代表写像が Phase 0 スパイクと一致（reentry±/addOn/entryAdd/startPause）', () => {
    assert.deepEqual(opMap.toForwardedKey('reentryPlus'),  { code: 'KeyR', key: '', control: true, shift: false, alt: false, meta: false });
    assert.deepEqual(opMap.toForwardedKey('reentryMinus'), { code: 'KeyR', key: '', control: true, shift: true,  alt: false, meta: false });
    assert.deepEqual(opMap.toForwardedKey('addOnPlus'),    { code: 'KeyA', key: '', control: true, shift: false, alt: false, meta: false });
    assert.deepEqual(opMap.toForwardedKey('entryAdd'),     { code: 'ArrowUp', key: '', control: false, shift: false, alt: false, meta: false });
    assert.deepEqual(opMap.toForwardedKey('startPause'),   { code: 'Space', key: '', control: false, shift: false, alt: false, meta: false });
  });

  await test('op-map: 未知 op は null（ホワイトリスト外を破棄）', () => {
    assert.equal(opMap.toForwardedKey('definitely-not-an-op'), null);
    assert.equal(opMap.toForwardedKey(''), null);
    assert.equal(opMap.toForwardedKey(undefined), null);
  });

  // ============================================================
  // discover（LAN IPv4）
  // ============================================================
  await test('discover: lanIPv4s は配列・primaryLanIPv4 は null か {address}', () => {
    const all = discover.lanIPv4s();
    assert.ok(Array.isArray(all), '配列でない');
    const p = discover.primaryLanIPv4();
    assert.ok(p === null || typeof p.address === 'string', 'primary が null / {address} でない');
  });

  // ============================================================
  // server: 正常系 + 認証境界（動的 http）
  // ============================================================
  await test('server: GET / が phone.html を返す（200/HTML/操作ボタン含む）', () => withServer('123456', async ({ port }) => {
    const g = await request(port, { method: 'GET', urlPath: '/', headers: {} });
    assert.equal(g.status, 200);
    assert.match(g.body, /リモコン/);
    assert.match(g.body, /data-op="reentryPlus"/);
  }));

  await test('server: 正常 POST（json+正PIN）→ 200 + onOp 発火 + 正写像', () => withServer('123456', async ({ port, received }) => {
    const r = await validOp(port, 'reentryPlus');
    const j = JSON.parse(r.body);
    assert.equal(r.status, 200);
    assert.equal(j.ok, true);
    assert.equal(received.length, 1);
    assert.equal(received[0].payload.code, 'KeyR');
    assert.equal(received[0].payload.control, true);
    assert.equal(received[0].payload.shift, false);
  }));

  await test('server: PIN 不一致 → 401 + onOp 非発火', () => withServer('123456', async ({ port, received }) => {
    const r = await validOp(port, 'reentryPlus', '000000');
    assert.equal(r.status, 401);
    assert.equal(received.length, 0);
  }));

  await test('server: 未知 op → 400 で破棄', () => withServer('123456', async ({ port, received }) => {
    const r = await validOp(port, 'definitely-not-an-op');
    assert.equal(r.status, 400);
    assert.equal(received.length, 0);
  }));

  await test('server: 壊れた JSON → 400', () => withServer('123456', async ({ port }) => {
    const r = await request(port, { headers: JSON_CT, body: '{not json' });
    assert.equal(r.status, 400);
  }));

  // ---- 層2: Content-Type=application/json 必須（cross-origin simple request 封じ）----
  await test('server[層2]: Content-Type が text/plain → 415', () => withServer('123456', async ({ port, received }) => {
    const r = await request(port, { headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ pin: '123456', op: 'startPause' }) });
    assert.equal(r.status, 415);
    assert.equal(received.length, 0);
  }));

  // ---- 追加条件1: OPTIONS(preflight) に ACAO を返さない / どのレスポンスにも ACAO 無し ----
  await test('server[条件1]: OPTIONS /api/op → 405 かつ Access-Control-Allow-Origin ヘッダ無し', () => withServer('123456', async ({ port }) => {
    const r = await request(port, { method: 'OPTIONS', urlPath: '/api/op', headers: {} });
    assert.equal(r.status, 405);
    assert.equal(r.headers['access-control-allow-origin'], undefined, 'preflight に ACAO を返している（層2 が崩れる）');
  }));

  await test('server[条件1]: 正常 200 レスポンスにも Access-Control-Allow-Origin ヘッダが無い', () => withServer('123456', async ({ port }) => {
    const r = await validOp(port, 'startPause');
    assert.equal(r.status, 200);
    assert.equal(r.headers['access-control-allow-origin'], undefined, '200 応答に ACAO が付いている');
  }));

  // ---- 層4: Origin/Referer 検証（cross-origin 拒否）----
  await test('server[層4]: cross-origin（Origin 不一致）→ 403 bad-origin', () => withServer('123456', async ({ port, received }) => {
    const r = await validOp(port, 'startPause', '123456', { 'Origin': 'http://evil.example.com' });
    assert.equal(r.status, 403);
    assert.match(r.body, /bad-origin/);
    assert.equal(received.length, 0);
  }));

  await test('server[層4]: 同一オリジン（Origin==Host）→ 200 許可', () => withServer('123456', async ({ port, received }) => {
    const host = `192.168.1.5:${port}`;
    const r = await validOp(port, 'startPause', '123456', { 'Host': host, 'Origin': `http://${host}` });
    assert.equal(r.status, 200);
    assert.equal(received.length, 1);
  }));

  // ---- 層3 + 追加条件2: Host allowlist 厳格アンカー（DNS リバインディング / サブドメイン偽装防御）----
  await test('server[層3]: Host: evil.com → 403 bad-host', () => withServer('123456', async ({ port, received }) => {
    const r = await validOp(port, 'startPause', '123456', { 'Host': 'evil.com' });
    assert.equal(r.status, 403);
    assert.match(r.body, /bad-host/);
    assert.equal(received.length, 0);
  }));

  await test('server[条件2]: Host: 192.168.1.5.evil.com（サブドメイン偽装）→ 403 bad-host', () => withServer('123456', async ({ port, received }) => {
    const r = await validOp(port, 'startPause', '123456', { 'Host': '192.168.1.5.evil.com' });
    assert.equal(r.status, 403);
    assert.match(r.body, /bad-host/);
    assert.equal(received.length, 0);
  }));

  await test('server[条件2]: isAllowedHostname が部分一致を許さない（アンカー厳格）', () => {
    assert.equal(server.isAllowedHostname('192.168.1.5'), true);
    assert.equal(server.isAllowedHostname('10.0.0.1'), true);
    assert.equal(server.isAllowedHostname('172.16.0.1'), true);
    assert.equal(server.isAllowedHostname('127.0.0.1'), true);
    assert.equal(server.isAllowedHostname('localhost'), true);
    assert.equal(server.isAllowedHostname('192.168.1.5.evil.com'), false);
    assert.equal(server.isAllowedHostname('evil192.168.1.5'), false);
    assert.equal(server.isAllowedHostname('172.15.0.1'), false); // 172.16-31 の範囲外
    assert.equal(server.isAllowedHostname('11.0.0.1'), false);
    assert.equal(server.isAllowedHostname('evil.com'), false);
  });

  // ---- 層5: 過大ボディ ----
  await test('server[層5]: 過大ボディ（>4KB）→ 413', () => withServer('123456', async ({ port, received }) => {
    const big = 'x'.repeat(5000);
    const r = await request(port, { headers: JSON_CT, body: JSON.stringify({ pin: '123456', op: 'startPause', pad: big }) });
    assert.equal(r.status, 413);
    assert.equal(received.length, 0);
  }));

  // ---- 層7: レート制限（PIN 総当り防止）----
  await test('server[層7]: PIN 連続失敗でロック（11 回目は 429）', () => withServer('123456', async ({ port }) => {
    let last = null;
    for (let i = 0; i < 10; i++) {
      const r = await validOp(port, 'startPause', '999999');
      assert.equal(r.status, 401, `${i} 回目は 401 のはず`);
    }
    last = await validOp(port, 'startPause', '999999'); // 11 回目
    assert.equal(last.status, 429, 'ロック後は 429 のはず');
    // 正しい PIN でもロック中は 429（総当りコスト増）
    const still = await validOp(port, 'startPause', '123456');
    assert.equal(still.status, 429, 'ロック中は正 PIN でも 429');
  }));

  // ---- 層6: PIN 定数時間比較（推奨条件3）----
  await test('server[層6]: pinEqual は長さ不一致 false / 同一 true（定数時間比較）', () => {
    assert.equal(server.pinEqual('123456', '123456'), true);
    assert.equal(server.pinEqual('123456', '12345'), false);
    assert.equal(server.pinEqual('123456', '654321'), false);
    assert.equal(server.pinEqual('', ''), true);
  });

  // ============================================================
  // 配線点①（main.js）+ store default + 0.0.0.0 バインド
  // ============================================================
  await test('main.js: store default に remoteControl.enabled=false（既定 OFF）', () => {
    assert.match(MAIN, /remoteControl:\s*\{\s*enabled:\s*false\s*\}/, 'remoteControl 既定 OFF が無い');
  });

  await test('main.js: 配線点① onOp → webContents.send("remote:op", payload)', () => {
    assert.match(MAIN, /webContents\.send\(\s*['"]remote:op['"]\s*,\s*payload\s*\)/, 'remote:op 送信が無い');
  });

  await test('main.js: サーバは host="0.0.0.0" で LAN バインド', () => {
    assert.match(MAIN, /host:\s*['"]0\.0\.0\.0['"]/, '0.0.0.0 バインドが無い');
  });

  await test('main.js: 起動は remoteControl.enabled===true の時だけ startRemoteServer', () => {
    assert.match(MAIN, /remoteControl['"]?\)\s*\|\|\s*\{\}\)\.enabled\s*===\s*true[\s\S]{0,120}startRemoteServer\(\)/,
      'enabled===true ガード内の startRemoteServer 呼出が無い（後方互換の要）');
  });

  await test('main.js: remote:* IPC（getStatus / setEnabled）を登録', () => {
    assert.match(MAIN, /ipcMain\.handle\(\s*['"]remote:getStatus['"]/, 'remote:getStatus 未登録');
    assert.match(MAIN, /ipcMain\.handle\(\s*['"]remote:setEnabled['"]/, 'remote:setEnabled 未登録');
  });

  // ============================================================
  // 配線点②（preload / renderer）+ 既存経路無改変
  // ============================================================
  await test('preload.js: remote.onRemoteOp / getStatus / setEnabled を公開', () => {
    assert.match(PRELOAD, /onRemoteOp\s*:\s*\(/, 'onRemoteOp 公開なし');
    assert.match(PRELOAD, /ipcRenderer\.on\(\s*['"]remote:op['"]/, "ipcRenderer.on('remote:op') なし");
    assert.match(PRELOAD, /getStatus\s*:\s*\(\)\s*=>\s*_measuredInvoke\(\s*['"]remote:getStatus['"]/, 'getStatus なし');
    assert.match(PRELOAD, /setEnabled\s*:\s*\([^)]*\)\s*=>\s*_measuredInvoke\(\s*['"]remote:setEnabled['"]/, 'setEnabled なし');
  });

  await test('preload.js: 既存 dual.onHallForwardedKey が無改変で温存', () => {
    assert.match(PRELOAD, /onHallForwardedKey\s*:\s*\(callback\)\s*=>/, '既存 onHallForwardedKey が消えている');
    assert.match(PRELOAD, /ipcRenderer\.on\(\s*['"]hall:forwarded-key['"]/, '既存 hall:forwarded-key listen が消えている');
  });

  await test('renderer.js[配線点②]: remote:op は operator-solo でも受信し dispatchClockShortcut を呼ぶ', () => {
    // operator-solo / operator 双方受信の条件 + onRemoteOp + dispatchClockShortcut
    assert.match(RENDERER, /appRole\s*===\s*['"]operator-solo['"][\s\S]{0,120}onRemoteOp/,
      'operator-solo 受信条件 + onRemoteOp が無い');
    assert.match(RENDERER, /onRemoteOp[\s\S]{0,400}dispatchClockShortcut\s*\(/,
      'onRemoteOp コールバックで dispatchClockShortcut を呼んでいない');
  });

  await test('renderer.js: 既存 hall:forwarded-key ブロック（operator 限定）が無改変で存在', () => {
    assert.match(RENDERER, /window\.appRole\s*===\s*['"]operator['"][\s\S]{0,120}onHallForwardedKey/,
      '既存 operator 限定 onHallForwardedKey ブロックが消えている（無改変であるべき）');
  });

  await test('致命バグ保護⑤: renderer.js の remote:op リスナーは setRuntime を直接呼ばない（dispatchClockShortcut のみ）', () => {
    // remote:op リスナーブロックを抽出し、その中に setRuntime / api.tournaments.setRuntime 直呼びが無いことを確認。
    const m = RENDERER.match(/onRemoteOp\?\.\(\(data\)[\s\S]*?\}\);\s*\)?\s*\}/);
    const block = m ? m[0] : '';
    assert.ok(block.length > 0, 'remote:op リスナーブロックが抽出できない');
    assert.doesNotMatch(block, /setRuntime\s*\(/, 'remote:op リスナーが setRuntime を直接呼んでいる（致命保護⑤違反）');
  });

  // ============================================================
  // 後方互換 / 非機能（CSP 無改変・追加ライブラリなし・UI）
  // ============================================================
  await test('index.html: 本体 CSP（script-src \'self\'）が無改変', () => {
    assert.match(INDEXHTML, /Content-Security-Policy[^>]*script-src 'self'/, 'CSP の script-src \'self\' が無い / 変更された');
  });

  await test('index.html: 設定タブ data-tab="remote" + トグル js-remote-enabled が存在', () => {
    assert.match(INDEXHTML, /data-tab="remote"/, 'remote タブが無い');
    assert.match(INDEXHTML, /id="js-remote-enabled"/, 'トグル js-remote-enabled が無い');
    assert.match(INDEXHTML, /id="js-remote-url"/, 'URL 表示欄が無い');
    assert.match(INDEXHTML, /id="js-remote-pin"/, 'PIN 表示欄が無い');
  });

  await test('src/remote/*: 追加ライブラリなし（Node 標準 + ./op-map のみ require）', () => {
    for (const f of ['server.js', 'discover.js', 'op-map.js']) {
      const src = fs.readFileSync(path.join(ROOT, 'src', 'remote', f), 'utf8');
      const reqs = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((x) => x[1]);
      for (const r of reqs) {
        const ok = ['http', 'fs', 'path', 'crypto', 'os'].includes(r) || r.startsWith('./');
        assert.ok(ok, `${f} が非標準ライブラリを require: ${r}`);
      }
    }
  });

  await test('package.json: dependencies に remote 用の新規外部依存を追加していない', () => {
    const pkg = JSON.parse(PKG);
    const deps = Object.keys(pkg.dependencies || {});
    // 既知の依存のみ（electron-store / electron-updater / electron-log 等）。qrcode 等の新規追加が無いこと。
    for (const forbidden of ['qrcode', 'express', 'ws', 'socket.io', 'cors', 'body-parser']) {
      assert.ok(!deps.includes(forbidden), `不要な外部依存が追加されている: ${forbidden}`);
    }
  });

  // ============================================================
  console.log(`\n=== remote-control Phase 1a: ${pass} passed / ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.error('FATAL:', err); process.exit(1); });
