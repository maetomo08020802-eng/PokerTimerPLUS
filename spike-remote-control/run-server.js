'use strict';
// remote-control Phase 0 スパイク — 常駐起動スクリプト（6-B の実機テスト / live curl 用）。
//
// 実行: node spike-remote-control/run-server.js [PIN] [PORT]
//   例: node spike-remote-control/run-server.js 4831 8080
// 起動すると、スマホで開くべき URL を print する（Phase 1 ではこの URL を QR 化してアプリ画面に表示）。
// Phase 0 は疎通確認用。onOp はコンソールにログするだけ（実アプリ注入は Phase 1 の renderer 配線）。

const { start } = require('./server');
const { primaryLanIPv4, lanIPv4s } = require('./discover');

const PIN = process.argv[2] || '4831';
const PORT = Number(process.argv[3] || 8080);

(async () => {
  const { port } = await start({
    pin: PIN,
    port: PORT,
    host: '0.0.0.0',
    onOp: (payload, op) => console.log(`[op] ${op} -> ${JSON.stringify(payload)}`)
  });
  const lan = primaryLanIPv4();
  console.log('=== remote-control Phase 0 spike server ===');
  console.log('検出した LAN IPv4:', JSON.stringify(lanIPv4s()));
  console.log('PIN:', PIN);
  if (lan) {
    console.log(`\nスマホの同じ Wi-Fi のブラウザで開く:  http://${lan.address}:${port}\n`);
  } else {
    console.log(`\nLAN IP 未検出。localhost: http://127.0.0.1:${port}\n`);
  }
  console.log('(Ctrl+C で停止)');
})().catch((e) => { console.error('起動失敗:', e && e.message); process.exit(1); });
