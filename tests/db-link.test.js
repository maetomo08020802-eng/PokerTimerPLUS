'use strict';

/**
 * 外部DB連携 STEP2a: 接続基盤の静的検査（既存 tests/remote-control.test.js と同じソース静的解析方式）。
 *
 * 検査対象（plan §5-2 + plan review 指摘B）:
 *   ① 既定=未設定（store defaults の dbLink が url/anonKey 空・links 空）＝外部接続ゼロ
 *   ② CSP 無改変（全4 HTML が現行の CSP 文字列と完全一致）
 *   ③ supabase-js は main 側モジュール(src/link/db-link.js)のみが require（renderer/preload に無い）
 *   ④ PW・トークンの非保存/非ログ出力（store.set 行と log 呼出に秘匿値が現れない）
 *   ⑤ preload の公開が whitelist 6 チャネルのみ
 *   ⑥ 連携チェック既定 OFF（checkbox に checked 属性なし）+ 4分割(multi)系ファイル非接触
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let count = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  count++;
}

const mainSrc = read('src/main.js');
const preloadSrc = read('src/preload.js');
const rendererSrc = read('src/renderer/renderer.js');
const dbLinkSrc = read('src/link/db-link.js');
const indexHtml = read('src/renderer/index.html');

// ---- ① 既定=未設定（外部接続ゼロ） ----
ok(/dbLink:\s*\{\s*url:\s*''\s*,\s*anonKey:\s*''\s*,\s*links:\s*\{\}\s*\}/.test(mainSrc),
  'store defaults の dbLink が url/anonKey 空・links 空（既定=未設定）');
ok(dbLinkSrc.includes("url.startsWith('https://') && anonKey.length > 0"),
  '未設定（url/anonKey 空）では configured=false（クライアントを作らない）');
ok(dbLinkSrc.includes("require('@supabase/supabase-js')") &&
   /function _getClient\(\)\s*\{\s*\n\s*if \(!_configured\(\)\) return null;/.test(dbLinkSrc),
  'supabase-js は設定済みの時だけ遅延 require（未設定はロードすらしない）');

// ---- ② CSP 無改変（v2.8.0 時点の文字列と完全一致） ----
const EXPECTED_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; script-src 'self'; connect-src 'self' file:";
for (const html of [
  'src/renderer/index.html',
  'src/renderer/display-picker.html',
  'src/renderer/multi/multi-control.html',
  'src/renderer/multi/multi-grid.html'
]) {
  ok(read(html).includes(EXPECTED_CSP), `${html} の CSP が無改変`);
}

// ---- ③ supabase-js は main 集約（renderer/preload から参照しない） ----
ok(!rendererSrc.includes('@supabase'), 'renderer.js に supabase-js の参照が無い（main 集約）');
ok(!preloadSrc.includes('@supabase'), 'preload.js に supabase-js の参照が無い（main 集約）');
for (const f of ['src/renderer/multi/multi-control.js', 'src/renderer/multi/multi-grid.js', 'src/renderer/multi/multi-engine.mjs']) {
  ok(!read(f).includes('@supabase', ), `${f} に supabase-js の参照が無い（multi 系は連携非対応）`);
}
ok(dbLinkSrc.includes("require('@supabase/supabase-js')"), 'supabase-js の require は src/link/db-link.js にある');

// ---- ④ PW・トークンの非保存 / 非ログ出力（plan review 指摘B: トークンにも拡張） ----
// store.set / sessionStore.set の行に password が現れない（セッション JSON は supabase-js の
// storage adapter 経由でキー名固定・値は関与しない）。
const setLines = dbLinkSrc.split('\n').filter((l) => l.includes('.set('));
for (const l of setLines) {
  ok(!/password/i.test(l), `store 書込行に password が無い: ${l.trim()}`);
}
// ログ呼出（_log(...)）はイベント名リテラルのみ（変数・テンプレートを渡さない=秘匿値が構造的に漏れない）
const logCalls = dbLinkSrc.match(/_log\(([^)]*)\)/g) || [];
ok(logCalls.length > 0, '_log 呼出が存在する');
for (const call of logCalls) {
  ok(/^_log\('[a-z:-]+'\)$/.test(call), `ログはイベント名リテラルのみ: ${call}`);
}
// token / session / password を console.* に出さない
ok(!/console\.(log|error|warn|info)\([^)]*(token|password|session)/i.test(dbLinkSrc),
  'db-link.js は token/password/session を console 出力しない');
// renderer は PW を保存・保持しない（欄の値は login 呼出に渡すだけ + 呼出後クリア）
ok(rendererSrc.includes('if (pwEl) pwEl.value = \'\';'), 'renderer はログイン試行後に PW 欄をクリア');
ok(!/localStorage/.test(rendererSrc.split('js-dblink')[1] || ''), 'dblink UI 周辺で localStorage を使わない');

// ---- ⑤ preload whitelist（dblink は 6 チャネルのみ） ----
const dblinkBlock = preloadSrc.slice(preloadSrc.indexOf('dblink: {'));
const invoked = [...dblinkBlock.matchAll(/_measuredInvoke\('(dblink:[a-zA-Z]+)'/g)].map((m) => m[1]);
const WHITELIST = [
  'dblink:getStatus',
  'dblink:setConfig',
  'dblink:login',
  'dblink:logout',
  'dblink:listTodayTournaments',
  'dblink:setTournamentLink'
];
ok(invoked.length === WHITELIST.length && WHITELIST.every((c) => invoked.includes(c)),
  `preload の dblink 公開が whitelist 6 チャネルと一致（実際: ${invoked.join(',')}）`);
// main 側の handler 登録も同じ 6 チャネル
for (const ch of WHITELIST) {
  ok(mainSrc.includes(`ipcMain.handle('${ch}'`), `main に ${ch} の handler がある`);
}

// ---- ⑥ 連携チェック既定 OFF + multi 非接触 + tournaments 配列に持たせない ----
const checkboxLine = indexHtml.split('\n').find((l) => l.includes('js-dblink-link-enabled')) || '';
ok(checkboxLine.includes('type="checkbox"') && !checkboxLine.includes(' checked'),
  '連携チェックは既定 OFF（checked 属性なし）');
ok(!read('src/renderer/multi/multi-control.html').includes('dblink') &&
   !read('src/renderer/multi/multi-grid.html').includes('dblink'),
  '4分割(multi)系 HTML に連携 UI が無い（連携非対応）');
// normalizeTournament(tournaments 配列の検証関数)に dbLink 系キーを足していない=隔離保存の証明
// （関数定義の本体だけを切り出して検査する。近傍一致では別関数の dbLink に誤反応するため）
const normStart = mainSrc.indexOf('function normalizeTournament');
ok(normStart >= 0, 'normalizeTournament の定義が存在する');
const normEnd = mainSrc.indexOf('\nfunction ', normStart + 1);
const normBody = mainSrc.slice(normStart, normEnd > normStart ? normEnd : normStart + 8000);
ok(!/dbLink/i.test(normBody),
  'normalizeTournament 本体は dbLink 系キーに非接触（フラグは dbLink.links に隔離保存）');

// ---- 接続テストの SELECT が非機微 5 列のみ ----
ok(dbLinkSrc.includes("select('id, name, part_label, business_date, status')"),
  '当日大会一覧の SELECT は非機微 5 列のみ（金額・PII 列を選ばない）');

console.log(`db-link.test.js: ${count} assertions passed`);
