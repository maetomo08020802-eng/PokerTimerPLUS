/**
 * v2.1.20-rc3 静的解析テスト — スライドショー始動復活 + renderTournamentList Promise dedup
 *
 *   Fix 1: rc1 Fix 3（subscribe 内 syncSlideshowFromState の PRE_START ガード）撤去
 *   Fix 2: renderTournamentList を Promise dedup ラッパで包む（2 倍表示 race 根治）
 *   rc1 / rc2 / 計測機構 + 致命バグ保護 5 件 完全保持
 *
 * 実行: node tests/v241-rc3-fixes.test.js
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

// ============================================================
// T1: package.json.version === '2.1.20-rc10'
// ============================================================
test('T1: package.json.version === 2.1.20-rc3', () => {
  assert.equal(PKG.version, '2.1.20-rc10', `期待 2.1.20-rc3, 実際 ${PKG.version}`);
});

// ============================================================
// T2: Fix 1 — rc1 Fix 3 ガード撤去 + 無条件呼出存在
// ============================================================
test('T2: subscribe 内に rc1 Fix 3 の PRE_START ガード不在 + syncSlideshowFromState 無条件呼出存在', () => {
  // ガード形式（PRE_START active チェック + 隣接 syncSlideshow）が renderer.js に残存していないこと
  assert.doesNotMatch(RENDERER,
    /if\s*\(\s*!\s*\(\s*window\.appRole\s*===\s*['"]hall['"][\s\S]{0,200}?hallPreStartState\.isActive[\s\S]{0,80}?\)\s*\)\s*\{[\s\S]{0,200}?syncSlideshowFromState\s*\(\s*state\.remainingMs\s*\)/,
    'subscribe 内に rc1 Fix 3 の PRE_START ガードが残存（rc3 で撤去必須）');
  // 無条件呼出（行末 `;` 付き）が存在
  assert.match(RENDERER,
    /\n\s*syncSlideshowFromState\s*\(\s*state\.remainingMs\s*\)\s*;/,
    'subscribe 内 syncSlideshowFromState(state.remainingMs) の無条件呼出が見つからない（Fix 1 未完了）');
});

// ============================================================
// T3: Fix 2 — _renderTournamentListInFlight 変数 + renderTournamentListWithDedup 関数定義存在
// ============================================================
test('T3: _renderTournamentListInFlight 変数定義 + renderTournamentListWithDedup 関数定義存在', () => {
  assert.match(RENDERER, /let\s+_renderTournamentListInFlight\s*=\s*null/,
    '_renderTournamentListInFlight モジュールスコープ変数定義が見つからない（Fix 2 未完了）');
  assert.match(RENDERER, /function\s+renderTournamentListWithDedup\s*\(\s*prefetched\s*\)\s*\{/,
    'renderTournamentListWithDedup 関数定義が見つからない');
});

// ============================================================
// T4: Fix 2 — renderTournamentList 直接呼出は関数定義 + ラッパ内除き 0 件、すべて WithDedup 経由
// ============================================================
test('T4: renderTournamentList 直接呼出（定義 + ラッパ内除く）0 件、WithDedup 経由 6 件以上', () => {
  // コメント剥離後に全 renderTournamentList( 出現を抽出（コメント内の旧コード説明等を除外）
  const stripped = RENDERER.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const allMatches = stripped.match(/renderTournamentList\s*\(/g) || [];
  // 関数定義行 + ラッパ内呼出 (renderTournamentList(prefetched).finally) を除外
  const fnDefMatches = (stripped.match(/async\s+function\s+renderTournamentList\s*\(/g) || []).length;
  const wrapperInternalMatches = (stripped.match(/_renderTournamentListInFlight\s*=\s*renderTournamentList\s*\(/g) || []).length;
  const directCalls = allMatches.length - fnDefMatches - wrapperInternalMatches;
  assert.equal(directCalls, 0,
    `renderTournamentList 直接呼出が ${directCalls} 件残存（Fix 2 未完了、WithDedup ラッパ経由に統一必須）`);
  // WithDedup 経由呼出 6 件以上（関数定義除く）
  const withDedupAll = (RENDERER.match(/renderTournamentListWithDedup\s*\(/g) || []).length;
  const withDedupDef = (RENDERER.match(/function\s+renderTournamentListWithDedup\s*\(/g) || []).length;
  const withDedupCalls = withDedupAll - withDedupDef;
  assert.ok(withDedupCalls >= 6,
    `renderTournamentListWithDedup 呼出が ${withDedupCalls} 件しかない（6 件以上必要）`);
});

// ============================================================
// T5: Fix 2 — ラッパが _renderTournamentListInFlight チェック + finally reset ロジック
// ============================================================
test('T5: renderTournamentListWithDedup が _renderTournamentListInFlight チェック + finally reset', () => {
  // 関数本体抽出（balanced-brace）
  const startRe = /function\s+renderTournamentListWithDedup\s*\(\s*prefetched\s*\)\s*\{/;
  const m = RENDERER.match(startRe);
  assert.ok(m, 'renderTournamentListWithDedup 関数定義が見つからない');
  const startIdx = m.index + m[0].length - 1;
  let depth = 1, i = startIdx + 1;
  while (i < RENDERER.length && depth > 0) {
    if (RENDERER[i] === '{') depth++; else if (RENDERER[i] === '}') depth--;
    i++;
  }
  assert.ok(depth === 0, 'renderTournamentListWithDedup 関数本体の抽出失敗');
  const body = RENDERER.slice(startIdx, i);
  // _renderTournamentListInFlight チェック → 既存 Promise return
  assert.match(body, /if\s*\(\s*_renderTournamentListInFlight\s*\)\s*return\s+_renderTournamentListInFlight/,
    '_renderTournamentListInFlight in-flight チェック + return が見つからない');
  // renderTournamentList(prefetched).finally で null reset
  assert.match(body, /renderTournamentList\s*\(\s*prefetched\s*\)\.finally\s*\(\s*\(\s*\)\s*=>\s*\{\s*_renderTournamentListInFlight\s*=\s*null\s*;?\s*\}\s*\)/,
    '.finally で _renderTournamentListInFlight = null リセット処理が見つからない');
});

// ============================================================
// T6: rc1 / rc2 機構保持
// ============================================================
test('T6: rc1 / rc2 機構保持（dedup / throttle / setInterval 撤廃 / DocumentFragment / memo / CSS 統一 / hallTickState reset 3 経路）', () => {
  // v2.1.19: _tournamentsListDedup
  assert.match(RENDERER, /async\s+function\s+_tournamentsListDedup\s*\(\s*\)\s*\{/,
    'v2.1.19 _tournamentsListDedup 関数消失');
  assert.match(RENDERER, /function\s+_shouldRefreshListByThrottle\s*\(\s*\)\s*\{/,
    'v2.1.19 _shouldRefreshListByThrottle 関数消失');
  // setInterval(renderTournamentList) 撤廃継続
  const stripped = RENDERER.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /setInterval\s*\(\s*(?:\([^)]*\)\s*=>\s*\{[\s\S]{0,200}?renderTournamentList[\s\S]{0,200}?\}|renderTournamentList)[\s\S]{0,80}?,\s*1000\s*\)/;
  assert.doesNotMatch(stripped, re,
    'setInterval(renderTournamentList, 1000) が残存（v2.1.19 退行）');
  // rc1 Fix 1: renderHallTickFrame の setState 撤廃継続
  const fnStart = RENDERER.indexOf('function renderHallTickFrame()');
  assert.ok(fnStart >= 0);
  const fnEnd = RENDERER.indexOf('\n}\n', fnStart);
  const fnBlock = stripped.slice(stripped.indexOf('function renderHallTickFrame()'),
    stripped.indexOf('function renderHallTickFrame()') + (fnEnd - fnStart));
  assert.doesNotMatch(fnBlock, /setState\s*\(\s*\{[^}]*remainingMs/,
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
    'rc1 Fix 4 退行: .clock[data-prestart-paused="true"] .clock__pause-label opacity:1 ルール消失');
  // rc2: hallTickState reset 3 trigger すべて
  const triggers = ['applyTimerStateToTimer-non-running', 'applyHallPreStartState-inactive', 'hall-window-init'];
  for (const tg of triggers) {
    assert.ok(RENDERER.includes(`'${tg}'`),
      `rc2 退行: hall:hallTickState:reset trigger '${tg}' 消失`);
  }
});

// ============================================================
// T7: 計測機構保持
// ============================================================
test('T7: 計測機構（meas-build-badge + perf 系 + 症状確証 4 + hall:hallTickState:reset）完全保持', () => {
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
  assert.ok(RENDERER.includes('hall:hallTickState:reset'),
    'hall:hallTickState:reset ラベル消失（rc2 退行）');
});

// ============================================================
// T8: 致命バグ保護 5 件
// ============================================================
test('T8: 致命バグ保護 5 件完全維持 + v2.1.6〜v2.1.19 機構保持', () => {
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
  // v2.1.19 dedup 12 件以上
  const dedupCalls = (RENDERER.match(/_tournamentsListDedup\s*\(\)/g) || []).length;
  assert.ok(dedupCalls >= 12, `_tournamentsListDedup() 呼出 ${dedupCalls} 件しかない（12 件以上必要）`);
});

console.log(`\nv241 rc3-fixes: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
