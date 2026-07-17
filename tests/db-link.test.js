'use strict';

/**
 * 外部DB連携 STEP2-K1: 店舗キー方式の検査（静的解析 + fetch 注入の純ロジック・実ネットワークなし）。
 *
 * 静的検査（K1 plan §2-E）:
 *   ① 既定=未設定（store defaults の dbLink が url/storeKey 空・links 空）＝外部接続ゼロ
 *   ② CSP 無改変（全4 HTML が現行の CSP 文字列と完全一致）
 *   ③ `@supabase` 参照が src 全体+package.json に存在しない（supabase-js 撤去・追加ライブラリゼロ復帰）
 *   ④ 店舗キーの非ログ出力（_log はイベント名リテラルのみ・console に key/token を出さない）
 *   ⑤ preload の公開が whitelist 4 チャネルのみ（login/logout 撤去）= main handler と一致
 *   ⑥ 連携チェック既定 OFF + 4分割(multi)系ファイル非接触 + normalizeTournament 非接触
 *   ⑦ fetch 先が `/api/pc-timer` のみ・`Authorization: Bearer` 付与・https:// 強制
 *   ⑧ 旧セッションファイル(db-link-session.json)への書込コードが無い（削除のみ）・business-date.js 撤去済
 *
 * 純ロジック検査（fetch 注入・plan review 追加指示3）:
 *   Bearer ヘッダ / プレーン404→設定不備の日本語 / JSON エラー本文の透過 / ネットワーク例外の写像 /
 *   URL 末尾スラッシュ正規化 / setConfig 検証と anonKey 自然クリーニング / 対応表1行の ON/OFF
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
const packageJson = read('package.json');

// ---- ① 既定=未設定（外部接続ゼロ） ----
ok(/dbLink:\s*\{\s*url:\s*''\s*,\s*storeKey:\s*''\s*,\s*links:\s*\{\}\s*\}/.test(mainSrc),
  'store defaults の dbLink が url/storeKey 空・links 空（既定=未設定）');
ok(dbLinkSrc.includes("url.startsWith('https://') && storeKey.length > 0"),
  '未設定（url/storeKey 空）では configured=false（外部接続しない）');
ok(dbLinkSrc.includes("code: 'not_configured'"),
  '_request は未設定時に fetch せず即エラー返却（inert）');

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

// ---- ③ supabase-js 撤去（src 全体 + package.json に参照ゼロ・追加ライブラリゼロ復帰） ----
function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|html)$/.test(name)) out.push(p);
  }
  return out;
}
for (const f of walk(path.join(root, 'src'), [])) {
  ok(!fs.readFileSync(f, 'utf8').includes('@supabase'),
    `${path.relative(root, f)} に supabase-js の参照が無い（撤去済）`);
}
ok(!packageJson.includes('@supabase'), 'package.json に supabase-js 依存が無い（追加ライブラリゼロ復帰）');

// ---- ④ 店舗キーの非ログ出力 ----
const logCalls = dbLinkSrc.match(/_log\(([^)]*)\)/g) || [];
ok(logCalls.length > 0, '_log 呼出が存在する');
for (const call of logCalls) {
  if (call === '_log(res.ok ? \'dblink:list-ok\' : \'dblink:list-failed\')') { count++; continue; }
  ok(/^_log\('[a-z:-]+'\)$/.test(call), `ログはイベント名リテラルのみ: ${call}`);
}
ok(!/console\.(log|error|warn|info)/.test(dbLinkSrc),
  'db-link.js は console 出力を一切しない（storeKey が構造的に漏れない）');
ok(rendererSrc.includes("if (keyEl) keyEl.value = '';"),
  'renderer は店舗キー保存後に入力欄をクリア（画面に残さない）');

// ---- ⑤ preload whitelist（dblink は 4 チャネルのみ・login/logout 撤去） ----
const dblinkBlock = preloadSrc.slice(preloadSrc.indexOf('dblink: {'));
const invoked = [...dblinkBlock.matchAll(/_measuredInvoke\('(dblink:[a-zA-Z]+)'/g)].map((m) => m[1]);
const WHITELIST = [
  'dblink:getStatus',
  'dblink:setConfig',
  'dblink:listTodayTournaments',
  'dblink:setTournamentLink'
];
ok(invoked.length === WHITELIST.length && WHITELIST.every((c) => invoked.includes(c)),
  `preload の dblink 公開が whitelist 4 チャネルと一致（実際: ${invoked.join(',')}）`);
for (const ch of WHITELIST) {
  ok(mainSrc.includes(`ipcMain.handle('${ch}'`), `main に ${ch} の handler がある`);
}
for (const gone of ['dblink:login', 'dblink:logout']) {
  ok(!mainSrc.includes(gone) && !preloadSrc.includes(gone) && !rendererSrc.includes(gone),
    `${gone} チャネルが全レイヤから撤去済（PC はログインしない）`);
}
ok(!/signInWithPassword|logout\(\)|login\(cred\)/.test(dbLinkSrc),
  'db-link.js に login/logout/signInWithPassword が無い');

// ---- ⑥ 連携チェック既定 OFF + multi 非接触 + tournaments 配列に持たせない ----
const checkboxLine = indexHtml.split('\n').find((l) => l.includes('js-dblink-link-enabled')) || '';
ok(checkboxLine.includes('type="checkbox"') && !checkboxLine.includes(' checked'),
  '連携チェックは既定 OFF（checked 属性なし）');
ok(!read('src/renderer/multi/multi-control.html').includes('dblink') &&
   !read('src/renderer/multi/multi-grid.html').includes('dblink'),
  '4分割(multi)系 HTML に連携 UI が無い（連携非対応）');
const normStart = mainSrc.indexOf('function normalizeTournament');
ok(normStart >= 0, 'normalizeTournament の定義が存在する');
const normEnd = mainSrc.indexOf('\nfunction ', normStart + 1);
const normBody = mainSrc.slice(normStart, normEnd > normStart ? normEnd : normStart + 8000);
ok(!/dbLink/i.test(normBody),
  'normalizeTournament 本体は dbLink 系キーに非接触（紐づけは dbLink.links に隔離保存）');

// ---- ⑦ fetch 先の限定 + Bearer 付与（受け口 API 以外を呼ばない） ----
ok(dbLinkSrc.includes('`${_baseUrl()}/api/pc-timer${apiPath}`'),
  'fetch 先は 設定URL + /api/pc-timer/* のみ（他のエンドポイントを組み立てない）');
ok(dbLinkSrc.includes('Authorization: `Bearer ${storeKey}`'),
  '全リクエストに Authorization: Bearer <店舗キー> を付与');
ok((dbLinkSrc.match(/https?:\/\//g) || []).every((m) => m === 'https://'),
  'db-link.js に http:// のハードコード URL が無い（https:// 検証のみ）');

// ---- ⑧ 旧方式の残骸なし ----
ok(!dbLinkSrc.includes('sessionStore') && !/writeFileSync|\.set\(\s*['"]db-link-session/.test(dbLinkSrc),
  'db-link-session への書込コードが無い（init での削除のみ）');
ok(dbLinkSrc.includes("'db-link-session.json'") && dbLinkSrc.includes('unlinkSync'),
  '旧セッションファイルは init 時に削除される（旧トークンを残置しない）');
ok(!fs.existsSync(path.join(root, 'src/link/business-date.js')),
  'business-date.js は撤去済（営業日判定はサーバー側）');
ok(!dbLinkSrc.includes("require('./business-date')"), 'db-link.js は business-date を require しない');

// ==== 純ロジック検査（fetch 注入・実ネットワークなし） ====

const dbLink = require(path.join(root, 'src/link/db-link.js'));

// electron-store の代わりの素朴なスタブ（path 無し = セッション掃除はスキップされる）
function makeStore(initial) {
  const data = { dbLink: initial };
  return {
    get: (k) => data[k],
    set: (k, v) => { data[k] = v; },
    _data: data
  };
}

(async () => {
  // -- 未設定 → fetch を一切呼ばない --
  let fetchCalls = 0;
  dbLink.init(makeStore({ url: '', storeKey: '', links: {} }), null,
    { fetchImpl: async () => { fetchCalls++; throw new Error('should not be called'); } });
  let res = await dbLink.listTodayTournaments();
  ok(res.ok === false && res.code === 'not_configured' && fetchCalls === 0,
    '未設定では fetch を呼ばずに日本語エラー（inert）');

  // -- Bearer ヘッダ + URL 正規化（末尾スラッシュ）+ 成功透過 --
  let captured = null;
  const okFetch = (payload, status = 200) => async (url, opts) => {
    captured = { url, opts };
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
  dbLink.init(makeStore({ url: 'https://shop.example.com/', storeKey: 'test-key-123', links: {} }), null,
    { fetchImpl: okFetch({ ok: true, tournaments: [{ id: 'u1', name: '大会A', part_label: '第1部', business_date: '2026-07-18', status: 'open' }] }) });
  res = await dbLink.listTodayTournaments();
  ok(res.ok === true && res.tournaments.length === 1 && res.tournaments[0].id === 'u1',
    'GET /tournaments の成功本文を透過');
  ok(captured.url === 'https://shop.example.com/api/pc-timer/tournaments',
    `URL 末尾スラッシュが正規化される（実際: ${captured.url}）`);
  ok(captured.opts.headers.Authorization === 'Bearer test-key-123',
    'Authorization: Bearer <店舗キー> が付与される');
  ok(captured.opts.signal instanceof AbortSignal, 'タイムアウト用の AbortSignal が付く');

  // -- プレーン 404（認可NG）→ 設定不備の日本語（生 HTTP 値を出さない） --
  dbLink.init(makeStore({ url: 'https://shop.example.com', storeKey: 'wrong', links: {} }), null,
    { fetchImpl: async () => ({ ok: false, status: 404, json: async () => { throw new Error('not json'); } }) });
  res = await dbLink.listTodayTournaments();
  ok(res.ok === false && res.code === 'auth' && res.error === '連携先 URL または店舗キーを確認してください',
    'プレーン 404 は「連携先 URL または店舗キーを確認」へ写像');
  ok(!/404/.test(res.error), 'エラー文言に生の HTTP 値が出ない');

  // -- JSON エラー本文（API の日本語）→ そのまま透過 --
  dbLink.init(makeStore({ url: 'https://shop.example.com', storeKey: 'k', links: {} }), null,
    { fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ ok: false, code: 'clock_not_found', error: '時計がまだ作成されていません' }) }) });
  res = await dbLink.listTodayTournaments();
  ok(res.ok === false && res.code === 'clock_not_found' && res.error === '時計がまだ作成されていません',
    'API の日本語エラー本文はそのまま透過（not_found 系 404 の判別）');

  // -- ネットワーク例外 → 接続不可の日本語 --
  dbLink.init(makeStore({ url: 'https://shop.example.com', storeKey: 'k', links: {} }), null,
    { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  res = await dbLink.listTodayTournaments();
  ok(res.ok === false && res.code === 'network' && res.error.includes('接続できません'),
    'fetch 例外は「連携先に接続できません」へ写像（生エラー文言を出さない）');

  // -- setConfig: https:// 強制 + anonKey の自然クリーニング --
  const store2 = makeStore({ url: 'https://old.example.com', anonKey: 'legacy-anon', links: { pc1: { id: 'u1', name: 'A', part_label: '' } } });
  dbLink.init(store2, null, {});
  res = dbLink.setConfig({ url: 'http://insecure.example.com', storeKey: 'k' });
  ok(res.ok === false && res.error.includes('https://'), 'http:// の連携先 URL は拒否');
  res = dbLink.setConfig({ url: 'https://new.example.com', storeKey: 'new-key' });
  ok(res.ok === true, 'setConfig 正常系');
  ok(!('anonKey' in store2._data.dbLink), '旧 anonKey キーは書き戻さない（自然クリーニング）');
  ok(store2._data.dbLink.storeKey === 'new-key' && store2._data.dbLink.links.pc1.id === 'u1',
    'storeKey 保存 + 既存 links は温存');
  ok(!('storeKey' in dbLink.getStatus()), 'getStatus は店舗キーの値を返さない');
  ok(dbLink.getStatus().configured === true, 'getStatus.configured が設定状態を反映');

  // -- setTournamentLink: 対応表1行の ON/OFF --
  const store3 = makeStore({ url: 'https://s.example.com', storeKey: 'k', links: {} });
  dbLink.init(store3, null, {});
  res = dbLink.setTournamentLink({ tournamentId: 'pc-t1', enabled: true });
  ok(res.ok === false, 'ON なのに db 選択なしは拒否');
  res = dbLink.setTournamentLink({ tournamentId: 'pc-t1', enabled: true, db: { id: 'uuid-1', name: '大会A', part_label: '第2部' } });
  ok(res.ok === true &&
     JSON.stringify(store3._data.dbLink.links['pc-t1']) === JSON.stringify({ id: 'uuid-1', name: '大会A', part_label: '第2部' }),
    'ON = 非機微3値のみの対応表1行を保存');
  res = dbLink.setTournamentLink({ tournamentId: 'pc-t1', enabled: false });
  ok(res.ok === true && !('pc-t1' in store3._data.dbLink.links), 'OFF = 対応表の行を削除');

  console.log(`db-link.test.js: ${count} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
