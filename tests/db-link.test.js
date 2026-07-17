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
  // 三項でもリテラル2択のみなら可（変数・テンプレートを渡さない=秘匿値が構造的に漏れない）
  if (/^_log\((?:res\.ok|ok) \? '[a-z:-]+' : '[a-z:-]+'\)$/.test(call)) { count++; continue; }
  ok(/^_log\('[a-z:-]+'\)$/.test(call), `ログはイベント名リテラルのみ: ${call}`);
}
ok(!/console\.(log|error|warn|info)/.test(dbLinkSrc),
  'db-link.js は console 出力を一切しない（storeKey が構造的に漏れない）');
ok(rendererSrc.includes("if (keyEl) keyEl.value = '';"),
  'renderer は店舗キー保存後に入力欄をクリア（画面に残さない）');

// ---- ⑤ preload whitelist（dblink は invoke 5 + send 2 の 7 チャネルのみ・login/logout 撤去） ----
const dblinkBlock = preloadSrc.slice(preloadSrc.indexOf('dblink: {'));
const invoked = [...dblinkBlock.matchAll(/_measuredInvoke\('(dblink:[a-zA-Z]+)'/g)].map((m) => m[1]);
const WHITELIST = [
  'dblink:getStatus',
  'dblink:setConfig',
  'dblink:listTodayTournaments',
  'dblink:setTournamentLink',
  'dblink:linkAndInit',
  'dblink:probe',
  'dblink:stopLink'
];
ok(invoked.length === WHITELIST.length && WHITELIST.every((c) => invoked.includes(c)),
  `preload の dblink invoke 公開が whitelist 7 チャネルと一致（実際: ${invoked.join(',')}）`);
for (const ch of WHITELIST) {
  ok(mainSrc.includes(`ipcMain.handle('${ch}'`), `main に ${ch} の handler がある`);
}
// K2: 状態送信は fire-and-forget（ipcRenderer.send）の 2 チャネルのみ
const sent = [...dblinkBlock.matchAll(/ipcRenderer\.send\('(dblink:[a-zA-Z]+)'/g)].map((m) => m[1]);
const SEND_WHITELIST = ['dblink:publishRecord', 'dblink:publishRuntime'];
ok(sent.length === SEND_WHITELIST.length && SEND_WHITELIST.every((c) => sent.includes(c)),
  `preload の dblink send 公開が whitelist 2 チャネルと一致（実際: ${sent.join(',')}）`);
for (const ch of SEND_WHITELIST) {
  ok(mainSrc.includes(`ipcMain.on('${ch}'`), `main に ${ch} の on ハンドラがある`);
}
// K2: record 送信トリガは「状態遷移（status/level 変化）のみ」＝毎 tick 送信しない（レート設計の核）
ok(rendererSrc.includes('state.status !== prev.status || state.currentLevelIndex !== prev.currentLevelIndex'),
  'renderer の record 購読は status/levelIndex 変化時のみ（remainingMs=毎 tick を送信条件にしない）');
// K3: listener は dblink:event の 1 チャネルのみ（preload on / main は notify broadcast）
const listened = [...dblinkBlock.matchAll(/ipcRenderer\.on\('(dblink:[a-zA-Z]+)'/g)].map((m) => m[1]);
ok(listened.length === 1 && listened[0] === 'dblink:event',
  `preload の dblink listener は dblink:event のみ（実際: ${listened.join(',')}）`);
ok(mainSrc.includes("webContents.send('dblink:event'"), 'main は dblink:event を broadcast する');
// K3: DB→engine 適用中の往復ループ遮断（適用が publish を誘発して DB を上書きしない）
ok(rendererSrc.includes('if (_dbLinkApplying) return;'),
  'publish 系は _dbLinkApplying 中に送信しない（適用→送信の往復ループ遮断）');
// K3: runtime 採用は c18 パターン遵守（適用関数内に schedulePersistRuntime = 永続化フック 9 箇所目）
const applyFnStart = rendererSrc.indexOf('function applyDbToEngine');
ok(applyFnStart >= 0, 'applyDbToEngine（実行器）が存在する');
const applyFnBody = rendererSrc.slice(applyFnStart, rendererSrc.indexOf('\nfunction ', applyFnStart + 1));
ok(/schedulePersistRuntime\s*\(\s*\)/.test(applyFnBody),
  'applyDbToEngine は runtime 採用時に schedulePersistRuntime を呼ぶ（c18 パターン=永続化フック）');
ok(!/handleReset|resetBlindProgressOnly/.test(applyFnBody),
  'applyDbToEngine は handleReset / resetBlindProgressOnly を呼ばない（timer.js 公開 API のみ）');
// K3: 切断中バッジは既定 hidden（表示は JS トグルのみ・multi 系 HTML には無い）
const badgeLine = indexHtml.split('\n').find((l) => l.includes('js-dblink-indicator')) || '';
ok(badgeLine.includes('hidden'), '連携切断中バッジは既定 hidden');
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

  // ==== K2: setConfig 空キー維持（K1 完了 review 懐疑役指摘の手当て） ====
  const store4 = makeStore({ url: 'https://s.example.com', storeKey: 'keep-me', links: {} });
  dbLink.init(store4, null, {});
  res = dbLink.setConfig({ url: 'https://new-url.example.com', storeKey: '' });
  ok(res.ok === true && store4._data.dbLink.storeKey === 'keep-me' &&
     store4._data.dbLink.url === 'https://new-url.example.com',
    'URL のみ再保存では保存済み店舗キーを維持（空文字上書きしない）');
  res = dbLink.setConfig({ url: '', storeKey: '' });
  ok(res.ok === true && store4._data.dbLink.storeKey === '' && store4._data.dbLink.url === '',
    'URL も空にして保存 = 未設定へ戻す（キーも消える）');

  // ==== K2: 送信系（coalescer / 楽観ロック echo-back / 409 再送 / 429 バックオフ） ====

  // 仮想時計 + 手動スケジューラ（delayFn/nowFn 注入で決定的に駆動）
  let vnow = 0;
  let timers = [];
  const nowFn = () => vnow;
  const delayFn = (fn, ms) => { const t = { fn, at: vnow + ms }; timers.push(t); return t; };
  const drain = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
  async function advance(ms) {
    vnow += ms;
    // 期限が来たタイマーを順に実行（実行中に新規登録されたものも同ループで処理）
    for (;;) {
      const due = timers.filter((t) => t.at <= vnow).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      due.fn();
      await drain(); // _flushSend の async 完了を待つ
    }
  }
  // シナリオ駆動 fake fetch（呼出記録 + 応答キュー）
  let calls = [];
  let responses = [];
  const scenarioFetch = async (url, opts) => {
    calls.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : null });
    const next = responses.shift();
    if (!next) throw new Error('scenario exhausted');
    if (next.throw) throw new TypeError('fetch failed');
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.json };
  };
  const DB_ID = '11111111-2222-3333-4444-555555555555';
  const LINKED = { url: 'https://s.example.com', storeKey: 'k', links: { pc1: { id: DB_ID, name: 'A', part_label: '' } } };

  // -- coalescer: 最新 payload 勝ち + 初回 expected_updated_at=null + 成功でキャッシュ --
  vnow = 100_000; timers = []; calls = []; responses = [
    { status: 200, json: { ok: true, clock: { updated_at: 'T1' } } },
    { status: 200, json: { ok: true, clock: { updated_at: 'T2' } } }
  ];
  const storeK2 = makeStore(JSON.parse(JSON.stringify(LINKED)));
  dbLink.init(storeK2, null, { fetchImpl: scenarioFetch, nowFn, delayFn });
  dbLink.publishRecord('pc1', { status: 'running', current_level_index: 0, end_at_ms: 111, paused_remaining_ms: null, pre_start_total_ms: null });
  dbLink.publishRecord('pc1', { status: 'paused', current_level_index: 0, end_at_ms: null, paused_remaining_ms: 999, pre_start_total_ms: null });
  ok(calls.length === 0, 'トレーリング coalesce 中は未送信（連打は収束待ち）');
  await advance(300);
  ok(calls.length === 1 && calls[0].url.endsWith('/api/pc-timer/clock/record'),
    '300ms 後に record を 1 回だけ送信（2 連打が 1 送信に収束）');
  ok(calls[0].body.status === 'paused' && calls[0].body.paused_remaining_ms === 999,
    'coalesce は最新 payload 勝ち');
  ok(calls[0].body.expected_updated_at === null, '初回書込は expected_updated_at=null');
  ok(calls[0].body.tournament_id === DB_ID, 'tournament_id は対応表の db 大会id');
  // -- 最小送信間隔 2 秒 + echo-back --
  dbLink.publishRecord('pc1', { status: 'running', current_level_index: 1, end_at_ms: 222, paused_remaining_ms: null, pre_start_total_ms: null });
  await advance(300);
  ok(calls.length === 1, '直前送信から 2 秒未満は待機（レート 60回/分の構造的担保）');
  await advance(1700);
  ok(calls.length === 2 && calls[1].body.expected_updated_at === 'T1',
    '2 秒経過で送信 + 直前成功応答の updated_at をそのまま echo back');

  // -- K3(仕様2 準拠・K2 意図的更新): 409 clock_conflict → GET /clock → **再送しない**+apply-db 通知 --
  //    K2 の「1回再送=PC 優先」は一時逸脱として plan review 条件②で合意済 → K3 で「DB に従う」へ収束
  vnow = 100_000; timers = []; calls = []; responses = [
    { status: 409, json: { ok: false, code: 'clock_conflict', error: '他の端末が更新しました' } },
    { status: 200, json: { ok: true, clock: { status: 'paused', updated_at: 'T9' } } }
  ];
  let events = [];
  const notify = (p) => { events.push(p); };
  dbLink.init(makeStore(JSON.parse(JSON.stringify(LINKED))), null, { fetchImpl: scenarioFetch, nowFn, delayFn, notify });
  dbLink.publishRuntime('pc1', { players_initial: 10, players_remaining: 9, reentry_count: 0, addon_count: 0, special_count: 0, special_enabled: false });
  await advance(300);
  ok(calls.length === 2, '409 → GET /clock で終わり（再送しない=DB に従う）');
  ok(calls[0].url.endsWith('/clock/runtime') && calls[1].url.includes(`/clock?t=${DB_ID}`),
    '呼出順 = POST(409) → GET 再取得のみ');
  const applyEvents = events.filter((e) => e.type === 'apply-db');
  ok(applyEvents.length === 1 && applyEvents[0].clock && applyEvents[0].clock.updated_at === 'T9',
    'conflict 時は apply-db イベントで DB 状態を renderer へ渡す（反映アダプタ行き）');

  // -- K3: health 遷移（down/up は変化時のみ notify・auth/network が down・API エラーは down にしない） --
  vnow = 100_000; timers = []; calls = []; events = []; responses = [
    { throw: true },
    { throw: true },
    { status: 404, json: { ok: false, code: 'clock_not_found', error: '時計がありません' } },
    { status: 200, json: { ok: true, clock: { updated_at: 'H1' } } }
  ];
  dbLink.init(makeStore(JSON.parse(JSON.stringify(LINKED))), null, { fetchImpl: scenarioFetch, nowFn, delayFn, notify });
  await dbLink.getClock(DB_ID);   // network 例外 → down
  await dbLink.getClock(DB_ID);   // 連続 network → notify なし（変化時のみ）
  await dbLink.getClock(DB_ID);   // API エラー(not_found)=サーバー到達 → up 復帰
  await dbLink.getClock(DB_ID);   // 成功 → 変化なし
  const healthEvents = events.filter((e) => e.type === 'health');
  ok(healthEvents.length === 2 && healthEvents[0].down === true && healthEvents[1].down === false,
    'health は down→up の変化時のみ 1 回ずつ notify（連続エラーで重複しない）');

  // -- K3: probe（読取のみ・clock 返却・health 復帰も担う） --
  vnow = 100_000; timers = []; calls = []; events = []; responses = [
    { status: 200, json: { ok: true, clock: { status: 'running', updated_at: 'P1' } } }
  ];
  dbLink.init(makeStore(JSON.parse(JSON.stringify(LINKED))), null, { fetchImpl: scenarioFetch, nowFn, delayFn, notify });
  res = await dbLink.probe('pc1');
  ok(res.ok === true && res.clock && res.clock.updated_at === 'P1', 'probe は GET /clock の clock を返す');
  ok(calls.length === 1 && calls[0].opts.method === 'GET', 'probe は読取のみ（書込しない）');
  res = await dbLink.probe('unlinked');
  ok(res.ok === false && calls.length === 1, '未紐づけの probe は fetch しない');

  // -- K3: stopLink（OFF=配信停止。楽観ロックなし・行削除・冪等・失敗でも行削除+warning） --
  vnow = 100_000; timers = []; calls = []; events = []; responses = [
    { status: 200, json: { ok: true, clock: { status: 'idle', updated_at: 'S1' } } }
  ];
  const storeStop = makeStore(JSON.parse(JSON.stringify(LINKED)));
  dbLink.init(storeStop, null, { fetchImpl: scenarioFetch, nowFn, delayFn, notify });
  res = await dbLink.stopLink({ tournamentId: 'pc1' });
  ok(res.ok === true && !res.warning, 'stopLink 正常系');
  ok(calls[0].url.endsWith('/clock/stop') && calls[0].body.tournament_id === DB_ID &&
     !('expected_updated_at' in calls[0].body),
    'stop は楽観ロックなし（expected_updated_at を送らない=停止意思優先）');
  ok(!('pc1' in storeStop._data.dbLink.links), 'stopLink は紐づけ行を削除');
  // clock_not_found = 冪等成功
  vnow = 100_000; timers = []; calls = []; responses = [
    { status: 404, json: { ok: false, code: 'clock_not_found', error: '時計がありません' } }
  ];
  const storeStop2 = makeStore(JSON.parse(JSON.stringify(LINKED)));
  dbLink.init(storeStop2, null, { fetchImpl: scenarioFetch, nowFn, delayFn, notify });
  res = await dbLink.stopLink({ tournamentId: 'pc1' });
  ok(res.ok === true && !res.warning && !('pc1' in storeStop2._data.dbLink.links),
    'clock_not_found は冪等成功（止めるものが無いだけ）');
  // 通信失敗でも行削除 + warning
  vnow = 100_000; timers = []; calls = []; responses = [{ throw: true }];
  const storeStop3 = makeStore(JSON.parse(JSON.stringify(LINKED)));
  dbLink.init(storeStop3, null, { fetchImpl: scenarioFetch, nowFn, delayFn, notify });
  res = await dbLink.stopLink({ tournamentId: 'pc1' });
  ok(res.ok === true && typeof res.warning === 'string' && !('pc1' in storeStop3._data.dbLink.links),
    '通信失敗でも行は削除（OFF 意思優先）+ 配信残存の warning');

  // -- 429 → 60 秒バックオフ後に保持 payload を送る --
  vnow = 100_000; timers = []; calls = []; responses = [
    { status: 429, json: { ok: false, code: 'rate_limited', error: '送信が多すぎます' } },
    { status: 200, json: { ok: true, clock: { updated_at: 'T20' } } }
  ];
  dbLink.init(makeStore(JSON.parse(JSON.stringify(LINKED))), null, { fetchImpl: scenarioFetch, nowFn, delayFn });
  dbLink.publishRecord('pc1', { status: 'running', current_level_index: 2, end_at_ms: 333, paused_remaining_ms: null, pre_start_total_ms: null });
  await advance(300);
  ok(calls.length === 1, '429 直後は再送しない（バックオフ）');
  await advance(59_000);
  ok(calls.length === 1, 'バックオフ中は送らない');
  await advance(2_000);
  ok(calls.length === 2 && calls[1].body.current_level_index === 2, 'バックオフ後に保持 payload を送る');

  // -- 未紐づけ / 未設定は fetch ゼロ --
  vnow = 100_000; timers = []; calls = []; responses = [];
  dbLink.init(makeStore({ url: 'https://s.example.com', storeKey: 'k', links: {} }), null, { fetchImpl: scenarioFetch, nowFn, delayFn });
  dbLink.publishRecord('unlinked-pc', { status: 'running', current_level_index: 0, end_at_ms: 1, paused_remaining_ms: null, pre_start_total_ms: null });
  await advance(1000);
  ok(calls.length === 0 && timers.length === 0, '未紐づけ pcId の publish は fetch もタイマーもゼロ');

  // ==== K2: linkAndInit（fresh / clock_running 接続 / upload 失敗） ====

  // -- fresh: structures → init → 対応表保存 --
  vnow = 100_000; timers = []; calls = []; responses = [
    { status: 200, json: { ok: true, structure_id: 'sid-1' } },
    { status: 200, json: { ok: true, clock: { updated_at: 'T0' } } }
  ];
  const storeLink = makeStore({ url: 'https://s.example.com', storeKey: 'k', links: {} });
  dbLink.init(storeLink, null, { fetchImpl: scenarioFetch, nowFn, delayFn });
  const structure = { name: '大会A', structure_type: 'BLIND', levels: [{ level: 1, sb: 100, bb: 200, durationMinutes: 20, isBreak: false }] };
  res = await dbLink.linkAndInit({ tournamentId: 'pc1', db: { id: DB_ID, name: 'A', part_label: '' }, structure });
  ok(res.ok === true && res.mode === 'fresh', 'linkAndInit 正常系は mode=fresh');
  ok(calls[0].url.endsWith('/structures') && calls[0].body.levels.length === 1,
    '構成 upload が先行（levels 透過）');
  ok(calls[1].url.endsWith('/clock/init') && calls[1].body.structure_id === 'sid-1' && calls[1].body.tournament_id === DB_ID,
    'init は upload が返した structure_id を使う');
  ok(storeLink._data.dbLink.links.pc1 && storeLink._data.dbLink.links.pc1.id === DB_ID,
    '成功時のみ対応表を保存');

  // -- clock_running: 構成差し替えせず既存時計へ接続（mode=connected + warning） --
  vnow = 100_000; timers = []; calls = []; responses = [
    { status: 200, json: { ok: true, structure_id: 'sid-2' } },
    { status: 409, json: { ok: false, code: 'clock_running', error: '進行中は差し替えできません' } },
    { status: 200, json: { ok: true, clock: { status: 'running', updated_at: 'T5' } } }
  ];
  const storeConn = makeStore({ url: 'https://s.example.com', storeKey: 'k', links: {} });
  dbLink.init(storeConn, null, { fetchImpl: scenarioFetch, nowFn, delayFn });
  res = await dbLink.linkAndInit({ tournamentId: 'pc1', db: { id: DB_ID, name: 'A', part_label: '' }, structure });
  ok(res.ok === true && res.mode === 'connected' && typeof res.warning === 'string',
    'init 409 clock_running は既存時計へ接続（mode=connected + warning）');
  ok(res.clock && res.clock.updated_at === 'T5',
    'K3: connected は取得した clock を返す（renderer が反映アダプタで DB に従う）');
  ok(calls[2].url.includes(`/clock?t=${DB_ID}`), '接続時は GET /clock でキャッシュ取得');
  ok(storeConn._data.dbLink.links.pc1 && storeConn._data.dbLink.links.pc1.id === DB_ID,
    '接続時も対応表は保存（送信は renderer 側が抑止 = plan review 条件①）');

  // -- upload 失敗: 対応表を保存しない --
  vnow = 100_000; timers = []; calls = []; responses = [
    { status: 404, json: null }
  ];
  const storeFail = makeStore({ url: 'https://s.example.com', storeKey: 'wrong', links: {} });
  dbLink.init(storeFail, null, { fetchImpl: scenarioFetch, nowFn, delayFn });
  res = await dbLink.linkAndInit({ tournamentId: 'pc1', db: { id: DB_ID, name: 'A', part_label: '' }, structure });
  ok(res.ok === false && res.code === 'auth', 'upload 失敗（認可 404）はエラー透過');
  ok(!('pc1' in storeFail._data.dbLink.links), '失敗時は対応表を保存しない');

  console.log(`db-link.test.js: ${count} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
