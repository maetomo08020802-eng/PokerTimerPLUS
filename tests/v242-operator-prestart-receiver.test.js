/**
 * v2.1.20-rc10.1 静的解析テスト — operator 側 preStartState 受信機構追加
 *
 *   Fix 1: timer.js に restorePreStart(payload) export 追加
 *   Fix 2: renderer.js に applyOperatorPreStartState + dual-sync operator 経路 + import 追加
 *   Fix 3: handleStartPauseToggle に PRE_START + isPreStartActive() 分岐追加
 *   Fix 4: prestartCancel ボタンは dialog-cancel 専用、modify 不要（verify のみ）
 *
 *   rc1〜rc3 機構 + 計測機構 + 致命バグ保護 5 件 完全保持
 *
 * 実行: node tests/v242-operator-prestart-receiver.test.js
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
// T1: package.json.version === '2.1.20-rc10.1'
// ============================================================
test('T1: package.json.version === 2.1.20-rc10.1', () => {
  assert.equal(PKG.version, '2.1.20-rc10.1', `期待 2.1.20-rc10.1, 実際 ${PKG.version}`);
});

// ============================================================
// T2: Fix 1 — timer.js に restorePreStart export 追加
// ============================================================
test('T2: timer.js に restorePreStart(payload) export 定義が存在', () => {
  assert.match(TIMER_JS, /export\s+function\s+restorePreStart\s*\(\s*payload\s*\)\s*\{/,
    'timer.js に export function restorePreStart(payload) 定義が見つからない（Fix 1 未完了）');
  // 関数本体に isPreStart = true / preStartTotalMs = totalMs / setState で PRE_START or PAUSED 設定
  const m = TIMER_JS.match(/export\s+function\s+restorePreStart\s*\(\s*payload\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, 'restorePreStart 関数本体抽出失敗');
  const body = m[1];
  assert.match(body, /isPreStart\s*=\s*true/,
    'restorePreStart 内に isPreStart = true 代入なし');
  assert.match(body, /preStartTotalMs\s*=\s*totalMs/,
    'restorePreStart 内に preStartTotalMs = totalMs 代入なし');
  // 重複復元防止ガード
  assert.match(body, /if\s*\(\s*isPreStart\s*\)\s*return/,
    'restorePreStart 内に重複復元防止ガード (if (isPreStart) return) なし');
  // onPreStartStart は呼ばない（broadcast loop 防止）
  assert.doesNotMatch(body, /handlers\.onPreStartStart\s*\(/,
    'restorePreStart 内に handlers.onPreStartStart(...) があると broadcast loop の原因に');
});

// ============================================================
// T3: Fix 2 — renderer.js の registerDualDiffHandler に operator 側 preStartState 経路存在
// ============================================================
test('T3: dual-sync handler に operator 側 (window.appRole !== hall) preStartState 経路存在', () => {
  // hall 側 既存 + operator 側 新規の両方が if/else if で分岐
  // hall 側: kind === 'preStartState' && value && typeof value === 'object' && window.appRole === 'hall'
  // コメント剥離後に検索（コメントブロックで距離が大きくなるため）
  const stripped = RENDERER.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(stripped,
    /kind\s*===\s*['"]preStartState['"][\s\S]{0,200}?window\.appRole\s*===\s*['"]hall['"][\s\S]{0,200}?applyHallPreStartState/,
    'dual-sync hall 経路（kind preStartState + appRole === hall + applyHallPreStartState）が見つからない');
  // operator 側: window.appRole !== 'hall' + applyOperatorPreStartState
  assert.match(stripped,
    /kind\s*===\s*['"]preStartState['"][\s\S]{0,300}?window\.appRole\s*!==\s*['"]hall['"][\s\S]{0,300}?applyOperatorPreStartState/,
    'dual-sync operator 経路（kind preStartState + appRole !== hall + applyOperatorPreStartState）が見つからない（Fix 2 未完了）');
});

// ============================================================
// T4: Fix 2 — applyOperatorPreStartState 関数定義 + rollingLog operator:applyPreStartState:apply
// ============================================================
test('T4: applyOperatorPreStartState 関数定義 + operator:applyPreStartState:apply ラベル発火経路', () => {
  assert.match(RENDERER, /function\s+applyOperatorPreStartState\s*\(\s*payload\s*\)\s*\{/,
    'applyOperatorPreStartState 関数定義が見つからない（Fix 2 未完了）');
  // 関数本体に rollingLog 経由のラベル発火
  assert.match(RENDERER,
    /window\.api\?\.log\?\.write\?\.\s*\(\s*['"]operator:applyPreStartState:apply['"]/,
    'operator:applyPreStartState:apply ラベル発火経路が見つからない');
  // isActive 分岐 + timerRestorePreStart / timerCancelPreStart 呼出
  assert.match(RENDERER, /timerRestorePreStart\s*\(/,
    'applyOperatorPreStartState 内に timerRestorePreStart 呼出なし');
  // import 文に restorePreStart as timerRestorePreStart
  assert.match(RENDERER, /restorePreStart\s+as\s+timerRestorePreStart/,
    'timer.js からの restorePreStart as timerRestorePreStart import がない');
});

// ============================================================
// T5: Fix 3 — handleStartPauseToggle に PRE_START + isPreStartActive() 分岐存在
// ============================================================
test('T5: handleStartPauseToggle 内に status === States.PRE_START && isPreStartActive() 分岐存在', () => {
  const fnMatch = RENDERER.match(/function\s+handleStartPauseToggle\s*\(\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(fnMatch, 'handleStartPauseToggle 関数本体が見つからない');
  const body = fnMatch[1];
  // status === States.PRE_START && isPreStartActive() 形式の分岐
  assert.match(body,
    /if\s*\(\s*status\s*===\s*States\.PRE_START[\s\S]{0,80}?isPreStartActive\s*\(\s*\)\s*\)/,
    'handleStartPauseToggle 内に status === States.PRE_START && isPreStartActive() 分岐がない（Fix 3 未完了）');
  // 分岐内に timerPause + return
  assert.match(body, /isPreStartActive\s*\(\s*\)\s*\)\s*\{[\s\S]{0,150}?timerPause\s*\(\s*\)[\s\S]{0,50}?return/,
    '分岐内に timerPause() + return がない');
});

// ============================================================
// T6: rc1 / rc2 / rc3 機構保持
// ============================================================
test('T6: rc1 / rc2 / rc3 機構保持（setState 撤廃 / DocumentFragment / memo / CSS 統一 / hallTickState reset / syncSlideshow ガード撤去 / Promise dedup ラッパ）', () => {
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
  // rc3 Fix 1: subscribe 内 PRE_START ガード不在
  assert.doesNotMatch(RENDERER,
    /if\s*\(\s*!\s*\(\s*window\.appRole\s*===\s*['"]hall['"][\s\S]{0,200}?hallPreStartState\.isActive[\s\S]{0,80}?\)\s*\)\s*\{[\s\S]{0,200}?syncSlideshowFromState\s*\(\s*state\.remainingMs\s*\)/,
    'rc3 Fix 1 退行: subscribe 内に rc1 Fix 3 ガードが復活');
  // rc3 Fix 2: renderTournamentListWithDedup 存在
  assert.match(RENDERER, /function\s+renderTournamentListWithDedup\s*\(/,
    'rc3 Fix 2 退行: renderTournamentListWithDedup 関数消失');
  assert.match(RENDERER, /let\s+_renderTournamentListInFlight\s*=\s*null/,
    'rc3 Fix 2 退行: _renderTournamentListInFlight 変数消失');
});

// ============================================================
// T7: v2.1.19 機構保持
// ============================================================
test('T7: v2.1.19 重さ根治機構（_tournamentsListDedup / _shouldRefreshListByThrottle / setInterval 撤廃）完全保持', () => {
  assert.match(RENDERER, /async\s+function\s+_tournamentsListDedup\s*\(\s*\)\s*\{/,
    'v2.1.19 _tournamentsListDedup 消失');
  assert.match(RENDERER, /function\s+_shouldRefreshListByThrottle\s*\(\s*\)\s*\{/,
    'v2.1.19 _shouldRefreshListByThrottle 消失');
  const stripped = RENDERER.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /setInterval\s*\(\s*(?:\([^)]*\)\s*=>\s*\{[\s\S]{0,200}?renderTournamentList[\s\S]{0,200}?\}|renderTournamentList)[\s\S]{0,80}?,\s*1000\s*\)/;
  assert.doesNotMatch(stripped, re, 'setInterval(renderTournamentList) 復活（v2.1.19 退行）');
  const dedupCalls = (RENDERER.match(/_tournamentsListDedup\s*\(\)/g) || []).length;
  assert.ok(dedupCalls >= 12, `_tournamentsListDedup() 呼出 ${dedupCalls} 件（12 件以上必要）`);
});

// ============================================================
// T8: 計測機構保持（meas1 + meas2 + 症状確証 4 + hall:hallTickState:reset + 新規 operator:applyPreStartState:apply）
// ============================================================
test('T8: 計測機構（バッジ + meas2 6 カテゴリ + 症状確証 4 + hall:hallTickState:reset + 新規 operator:applyPreStartState:apply）完全保持', () => {
  assert.match(INDEX_HTML, /<div\s+id="meas-build-badge">\s*計測ビルド\s*<\/div>/,
    'meas-build-badge HTML 消失');
  assert.ok(STYLE_CSS.includes('#meas-build-badge'), '#meas-build-badge CSS 消失');
  const ALL_SRC = RENDERER + DUAL_SYNC + STATE_JS + MAIN_JS + PRELOAD_JS;
  for (const lbl of ['perf:interval:fire', 'perf:raf:summary', 'perf:ipc:summary', 'perf:dom:summary', 'perf:long-task', 'perf:subscribe:summary']) {
    assert.ok(ALL_SRC.includes(lbl), `meas2 ラベル ${lbl} 消失`);
  }
  for (const lbl of ['hall:syncSlideshowFromState:call', 'hall:updatePipTimer:set', 'hall:applyHallPreStartState:apply', 'hall:clock-pause-label:visibility']) {
    assert.ok(ALL_SRC.includes(lbl), `症状確証ラベル ${lbl} 消失`);
  }
  assert.ok(RENDERER.includes('hall:hallTickState:reset'), 'hall:hallTickState:reset 消失（rc2 退行）');
  // 新規 rc4 ラベル
  assert.ok(RENDERER.includes('operator:applyPreStartState:apply'),
    '新規ラベル operator:applyPreStartState:apply が renderer.js に見つからない（Fix 4 未完了）');
});

// ============================================================
// T9: 致命バグ保護 5 件
// ============================================================
test('T9: 致命バグ保護 5 件完全維持', () => {
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'C.2.7-A: resetBlindProgressOnly 消失');
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/,
    'C.2.7-D: tournaments:setDisplaySettings ハンドラ消失');
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'C.1-A2: ensureEditorEditableState 消失');
  assert.match(AUDIO_JS, /resume/, 'C.1.7: audio.js resume 経路消失');
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/,
    'C.1.8: schedulePersistRuntime 消失');
});

// ============================================================
// T10: 副作用 — 既存 hall 側 applyHallPreStartState 関数本体 touch なし
// ============================================================
test('T10: 既存 hall 側 applyHallPreStartState 関数本体が完全保持', () => {
  // applyHallPreStartState の主要マーカー（v2.1.20-rc2 で追加された hallTickState reset 経路含む）
  const fnMatch = RENDERER.match(/function\s+applyHallPreStartState\s*\(\s*payload\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(fnMatch, 'applyHallPreStartState 関数本体抽出失敗');
  const body = fnMatch[1];
  // hall 専用ガード（v2.1.10 から維持）
  assert.match(body, /if\s*\(\s*window\.appRole\s*!==\s*['"]hall['"]\s*\)\s*return/,
    'applyHallPreStartState の hall 専用ガード消失（既存ロジック touch 検知）');
  // rc2 で追加した hallTickState reset 経路
  assert.match(body, /trigger:\s*['"]applyHallPreStartState-inactive['"]/,
    'applyHallPreStartState の rc2 hallTickState reset 経路消失（既存ロジック touch 検知）');
  // v2.1.15 ① 根治: isPaused 受信経路（hall 側専用、rc4 で touch しないこと）
  assert.match(body, /hallPreStartState\.isPaused\s*=\s*isPaused/,
    'applyHallPreStartState の v2.1.15 isPaused 経路消失');
});

console.log(`\nv242 operator-prestart-receiver: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
