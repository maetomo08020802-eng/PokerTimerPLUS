/**
 * v2.1.20-rc5 静的解析テスト — operator 側 preStartState 配信経路 構造的根治
 *
 *   Fix 1: main.js _publishDualState で preStartState を operator (mainWindow) にも broadcast
 *   Fix 2: main.js switchSoloToOperator で did-finish-load タイミングで cache から preStartState 再送信
 *   Fix 3: renderer.js operator / operator-solo ブロックに subscribeStateSync 追加（preStartState 拾い）
 *   Fix 4: renderer.js 7736-7744 dead code 経路にコメント追記のみ（コード本体は touch なし）
 *
 *   rc1〜rc4 機構 + 計測機構 + 致命バグ保護 5 件 完全保持
 *
 * 実行: node tests/v243-operator-prestart-broadcast.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT       = path.join(__dirname, '..');
const PKG        = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const TIMER_JS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'timer.js'), 'utf8');
const DUAL_SYNC  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');
const STATE_JS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'state.js'), 'utf8');
const MAIN_JS    = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD_JS = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const STYLE_CSS  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const AUDIO_JS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1: package.json.version === '2.1.20-rc5'
// ============================================================
test('T1: package.json.version === 2.1.20-rc5', () => {
  assert.equal(PKG.version, '2.1.20-rc5', `期待 2.1.20-rc5, 実際 ${PKG.version}`);
});

// ============================================================
// T2: Fix 1 — main.js _publishDualState に kind === 'preStartState' で mainWindow.webContents.send 経路存在
// ============================================================
test('T2: main.js _publishDualState に kind === preStartState 分岐 + mainWindow.webContents.send 経路存在', () => {
  // _publishDualState 関数本体を抽出
  const fnMatch = MAIN_JS.match(/function\s+_publishDualState\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(fnMatch, '_publishDualState 関数本体が見つからない');
  const body = fnMatch[1];
  // kind === 'preStartState' && mainWindow ガード経路
  assert.match(body,
    /kind\s*===\s*['"]preStartState['"][\s\S]{0,200}?mainWindow[\s\S]{0,100}?isDestroyed\s*\(\s*\)/,
    'Fix 1 未完了: _publishDualState に kind === preStartState + mainWindow.isDestroyed() ガード経路がない');
  // mainWindow.webContents.send('dual:state-sync', ...) 呼出
  assert.match(body,
    /mainWindow\.webContents\.send\s*\(\s*['"]dual:state-sync['"]/,
    'Fix 1 未完了: _publishDualState 内に mainWindow.webContents.send(dual:state-sync, ...) なし');
});

// ============================================================
// T3: Fix 1 — preStart:operator:send ラベル発火経路
// ============================================================
test('T3: 新規ラベル preStart:operator:send が main.js 内に存在', () => {
  assert.match(MAIN_JS,
    /rollingLog\s*\(\s*['"]preStart:operator:send['"]/,
    'Fix 1 未完了: 新規ラベル preStart:operator:send の rollingLog 発火経路がない');
});

// ============================================================
// T4: Fix 2 — switchSoloToOperator 内に preStartState cache + did-finish-load 経路存在
// ============================================================
test('T4: switchSoloToOperator 内に _dualStateCache.preStartState.isActive + did-finish-load 経路存在', () => {
  // switchSoloToOperator 関数本体を抽出
  const fnMatch = MAIN_JS.match(/async\s+function\s+switchSoloToOperator\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(fnMatch, 'switchSoloToOperator 関数本体が見つからない');
  const body = fnMatch[1];
  // _dualStateCache.preStartState && ... isActive ガード
  assert.match(body,
    /_dualStateCache\.preStartState[\s\S]{0,100}?isActive/,
    'Fix 2 未完了: switchSoloToOperator 内に _dualStateCache.preStartState.isActive ガードなし');
  // mainWindow.webContents.once('did-finish-load', ...) リスナー登録
  assert.match(body,
    /mainWindow\.webContents\.once\s*\(\s*['"]did-finish-load['"]/,
    'Fix 2 未完了: switchSoloToOperator 内に mainWindow.webContents.once(did-finish-load) なし');
  // listener 内で dual:state-sync + preStartState 送信
  assert.match(body,
    /webContents\.send\s*\(\s*['"]dual:state-sync['"][\s\S]{0,100}?preStartState/,
    'Fix 2 未完了: did-finish-load listener 内で dual:state-sync + preStartState 送信なし');
});

// ============================================================
// T5: Fix 2 — operator:preStartResync:sent ラベル発火経路
// ============================================================
test('T5: 新規ラベル operator:preStartResync:sent が main.js 内に存在', () => {
  assert.match(MAIN_JS,
    /rollingLog\s*\(\s*['"]operator:preStartResync:sent['"]/,
    'Fix 2 未完了: 新規ラベル operator:preStartResync:sent の rollingLog 発火経路がない');
});

// ============================================================
// T6: Fix 3 — renderer.js operator + operator-solo ブロックに subscribeStateSync + applyOperatorPreStartState 経路
// ============================================================
test('T6: renderer.js operator + operator-solo ブロックに subscribeStateSync + applyOperatorPreStartState 経路', () => {
  // operator ブロック: else if (__appRole === 'operator') 直後に subscribeStateSync + applyOperatorPreStartState
  const operatorBlockMatch = RENDERER.match(/else\s+if\s*\(\s*__appRole\s*===\s*['"]operator['"]\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(operatorBlockMatch, 'operator ブロック (else if (__appRole === operator)) 抽出失敗');
  const operatorBody = operatorBlockMatch[1];
  assert.match(operatorBody,
    /subscribeStateSync\s*\?\.?\s*\([\s\S]{0,500}?applyOperatorPreStartState/,
    'Fix 3 未完了: operator ブロック内に subscribeStateSync + applyOperatorPreStartState 経路なし');
  // operator-solo ブロック: 上記の else 内（__appRole === operator の後）
  const operatorSoloBlockMatch = RENDERER.match(/else\s+if\s*\(\s*__appRole\s*===\s*['"]operator['"]\s*\)[\s\S]*?\}\s*else\s*\{([\s\S]*?)\n\}/);
  assert.ok(operatorSoloBlockMatch, 'operator-solo ブロック (else) 抽出失敗');
  const operatorSoloBody = operatorSoloBlockMatch[1];
  assert.match(operatorSoloBody,
    /subscribeStateSync\s*\?\.?\s*\([\s\S]{0,500}?applyOperatorPreStartState/,
    'Fix 3 未完了: operator-solo ブロック (else) 内に subscribeStateSync + applyOperatorPreStartState 経路なし');
});

// ============================================================
// T7: Fix 4 — renderer.js 7736 付近の rc4 dead code 経路コード本体保持（コメント追記のみ）
// ============================================================
test('T7: rc4 dead code 経路（hall ブロック内 window.appRole !== hall 分岐）コード本体完全保持 + rc5 補足コメント追加', () => {
  // dead code 経路: kind === 'preStartState' && ... && window.appRole !== 'hall'
  // hall ブロック内のため到達しないが、コード本体は残置（コメント追加で行が伸びるため上限大きめ）
  assert.match(RENDERER,
    /kind\s*===\s*['"]preStartState['"][\s\S]{0,200}?window\.appRole\s*!==\s*['"]hall['"][\s\S]{0,1500}?applyOperatorPreStartState\s*\(\s*value\s*\)/,
    'rc4 dead code 経路のコード本体が破壊された（applyOperatorPreStartState(value) 呼出が見つからない）');
  // rc5 補足コメント追加確認
  assert.match(RENDERER,
    /v2\.1\.20-rc5\s*補足[\s\S]{0,200}?dead\s*code/,
    'Fix 4 未完了: rc4 dead code 経路に rc5 補足コメント（dead code 言及）が追加されていない');
});

// ============================================================
// T8: rc1 / rc2 / rc3 / rc4 機構保持
// ============================================================
test('T8: rc1 / rc2 / rc3 / rc4 機構保持（setState 撤廃 / DocumentFragment / memo / CSS 統一 / hallTickState reset / renderTournamentListWithDedup / restorePreStart / PRE_START 分岐）', () => {
  // rc1 Fix 1: renderHallTickFrame setState 撤廃
  const stripped = RENDERER.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const fnStart = stripped.indexOf('function renderHallTickFrame()');
  assert.ok(fnStart >= 0);
  const fnSnippet = stripped.slice(fnStart, fnStart + 2000);
  assert.doesNotMatch(fnSnippet, /setState\s*\(\s*\{[^}]*remainingMs/,
    'rc1 Fix 1 退行: renderHallTickFrame に setState({...remainingMs...}) が残存');
  // rc1 Fix 2-A: DocumentFragment
  assert.match(RENDERER, /document\.createDocumentFragment\s*\(\s*\)/,
    'rc1 Fix 2-A 退行: DocumentFragment 使用なし');
  // rc1 Fix 2-B: memoized
  assert.match(RENDERER, /function\s+computeLiveTimerStateMemoized\s*\(/,
    'rc1 Fix 2-B 退行: computeLiveTimerStateMemoized 関数消失');
  assert.match(RENDERER, /const\s+_computeLiveTimerStateMemo\s*=\s*new\s+WeakMap/,
    'rc1 Fix 2-B 退行: _computeLiveTimerStateMemo WeakMap 消失');
  // rc1 Fix 4: CSS 統一
  assert.match(STYLE_CSS,
    /\.clock\[data-prestart-paused="true"\]\s+\.clock__pause-label\s*\{[^}]*opacity\s*:\s*1/,
    'rc1 Fix 4 退行: CSS 統一ルール消失');
  // rc2: hallTickState reset 3 trigger
  for (const tg of ['applyTimerStateToTimer-non-running', 'applyHallPreStartState-inactive', 'hall-window-init']) {
    assert.ok(RENDERER.includes(`'${tg}'`), `rc2 退行: hall:hallTickState:reset trigger '${tg}' 消失`);
  }
  // rc3 Fix 2: renderTournamentListWithDedup 存在
  assert.match(RENDERER, /function\s+renderTournamentListWithDedup\s*\(/,
    'rc3 Fix 2 退行: renderTournamentListWithDedup 関数消失');
  assert.match(RENDERER, /let\s+_renderTournamentListInFlight\s*=\s*null/,
    'rc3 Fix 2 退行: _renderTournamentListInFlight 変数消失');
  // rc4: timer.js restorePreStart export
  assert.match(TIMER_JS, /export\s+function\s+restorePreStart\s*\(\s*payload\s*\)\s*\{/,
    'rc4 退行: timer.js restorePreStart export 消失');
  // rc4: handleStartPauseToggle 内 PRE_START + isPreStartActive() 分岐
  const fnMatchH = RENDERER.match(/function\s+handleStartPauseToggle\s*\(\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(fnMatchH, 'handleStartPauseToggle 関数本体が見つからない');
  assert.match(fnMatchH[1],
    /if\s*\(\s*status\s*===\s*States\.PRE_START[\s\S]{0,80}?isPreStartActive\s*\(\s*\)\s*\)/,
    'rc4 退行: handleStartPauseToggle 内 PRE_START + isPreStartActive() 分岐消失');
  // rc4: applyOperatorPreStartState 関数定義
  assert.match(RENDERER, /function\s+applyOperatorPreStartState\s*\(\s*payload\s*\)\s*\{/,
    'rc4 退行: applyOperatorPreStartState 関数定義消失');
});

// ============================================================
// T9: v2.1.19 機構保持 + 致命バグ保護 5 件
// ============================================================
test('T9: v2.1.19 重さ根治機構 + 致命バグ保護 5 件 完全保持', () => {
  // v2.1.19 _tournamentsListDedup
  assert.match(RENDERER, /async\s+function\s+_tournamentsListDedup\s*\(\s*\)\s*\{/,
    'v2.1.19 _tournamentsListDedup 消失');
  // v2.1.19 setInterval(renderTournamentList) 撤廃
  const stripped = RENDERER.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /setInterval\s*\(\s*(?:\([^)]*\)\s*=>\s*\{[\s\S]{0,200}?renderTournamentList[\s\S]{0,200}?\}|renderTournamentList)[\s\S]{0,80}?,\s*1000\s*\)/;
  assert.doesNotMatch(stripped, re, 'setInterval(renderTournamentList) 復活（v2.1.19 退行）');
  // 致命バグ保護 5 件
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'C.2.7-A: resetBlindProgressOnly 消失');
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/,
    'C.2.7-D: tournaments:setDisplaySettings ハンドラ消失');
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'C.1-A2: ensureEditorEditableState 消失');
  assert.match(AUDIO_JS, /resume/,
    'C.1.7: audio.js resume 経路消失');
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/,
    'C.1.8: schedulePersistRuntime 消失');
});

// ============================================================
// T10: 計測機構保持 + 新規 2 ラベル
// ============================================================
test('T10: 計測機構（meas1 + meas2 6 カテゴリ + 症状確証 4 + hall:hallTickState:reset + rc4 operator:applyPreStartState:apply + rc5 新規 2 ラベル）完全保持', () => {
  // meas1
  assert.match(INDEX_HTML, /<div\s+id="meas-build-badge">\s*計測ビルド\s*<\/div>/,
    'meas-build-badge HTML 消失');
  assert.ok(STYLE_CSS.includes('#meas-build-badge'), '#meas-build-badge CSS 消失');
  // meas2 6 カテゴリ
  const ALL_SRC = RENDERER + DUAL_SYNC + STATE_JS + MAIN_JS + PRELOAD_JS;
  for (const lbl of ['perf:interval:fire', 'perf:raf:summary', 'perf:ipc:summary', 'perf:dom:summary', 'perf:long-task', 'perf:subscribe:summary']) {
    assert.ok(ALL_SRC.includes(lbl), `meas2 ラベル ${lbl} 消失`);
  }
  // 症状確証 4
  for (const lbl of ['hall:syncSlideshowFromState:call', 'hall:updatePipTimer:set', 'hall:applyHallPreStartState:apply', 'hall:clock-pause-label:visibility']) {
    assert.ok(ALL_SRC.includes(lbl), `症状確証ラベル ${lbl} 消失`);
  }
  // rc2
  assert.ok(RENDERER.includes('hall:hallTickState:reset'), 'hall:hallTickState:reset 消失（rc2 退行）');
  // rc4
  assert.ok(RENDERER.includes('operator:applyPreStartState:apply'),
    'rc4 ラベル operator:applyPreStartState:apply 消失');
  // rc5 新規 2 ラベル
  assert.ok(MAIN_JS.includes('preStart:operator:send'),
    'rc5 新規ラベル preStart:operator:send が main.js に見つからない');
  assert.ok(MAIN_JS.includes('operator:preStartResync:sent'),
    'rc5 新規ラベル operator:preStartResync:sent が main.js に見つからない');
});

console.log(`\nv243 operator-prestart-broadcast: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
