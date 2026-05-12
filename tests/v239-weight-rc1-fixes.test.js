/**
 * v2.1.20-rc1 静的解析テスト — 重さ真因対処 + 症状 1/2 修正、計測機構保持
 *
 *   Fix 1: renderHallTickFrame の setState({remainingMs}) 撤廃 + DOM 直接書込
 *   Fix 2-A: renderTournamentList の DocumentFragment 化
 *   Fix 2-B: computeLiveTimerStateMemoized + _computeLiveTimerStateMemo WeakMap
 *   Fix 3: syncSlideshowFromState の hall PRE_START 保険ガード
 *   Fix 4-A: CSS で PRE_START 一時停止時も .clock__pause-label を表示
 *   Fix 4-B: 旧 [data-role="hall"] .clock[data-prestart-paused="true"]::after ブロック撤去
 *   v2.1.19 重さ根治機構 + v2.1.20-meas1 計測機構 完全保持
 *
 * 実行: node tests/v239-weight-rc1-fixes.test.js
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

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// balanced-brace extraction helper — 関数開始行から { ... } 全体を切り出す
function extractBalancedBlock(source, startIdx) {
  let depth = 0;
  let inStr = false;
  let strCh = '';
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = startIdx; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === strCh) inStr = false;
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === '\'' || ch === '`') { inStr = true; strCh = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(startIdx, i + 1);
    }
  }
  return null;
}

// ============================================================
// T1: package.json.version === '2.1.20-rc10'
// ============================================================
test('T1: package.json.version === 2.1.20-rc1', () => {
  assert.equal(PKG.version, '2.1.20-rc10', `期待 2.1.20-rc1, 実際 ${PKG.version}`);
});

// ============================================================
// T2: Fix 1 — renderHallTickFrame 内で setState({remainingMs}) 呼出 0 件
// ============================================================
test('T2: renderHallTickFrame 内に setState({...remainingMs...}) 呼出が存在しない（60Hz 主犯撤廃）', () => {
  const fnStart = RENDERER.indexOf('function renderHallTickFrame()');
  assert.ok(fnStart >= 0, 'renderHallTickFrame 関数定義が見つからない');
  const braceStart = RENDERER.indexOf('{', fnStart);
  const block = extractBalancedBlock(RENDERER, braceStart);
  assert.ok(block, 'renderHallTickFrame 関数ブロックの抽出失敗');
  // コメント剥離してから検索（コメント内の説明文に setState を含むため）
  const stripped = block
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(stripped, /setState\s*\(\s*\{[^}]*remainingMs/,
    'renderHallTickFrame 内に setState({...remainingMs...}) が残存（Fix 1 撤廃未完了）');
});

// ============================================================
// T3: Fix 1 — renderHallTickFrame 内に renderTime / syncSlideshowFromState の直接呼出が存在
// ============================================================
test('T3: renderHallTickFrame 内に renderTime + syncSlideshowFromState の直接呼出が存在（DOM 直接書込）', () => {
  const fnStart = RENDERER.indexOf('function renderHallTickFrame()');
  const braceStart = RENDERER.indexOf('{', fnStart);
  const block = extractBalancedBlock(RENDERER, braceStart);
  assert.match(block, /renderTime\s*\(\s*remainingMs\s*\)/,
    'renderHallTickFrame 内に renderTime(remainingMs) の直接呼出が見つからない');
  assert.match(block, /syncSlideshowFromState\s*\(\s*remainingMs\s*\)/,
    'renderHallTickFrame 内に syncSlideshowFromState(remainingMs) の直接呼出が見つからない');
});

// ============================================================
// T4: Fix 2-A — renderTournamentList 内に DocumentFragment 経由構築
// ============================================================
test('T4: renderTournamentList 内に createDocumentFragment + fragment.appendChild 形式が存在', () => {
  const fnStart = RENDERER.indexOf('async function renderTournamentList(prefetched)');
  assert.ok(fnStart >= 0, 'renderTournamentList 関数定義が見つからない');
  const braceStart = RENDERER.indexOf('{', fnStart);
  const block = extractBalancedBlock(RENDERER, braceStart);
  assert.ok(block, 'renderTournamentList 関数ブロックの抽出失敗');
  assert.match(block, /document\.createDocumentFragment\s*\(\s*\)/,
    'renderTournamentList 内に createDocumentFragment() 呼出が見つからない（Fix 2-A 未完了）');
  assert.match(block, /fragment\.appendChild\s*\(/,
    'renderTournamentList 内に fragment.appendChild(...) 形式が見つからない');
  assert.match(block, /el\.tournamentList\.appendChild\s*\(\s*fragment\s*\)/,
    'el.tournamentList.appendChild(fragment) の最終 1 回 reflow 構築が見つからない');
});

// ============================================================
// T5: Fix 2-B — computeLiveTimerStateMemoized 関数 + WeakMap 定義
// ============================================================
test('T5: _computeLiveTimerStateMemo WeakMap + computeLiveTimerStateMemoized 関数定義が存在', () => {
  assert.match(RENDERER, /const\s+_computeLiveTimerStateMemo\s*=\s*new\s+WeakMap\s*\(\s*\)/,
    '_computeLiveTimerStateMemo WeakMap 定義が見つからない（Fix 2-B 未完了）');
  assert.match(RENDERER, /function\s+computeLiveTimerStateMemoized\s*\(/,
    'computeLiveTimerStateMemoized 関数定義が見つからない');
  // renderTournamentList 内で memoized 版を呼んでいることを確認
  const fnStart = RENDERER.indexOf('async function renderTournamentList(prefetched)');
  const braceStart = RENDERER.indexOf('{', fnStart);
  const block = extractBalancedBlock(RENDERER, braceStart);
  assert.match(block, /computeLiveTimerStateMemoized\s*\(/,
    'renderTournamentList 内で computeLiveTimerStateMemoized を呼出していない');
});

// ============================================================
// T6: v2.1.20-rc3 で rc1 Fix 3 ガードは撤去 — assertion 反転（ガード不在 + 無条件呼出存在）
// ============================================================
test('T6: subscribe 内 syncSlideshowFromState 呼出は無条件（rc3 で rc1 Fix 3 ガード撤去）', () => {
  // v2.1.20-rc3: rc1 Fix 3 ガードが過剰防御で PRE_START 中のスライドショー始動経路自体を止めていた退行を解消。
  //   ガード `if (!(window.appRole === 'hall' && ... hallPreStartState.isActive))` は subscribe 内では不在、
  //   subscribe からは無条件で syncSlideshowFromState(state.remainingMs) が呼ばれる。
  // ガード形式が subscribe 内に残存していないことを確認（PRE_START ガード + syncSlideshow の隣接組合せ）
  assert.doesNotMatch(RENDERER,
    /if\s*\(\s*!\s*\(\s*window\.appRole\s*===\s*['"]hall['"][\s\S]{0,200}?hallPreStartState\.isActive[\s\S]{0,80}?\)\s*\)\s*\{[\s\S]{0,200}?syncSlideshowFromState\s*\(\s*state\.remainingMs\s*\)/,
    'subscribe 内に rc1 Fix 3 の PRE_START ガードが残存（rc3 で撤去必須）');
  // 無条件呼出は存在（行頭または直前 try/catch ブロックの後に `  syncSlideshowFromState(state.remainingMs)`）
  assert.match(RENDERER,
    /\n\s*syncSlideshowFromState\s*\(\s*state\.remainingMs\s*\)\s*;/,
    'subscribe 内 syncSlideshowFromState(state.remainingMs) の無条件呼出が見つからない');
});

// ============================================================
// T7: Fix 4-A — style.css に PRE_START 一時停止時の pause-label 表示ルール
// ============================================================
test('T7: style.css に .clock[data-prestart-paused="true"] .clock__pause-label { opacity: 1 } 存在', () => {
  assert.match(STYLE_CSS,
    /\.clock\[data-prestart-paused="true"\]\s+\.clock__pause-label\s*\{[^}]*opacity\s*:\s*1/,
    'style.css に PRE_START 一時停止時の .clock__pause-label { opacity: 1 } が見つからない（Fix 4-A 未完了）');
  // ::before のオーバーレイも存在
  assert.match(STYLE_CSS,
    /\.clock\[data-prestart-paused="true"\]::before\s*\{[^}]*background-color\s*:\s*rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\.5\s*\)/,
    'style.css に PRE_START 一時停止時の ::before オーバーレイが見つからない');
});

// ============================================================
// T8: Fix 4-B — 旧 [data-role="hall"] .clock[data-prestart-paused="true"]::after ブロック不在
// ============================================================
test('T8: style.css の旧 [data-role="hall"] .clock[data-prestart-paused="true"]::after ブロック撤去', () => {
  // 旧ブロック特徴: content: '一時停止中' + ::after + data-role="hall"
  // 左下小さい表示の元なので撤去確認
  const hasOldBlock = /\[data-role="hall"\]\s+\.clock\[data-prestart-paused="true"\]::after\s*\{/.test(STYLE_CSS);
  assert.ok(!hasOldBlock,
    'style.css に旧 [data-role="hall"] .clock[data-prestart-paused="true"]::after ブロックが残存（Fix 4-B 撤去未完了）');
});

// ============================================================
// T9: v2.1.19 機構保持 — _tournamentsListDedup / _shouldRefreshListByThrottle / setInterval 撤廃 / 直接 list 呼出 0 件
// ============================================================
test('T9: v2.1.19 重さ根治機構（_tournamentsListDedup / _shouldRefreshListByThrottle / setInterval 撤廃）完全保持', () => {
  // dedup wrapper
  assert.match(RENDERER, /async\s+function\s+_tournamentsListDedup\s*\(\s*\)\s*\{/,
    '_tournamentsListDedup 関数定義が消失（rc1 では完全保持必須）');
  assert.match(RENDERER, /function\s+_shouldRefreshListByThrottle\s*\(\s*\)\s*\{/,
    '_shouldRefreshListByThrottle 関数定義が消失');
  assert.match(RENDERER, /let\s+_tournamentsListInFlight\s*=\s*null/,
    '_tournamentsListInFlight 変数定義が消失');
  // setInterval(renderTournamentList, 1000) 撤廃確認
  const stripped = RENDERER
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /setInterval\s*\(\s*(?:\([^)]*\)\s*=>\s*\{[\s\S]{0,200}?renderTournamentList[\s\S]{0,200}?\}|renderTournamentList)[\s\S]{0,80}?,\s*1000\s*\)/;
  assert.doesNotMatch(stripped, re,
    'setInterval(renderTournamentList, 1000) パターンが残存（rc1 では撤廃維持必須）');
  // 直接 list 呼出 0 件、dedup 経由 12 件以上
  const directCalls = RENDERER.match(/await\s+window\.api\??\.?tournaments\??\.?list\??\.?\(\)/g) || [];
  assert.equal(directCalls.length, 0,
    `await window.api.tournaments.list() 直接呼出が ${directCalls.length} 件残存（dedup 経由必須）`);
  const dedupCalls = (RENDERER.match(/_tournamentsListDedup\s*\(\)/g) || []).length;
  assert.ok(dedupCalls >= 12, `_tournamentsListDedup() 呼出が ${dedupCalls} 件しかない（12 件以上必要）`);
});

// ============================================================
// T10: 計測機構保持 — meas-build-badge + meas2 6 カテゴリ + 症状確証 4 ラベル
// ============================================================
test('T10: v2.1.20-meas1 計測機構（バッジ + meas2 6 カテゴリ + 症状確証 4 ラベル）完全保持', () => {
  // バッジ HTML / CSS
  assert.match(INDEX_HTML, /<div\s+id="meas-build-badge">\s*計測ビルド\s*<\/div>/,
    'index.html に meas-build-badge が消失（rc1 では保持必須）');
  assert.ok(STYLE_CSS.includes('#meas-build-badge'),
    'style.css に #meas-build-badge セレクタが消失');
  // meas2 6 カテゴリ ラベル
  const ALL_SRC = RENDERER + DUAL_SYNC + STATE_JS + MAIN_JS + PRELOAD_JS;
  const meas2Labels = [
    'perf:interval:fire',
    'perf:raf:summary',
    'perf:ipc:summary',
    'perf:dom:summary',
    'perf:long-task',
    'perf:subscribe:summary'
  ];
  for (const lbl of meas2Labels) {
    assert.ok(ALL_SRC.includes(lbl),
      `meas2 ラベル ${lbl} が消失（rc1 では保持必須）`);
  }
  // 症状 1/2 真因確証 4 ラベル
  const symptomLabels = [
    'hall:syncSlideshowFromState:call',
    'hall:updatePipTimer:set',
    'hall:applyHallPreStartState:apply',
    'hall:clock-pause-label:visibility'
  ];
  for (const lbl of symptomLabels) {
    assert.ok(ALL_SRC.includes(lbl),
      `症状確証ラベル ${lbl} が消失（rc1 では保持必須、効果確認用）`);
  }
});

// ============================================================
// T11: 致命バグ保護 5 件 + v2.1.6〜v2.1.19 機構 grep 確認
// ============================================================
test('T11: 致命バグ保護 5 件 + v2.1.6〜v2.1.19 機構完全保持', () => {
  // C.2.7-A: resetBlindProgressOnly が定義 + handleReset とは別関数
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    '致命バグ保護 C.2.7-A: resetBlindProgressOnly 関数が消失');
  // C.2.7-D: main.js に timerState destructure 除外（tournaments:setDisplaySettings 経路）
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/,
    '致命バグ保護 C.2.7-D: tournaments:setDisplaySettings ハンドラが消失');
  // C.1-A2 / C.1.4-fix1: ensureEditorEditableState 防御
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    '致命バグ保護 C.1-A2: ensureEditorEditableState 関数が消失');
  // C.1.7: AudioContext suspend 防御
  const AUDIO_JS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');
  assert.match(AUDIO_JS, /resume/,
    '致命バグ保護 C.1.7: audio.js の AudioContext resume 経路が消失');
  // C.1.8: schedulePersistRuntime + 5 秒 setInterval(periodicPersistAllRunning)
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/,
    '致命バグ保護 C.1.8: schedulePersistRuntime 関数が消失');
  assert.match(RENDERER,
    /(?:setInterval\s*\(\s*periodicPersistAllRunning\s*,\s*5000\s*\)|_wrappedSetInterval\s*\(\s*_IntervalLabel\.PERIODIC_PERSIST\s*,\s*periodicPersistAllRunning\s*,\s*5000\s*\))/,
    '致命バグ保護 C.1.8: 主犯 2（periodicPersistAllRunning 5 秒 setInterval）が消失');
});

console.log(`\nv239 weight-rc1-fixes: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
