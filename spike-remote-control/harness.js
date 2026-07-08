'use strict';
// remote-control Phase 0 スパイク — 自走検証ハーネス（本体 npm test には組み込まない）。
//
// 実行: node spike-remote-control/harness.js
// 何を実証するか（DoD ①②④の CC 自走分）:
//   - サーバが LAN バインドで立ち、【localhost ではなく実 LAN IP 経由】で到達できる（=別端末相当）
//   - POST /api/op が PIN を検証する（不一致は 401・操作は届かない）
//   - 操作名が hall:forwarded-key と同型の eventLike payload に正しく写像される
//   - 未知 op は 400 で破棄される
//   - 全操作（op-map の全キー）が写像可能＝「全操作リモート化」の土台が揃っている
// アプリ renderer への実注入は Phase 1（operator-solo 受信リスナー）＋実機(6-B)。

const http = require('http');
const { start } = require('./server');
const { lanIPv4s, primaryLanIPv4 } = require('./discover');
const { OPS, toForwardedKey } = require('./op-map');

function post(host, port, urlPath, obj) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(obj));
    const req = http.request(
      { host, port, path: urlPath, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d })); }
    );
    req.on('error', reject);
    req.write(body); req.end();
  });
}
function get(host, port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path: urlPath, method: 'GET' }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject); req.end();
  });
}

(async () => {
  let pass = 0, fail = 0;
  const t = (name, cond) => { if (cond) { console.log('PASS:', name); pass++; } else { console.log('FAIL:', name); fail++; } };

  const received = [];
  const PIN = '4831';
  const { port, close } = await start({ pin: PIN, port: 0, host: '0.0.0.0', onOp: (payload, op) => received.push({ op, payload }) });

  const ips = lanIPv4s();
  const lan = primaryLanIPv4();
  const host = lan ? lan.address : '127.0.0.1'; // 実 LAN IP 経由で叩く（別端末相当）
  console.log(`\n[検証環境] LAN IPv4 検出=${JSON.stringify(ips)}  使用host=${host}  port=${port}\n`);

  // ② IP 発見（依存ゼロ）
  t('② LAN IPv4 を依存ゼロ(os)で取得できた', ips.length >= 1 && !!lan);

  // GET / が操作ページを返す
  const g = await get(host, port, '/');
  t('GET / が phone.html を返す(200/HTML)', g.status === 200 && /リモコン/.test(g.body) && /data-op="reentryPlus"/.test(g.body));

  // ①/④ LAN IP 経由で POST → 200 + 写像
  const r1 = await post(host, port, '/api/op', { pin: PIN, op: 'reentryPlus' });
  const j1 = JSON.parse(r1.body);
  t('④ LAN IP 経由で 200 + ok（=別端末から到達＆バインド成立）', r1.status === 200 && j1.ok === true);
  t('① reentryPlus が {code:KeyR, control:true, shift:false} に写像', received.length === 1 &&
    received[0].payload.code === 'KeyR' && received[0].payload.control === true && received[0].payload.shift === false);

  // PIN 認証
  const before = received.length;
  const r2 = await post(host, port, '/api/op', { pin: 'xxxx', op: 'reentryPlus' });
  t('PIN 不一致は 401', r2.status === 401);
  t('PIN 不一致で操作は届かない（onOp 非発火）', received.length === before);

  // 未知 op
  const r3 = await post(host, port, '/api/op', { pin: PIN, op: 'definitely-not-an-op' });
  t('未知 op は 400 で破棄', r3.status === 400);

  // bad json
  const badReq = await (async () => {
    const body = Buffer.from('{not json');
    return new Promise((resolve) => {
      const req = http.request({ host, port, path: '/api/op', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } },
        (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode })); });
      req.write(body); req.end();
    });
  })();
  t('壊れた JSON は 400', badReq.status === 400);

  // 全操作の写像可能性（全操作リモート化の土台）
  const allOps = Object.keys(OPS);
  t(`全操作(${allOps.length}種)が写像可能`, allOps.every((o) => toForwardedKey(o) !== null));

  // 危険操作代表: reentryMinus は shift 付き（PC の Ctrl+Shift+R と一致）
  const rm = toForwardedKey('reentryMinus');
  t('reentryMinus = KeyR+ctrl+shift（PC の -1 と一致）', rm.code === 'KeyR' && rm.control === true && rm.shift === true);

  await close();
  console.log(`\nLAN=${host}:${port}  ops=${allOps.length}  === ${pass} passed / ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.error('FATAL:', err); process.exit(1); });
