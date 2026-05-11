/**
 * v2.1.20-rc2 静的解析テスト — HDMI 抜き差し時の hallTickState 残存対策（defensive init 3 箇所）
 *
 *   Fix 1: applyTimerStateToTimer hall 経路の非 RUNNING/BREAK パスで hallTickState 明示リセット
 *   Fix 2: applyHallPreStartState の isActive=false 経路で hallTickState IDLE 正規化
 *   Fix 3: hall window 起動経路で hallTickState 全フィールド明示初期化
 *   Fix 4: 新規確証ラベル `hall:hallTickState:reset` 発火確認（trigger 3 種）
 *
 *   v2.1.20-rc1 軽量化機構 + v2.1.19 重さ根治機構 + 計測機構 完全保持
 *   致命バグ保護 5 件すべて完全無傷
 *
 * 実行: node tests/v240-hall-tickstate-reset.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT       = path.join(__dirname, '..');
const PKG        = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
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

// balanced-brace extraction helper
function extractBalancedBlock(source, startIdx) {
  let depth = 0;
  let inStr = false;
  let strCh = '';
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = startIdx; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i++; } continue; }
    if (inStr) { if (ch === '\\') { i++; continue; } if (ch === strCh) inStr = false; continue; }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === '\'' || ch === '`') { inStr = true; strCh = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return source.slice(startIdx, i + 1); }
  }
  return null;
}

// 関数定義行から「関数本体の先頭 `{`」位置を返す（パラメータリスト内の `{}` を skip）
function findFunctionBodyBraceStart(source, fnSignatureIdx) {
  // 'function name(' の `(` を見つけ、対応する `)` の直後の `{` を返す
  const parenStart = source.indexOf('(', fnSignatureIdx);
  if (parenStart < 0) return -1;
  let depth = 0;
  let inStr = false, strCh = '';
  for (let i = parenStart; i < source.length; i++) {
    const ch = source[i];
    if (inStr) { if (ch === '\\') { i++; continue; } if (ch === strCh) inStr = false; continue; }
    if (ch === '"' || ch === '\'' || ch === '`') { inStr = true; strCh = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) { return source.indexOf('{', i); } }
  }
  return -1;
}

// ============================================================
// T1: package.json.version === '2.1.20-rc4'
// ============================================================
test('T1: package.json.version === 2.1.20-rc3', () => {
  assert.equal(PKG.version, '2.1.20-rc4', `期待 2.1.20-rc3, 実際 ${PKG.version}`);
});

// ============================================================
// T2: Fix 1 — applyTimerStateToTimer hall 経路で hallTickState リセット代入存在
// ============================================================
test('T2: applyTimerStateToTimer 内の hall 非 RUNNING/BREAK 経路に hallTickState リセット代入存在', () => {
  const fnStart = RENDERER.indexOf('function applyTimerStateToTimer(');
  assert.ok(fnStart >= 0, 'applyTimerStateToTimer 関数定義が見つからない');
  const braceStart = findFunctionBodyBraceStart(RENDERER, fnStart);
  const block = extractBalancedBlock(RENDERER, braceStart);
  assert.ok(block, 'applyTimerStateToTimer 関数ブロック抽出失敗');
  // hallTickState.startedAtMs = 0 / status = 0 / isActive = false の 3 種代入存在
  const resetMatches = block.match(/hallTickState\.startedAtMs\s*=\s*0/g) || [];
  assert.ok(resetMatches.length >= 2,
    `applyTimerStateToTimer 内に hallTickState.startedAtMs = 0 代入が ${resetMatches.length} 件しかない（Fix 1 未完了、複数経路必須）`);
  assert.match(block, /hallTickState\.status\s*=\s*0/,
    'applyTimerStateToTimer 内に hallTickState.status = 0 代入なし');
  assert.match(block, /hallTickState\.isActive\s*=\s*false/,
    'applyTimerStateToTimer 内に hallTickState.isActive = false 代入なし');
});

// ============================================================
// T3: Fix 1 — rollingLog 経由 `hall:hallTickState:reset` の trigger 'applyTimerStateToTimer-non-running' 呼出存在
// ============================================================
test('T3: hall:hallTickState:reset の trigger applyTimerStateToTimer-non-running 呼出存在', () => {
  assert.match(RENDERER,
    /window\.api\?\.log\?\.write\?\.\s*\(\s*['"]hall:hallTickState:reset['"][^)]*trigger:\s*['"]applyTimerStateToTimer-non-running['"]/,
    'hall:hallTickState:reset の trigger applyTimerStateToTimer-non-running 呼出が見つからない（Fix 1 未完了）');
});

// ============================================================
// T4: Fix 2 — applyHallPreStartState isActive=false 経路で hallTickState 残存チェック + リセット
// ============================================================
test('T4: applyHallPreStartState 内の isActive=false 経路に hallTickState リセット条件分岐 + 代入存在', () => {
  const fnStart = RENDERER.indexOf('function applyHallPreStartState(payload)');
  assert.ok(fnStart >= 0, 'applyHallPreStartState 関数定義が見つからない');
  const braceStart = RENDERER.indexOf('{', fnStart);
  const block = extractBalancedBlock(RENDERER, braceStart);
  assert.ok(block, 'applyHallPreStartState 関数ブロック抽出失敗');
  // hallTickState.isActive || hallTickState.status !== 0 || hallTickState.startedAtMs !== 0 の条件分岐
  assert.match(block,
    /if\s*\(\s*hallTickState\.isActive\s*\|\|\s*hallTickState\.status\s*!==\s*0\s*\|\|\s*hallTickState\.startedAtMs\s*!==\s*0\s*\)/,
    'applyHallPreStartState 内に hallTickState 残存チェック条件分岐が見つからない（Fix 2 未完了）');
  // 条件内に hallTickState.startedAtMs = 0 / status = 0 / isActive = false 代入
  assert.match(block, /hallTickState\.startedAtMs\s*=\s*0/,
    'applyHallPreStartState 内に hallTickState.startedAtMs = 0 代入なし');
  assert.match(block, /hallTickState\.isActive\s*=\s*false/,
    'applyHallPreStartState 内に hallTickState.isActive = false 代入なし');
});

// ============================================================
// T5: Fix 2 — hall:hallTickState:reset の trigger 'applyHallPreStartState-inactive' 呼出存在
// ============================================================
test('T5: hall:hallTickState:reset の trigger applyHallPreStartState-inactive 呼出存在', () => {
  assert.match(RENDERER,
    /window\.api\?\.log\?\.write\?\.\s*\(\s*['"]hall:hallTickState:reset['"][^)]*trigger:\s*['"]applyHallPreStartState-inactive['"]/,
    'hall:hallTickState:reset の trigger applyHallPreStartState-inactive 呼出が見つからない（Fix 2 未完了）');
});

// ============================================================
// T6: Fix 3 — hall 起動経路で hallTickState 全フィールド明示初期化 + rollingLog
// ============================================================
test('T6: hall 起動経路（appRole === hall 直後）に hallTickState 全フィールド明示初期化 + trigger hall-window-init', () => {
  // `if (__appRole === 'hall') {` 直後 500 文字以内に hallTickState 各フィールド初期化 + reset ログ
  const idx = RENDERER.indexOf("if (__appRole === 'hall') {");
  assert.ok(idx > 0, 'hall 起動分岐 `if (__appRole === \'hall\')` が見つからない');
  // 開きブレース直後の初期化ブロック（コメント込で 1000 文字以内）を切り出す
  const window1000 = RENDERER.slice(idx, idx + 1500);
  assert.match(window1000, /hallTickState\.isActive\s*=\s*false/,
    'hall 起動経路に hallTickState.isActive = false 初期化なし');
  assert.match(window1000, /hallTickState\.status\s*=\s*0/,
    'hall 起動経路に hallTickState.status = 0 初期化なし');
  assert.match(window1000, /hallTickState\.startedAtMs\s*=\s*0/,
    'hall 起動経路に hallTickState.startedAtMs = 0 初期化なし');
  assert.match(window1000, /hallTickState\.totalMs\s*=\s*0/,
    'hall 起動経路に hallTickState.totalMs = 0 初期化なし');
  assert.match(window1000, /hallTickState\.rafId\s*=\s*null/,
    'hall 起動経路に hallTickState.rafId = null 初期化なし');
  // trigger 'hall-window-init' のログ呼出
  assert.match(window1000,
    /window\.api\?\.log\?\.write\?\.\s*\(\s*['"]hall:hallTickState:reset['"][^)]*trigger:\s*['"]hall-window-init['"]/,
    'hall 起動経路に trigger hall-window-init の hall:hallTickState:reset ログなし（Fix 3 未完了）');
});

// ============================================================
// T7: rc1 機構保持 — Fix 1（setState 撤廃）+ DocumentFragment + memo + CSS 統一
// ============================================================
test('T7: v2.1.20-rc1 軽量化機構（setState 撤廃 / DocumentFragment / memoized / CSS 統一）完全保持', () => {
  // renderHallTickFrame 内 setState({...remainingMs...}) 0 件
  const fnStart = RENDERER.indexOf('function renderHallTickFrame()');
  const braceStart = RENDERER.indexOf('{', fnStart);
  const block = extractBalancedBlock(RENDERER, braceStart);
  const stripped = block
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(stripped, /setState\s*\(\s*\{[^}]*remainingMs/,
    'renderHallTickFrame に setState({...remainingMs...}) が残存（rc1 Fix 1 退行）');
  // renderTime + syncSlideshowFromState 直接呼出
  assert.match(block, /renderTime\s*\(\s*remainingMs\s*\)/,
    'renderHallTickFrame に renderTime(remainingMs) 直接呼出なし（rc1 Fix 1 退行）');
  assert.match(block, /syncSlideshowFromState\s*\(\s*remainingMs\s*\)/,
    'renderHallTickFrame に syncSlideshowFromState(remainingMs) 直接呼出なし（rc1 Fix 1 退行）');
  // DocumentFragment 経由
  const renderListStart = RENDERER.indexOf('async function renderTournamentList(prefetched)');
  const rlBraceStart = RENDERER.indexOf('{', renderListStart);
  const rlBlock = extractBalancedBlock(RENDERER, rlBraceStart);
  assert.match(rlBlock, /document\.createDocumentFragment\s*\(\s*\)/,
    'renderTournamentList に DocumentFragment 経由構築なし（rc1 Fix 2-A 退行）');
  assert.match(rlBlock, /fragment\.appendChild\s*\(/,
    'renderTournamentList に fragment.appendChild なし');
  // computeLiveTimerStateMemoized
  assert.match(RENDERER, /function\s+computeLiveTimerStateMemoized\s*\(/,
    'computeLiveTimerStateMemoized 関数なし（rc1 Fix 2-B 退行）');
  assert.match(RENDERER, /const\s+_computeLiveTimerStateMemo\s*=\s*new\s+WeakMap/,
    '_computeLiveTimerStateMemo WeakMap なし');
  // CSS Fix 4-A
  assert.match(STYLE_CSS,
    /\.clock\[data-prestart-paused="true"\]\s+\.clock__pause-label\s*\{[^}]*opacity\s*:\s*1/,
    'CSS Fix 4-A の .clock[data-prestart-paused="true"] .clock__pause-label opacity: 1 ルールなし（rc1 Fix 4 退行）');
});

// ============================================================
// T8: v2.1.19 機構保持 — _tournamentsListDedup / _shouldRefreshListByThrottle / setInterval 撤廃 / dedup 12 件以上
// ============================================================
test('T8: v2.1.19 重さ根治機構（_tournamentsListDedup / _shouldRefreshListByThrottle / setInterval 撤廃）完全保持', () => {
  assert.match(RENDERER, /async\s+function\s+_tournamentsListDedup\s*\(\s*\)\s*\{/,
    '_tournamentsListDedup 関数定義消失');
  assert.match(RENDERER, /function\s+_shouldRefreshListByThrottle\s*\(\s*\)\s*\{/,
    '_shouldRefreshListByThrottle 関数定義消失');
  const stripped = RENDERER.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /setInterval\s*\(\s*(?:\([^)]*\)\s*=>\s*\{[\s\S]{0,200}?renderTournamentList[\s\S]{0,200}?\}|renderTournamentList)[\s\S]{0,80}?,\s*1000\s*\)/;
  assert.doesNotMatch(stripped, re, 'setInterval(renderTournamentList, 1000) が残存（v2.1.19 退行）');
  const directCalls = RENDERER.match(/await\s+window\.api\??\.?tournaments\??\.?list\??\.?\(\)/g) || [];
  assert.equal(directCalls.length, 0, `直接 list 呼出 ${directCalls.length} 件残存`);
  const dedupCalls = (RENDERER.match(/_tournamentsListDedup\s*\(\)/g) || []).length;
  assert.ok(dedupCalls >= 12, `_tournamentsListDedup() 呼出 ${dedupCalls} 件しかない（12 件以上必要）`);
});

// ============================================================
// T9: 計測機構保持 — meas-build-badge + meas2 + 症状確証 4 + 新規 hall:hallTickState:reset
// ============================================================
test('T9: 計測機構（バッジ + meas2 6 カテゴリ + 症状確証 4 ラベル + 新規 hall:hallTickState:reset）完全保持', () => {
  assert.match(INDEX_HTML, /<div\s+id="meas-build-badge">\s*計測ビルド\s*<\/div>/,
    'meas-build-badge HTML 消失');
  assert.ok(STYLE_CSS.includes('#meas-build-badge'), '#meas-build-badge CSS 消失');
  const ALL_SRC = RENDERER + DUAL_SYNC + STATE_JS + MAIN_JS + PRELOAD_JS;
  const meas2Labels = ['perf:interval:fire', 'perf:raf:summary', 'perf:ipc:summary', 'perf:dom:summary', 'perf:long-task', 'perf:subscribe:summary'];
  for (const lbl of meas2Labels) {
    assert.ok(ALL_SRC.includes(lbl), `meas2 ラベル ${lbl} 消失`);
  }
  const symptomLabels = [
    'hall:syncSlideshowFromState:call',
    'hall:updatePipTimer:set',
    'hall:applyHallPreStartState:apply',
    'hall:clock-pause-label:visibility'
  ];
  for (const lbl of symptomLabels) {
    assert.ok(ALL_SRC.includes(lbl), `症状確証ラベル ${lbl} 消失`);
  }
  // 新規 hall:hallTickState:reset が renderer.js に存在
  assert.ok(RENDERER.includes('hall:hallTickState:reset'),
    '新規ラベル hall:hallTickState:reset が renderer.js に見つからない（Fix 4 未完了）');
  // trigger 3 種すべて存在
  const triggers = ['applyTimerStateToTimer-non-running', 'applyHallPreStartState-inactive', 'hall-window-init'];
  for (const tg of triggers) {
    assert.ok(RENDERER.includes(`'${tg}'`),
      `hall:hallTickState:reset trigger '${tg}' が見つからない`);
  }
});

// ============================================================
// T10: 致命バグ保護 5 件 grep 確認
// ============================================================
test('T10: 致命バグ保護 5 件完全維持', () => {
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
  assert.match(RENDERER,
    /(?:setInterval\s*\(\s*periodicPersistAllRunning\s*,\s*5000\s*\)|_wrappedSetInterval\s*\(\s*_IntervalLabel\.PERIODIC_PERSIST\s*,\s*periodicPersistAllRunning\s*,\s*5000\s*\))/,
    'C.1.8: 主犯 2 (periodicPersistAllRunning 5 秒 setInterval) 消失');
});

console.log(`\nv240 hall-tickstate-reset: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
