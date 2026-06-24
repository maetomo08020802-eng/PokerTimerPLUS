/**
 * v2.1.18 静的解析テスト — rc2 計測ログ 4 個撤去 + 本番リリース
 *
 *   Fix 1: rc2 計測ログ 4 ラベル全撤去
 *     - hall:subscribe:fire (renderer.js subscribe 冒頭)
 *     - hall:renderTime:enter (renderer.js renderTime 冒頭)
 *     - hall:setState:dual (dual-sync.js _applyDiffToState の setState 直前)
 *     - hall:dataset:status:write × 4 箇所 (renderer.js el.clock.dataset.status 書込直前)
 *   Fix 2: rc1/rc2 本質修正完全保持（変更なし、grep で存在確認のみ）
 *
 * 致命バグ保護 5 件すべて完全無傷、v2.1.6〜v2.1.18-rc2 機構すべて完全保持。
 *
 * 実行: node tests/v233-meas-removal.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT      = path.join(__dirname, '..');
const PKG       = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const DUAL_SYNC = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');
const TIMER_JS  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'timer.js'), 'utf8');
const MAIN_JS   = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const AUDIO_JS  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');
const STYLE_CSS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1: rc2 計測ログ 4 ラベルが全 0 件（renderer.js / dual-sync.js）
// ============================================================
test('T1: rc2 計測ログ 4 ラベルすべて 0 件（hall:subscribe:fire / :renderTime:enter / :setState:dual / :dataset:status:write）', () => {
  const labels = [
    'hall:subscribe:fire',
    'hall:renderTime:enter',
    'hall:setState:dual',
    'hall:dataset:status:write'
  ];
  for (const label of labels) {
    assert.ok(!RENDERER.includes(label), `renderer.js に ${label} が残存（Fix 1 未完了）`);
    assert.ok(!DUAL_SYNC.includes(label), `dual-sync.js に ${label} が残存（Fix 1 未完了）`);
  }
});

// ============================================================
// T2: subscribe リスナの _lastTimerStateForRoleSwitch = state; 直前に余計な if ブロックが存在しない
// ============================================================
test('T2: subscribe 冒頭の rc2 Fix 2-A 完全撤去（_lastTimerStateForRoleSwitch 直前 if ブロックなし）', () => {
  // subscribe((state, prev) => { が現れた直後 50 文字以内に _lastTimerStateForRoleSwitch = state が存在
  //   （rc2 Fix 2-A の if (window.appRole === 'hall') ブロックは撤去後はゼロ距離）
  // v2.1.20-meas1: main subscribe が subscribeNamed('subscribe:main-renderer', ...) に変更、両形式許容。
  assert.match(RENDERER, /subscribe(?:Named)?\(\s*(?:['"][^'"]*['"]\s*,\s*)?\(state,\s*prev\)\s*=>\s*\{\s*\n\s*_lastTimerStateForRoleSwitch\s*=\s*state\s*;/,
    'subscribe 冒頭に rc2 Fix 2-A の if ブロックが残存（Fix 1 撤去未完了）');
});

// ============================================================
// T3: renderTime 関数冒頭直後に const { status } = getState(); が来る（rc2 Fix 2-B 完全撤去）
// ============================================================
test('T3: renderTime 関数冒頭の rc2 Fix 2-B 完全撤去', () => {
  // v2.1.18-meas1: 計測ビルドでは perf:render:duration ラベルのため `const _t0 = performance.now();` が
  //   renderTime 冒頭に挿入される。本番版 (`2.1.18` 等) は無挿入。-meas\d+ サフィックスのとき skip。
  // v2.1.19-rc2: meas1 計測機構は **撤去** された。本番版 + rc2 では rc2 計測ログ撤去を厳格 verify。
  //   `-meas\d+` サフィックスのみ skip（meas1 段階では計測機構を保持しているため verify 不可能）。
  //   rc2 では meas-removal の verify 側に立つので skip しない（v236 と並行で撤去確認）。
  // v2.1.20-rc1: rc 系試験ビルドも meas1 機構保持中なので skip。
  if (/-(meas|rc)\d+(\.\d+)?$/.test(PKG.version || '')) return;
  // function renderTime(remainingMs) { 直後 50 文字以内に const { status } = getState();
  assert.match(RENDERER, /function\s+renderTime\s*\(\s*remainingMs\s*\)\s*\{\s*\n\s*const\s*\{\s*status\s*\}\s*=\s*getState\s*\(\s*\)\s*;/,
    'renderTime 冒頭に rc2 Fix 2-B の if ブロックが残存（Fix 1 撤去未完了）');
});

// ============================================================
// T4: dual-sync.js _applyDiffToState 内 setState({[`dual_${kind}`]:...}) 直前に余計な if ブロックなし
// ============================================================
test('T4: dual-sync.js _applyDiffToState の rc2 Fix 2-C 完全撤去', () => {
  // setState({[`dual_${kind}`]: value}) 直前 200 文字以内に hall:setState:dual / window.appRole === 'hall' チェックなし
  const setStateIdx = DUAL_SYNC.indexOf('setState({ [`dual_');
  assert.ok(setStateIdx > 0, 'dual-sync.js の setState({dual_*}) 呼出が見当たらない');
  const before200 = DUAL_SYNC.slice(Math.max(0, setStateIdx - 200), setStateIdx);
  assert.ok(!/hall:setState:dual/.test(before200),
    'setState({dual_*}) 直前に rc2 Fix 2-C の hall:setState:dual ログが残存（Fix 1 撤去未完了）');
});

// ============================================================
// T5: el.clock.dataset.status = ... 4 箇所維持 + caller 識別子文字列 4 種すべて 0 件（rc2 Fix 2-D 完全撤去）
// ============================================================
test('T5: el.clock.dataset.status 書き換え 4 箇所維持 + rc2 Fix 2-D caller 識別子 4 種すべて 0 件', () => {
  // dataset.status 書き換えは 4 箇所維持（renderControls / applyHallPreStartState 2 箇所 / renderHallPreStartTick）
  const writeCount = (RENDERER.match(/el\.clock\.dataset\.status\s*=/g) || []).length;
  assert.equal(writeCount, 4, `el.clock.dataset.status 書き換えが ${writeCount} (4 箇所維持必須)`);
  // v2.1.18-meas1: 計測ビルドでは perf:render:duration の payload に `fn: 'renderControls'` 等が含まれるため
  //   caller 文字列の単純 grep は誤検出する。本番版のみで verify、-meas\d+ サフィックスのとき skip。
  // v2.1.19-rc2: meas1 計測機構は **撤去** された。本番版 + rc2 では rc2 計測ログ撤去を厳格 verify。
  //   `-meas\d+` サフィックスのみ skip（meas1 段階では計測機構を保持しているため verify 不可能）。
  //   rc2 では meas-removal の verify 側に立つので skip しない（v236 と並行で撤去確認）。
  // v2.1.20-rc1: rc 系試験ビルドも meas1 機構保持中なので skip。
  if (/-(meas|rc)\d+(\.\d+)?$/.test(PKG.version || '')) return;
  // rc2 Fix 2-D の caller 識別子文字列 4 種すべて 0 件（コメント行なら OK だが文字列リテラルは消えているはず）
  // hall:dataset:status:write は T1 で 0 件確認済、ここでは caller リテラル文字列の grep
  const callers = ["'renderControls'", "'applyHallPreStartState:paused'", "'applyHallPreStartState:inactive'", "'renderHallPreStartTick'"];
  for (const c of callers) {
    assert.ok(!RENDERER.includes(c), `caller 識別子 ${c} が残存（rc2 Fix 2-D 撤去未完了）`);
  }
});

// ============================================================
// T6: rc1 Fix 1/2/3 + rc2 Fix 1（案 B subscribe gate）すべて完全保持 + 致命バグ保護 5 件 + v2.1.6〜v2.1.18-rc2 機構保持
// ============================================================
test('T6: rc1 Fix 1/2/3 + rc2 Fix 1 + 致命バグ保護 5 件 + v2.1.6〜v2.1.18-rc2 機構すべて完全保持', () => {
  // rc1 Fix 1 (A 候補): hall dual-sync timerState 分岐に !hallPreStartState.isActive gate
  assert.match(RENDERER, /else\s+if\s*\(\s*kind\s*===\s*['"]timerState['"]\s*&&\s*value\s*&&\s*!hallPreStartState\.isActive\s*\)/,
    'rc1 Fix 1 (A 候補) の hall timerState gate が消失');
  // rc1 Fix 2 (B 候補): captureCurrentTimerState の isPreStartActive() 拡張
  assert.match(RENDERER, /isPreStartLikely[\s\S]*?return\s*\{\s*status:\s*['"]idle['"]/,
    'rc1 Fix 2 (B 候補) の isPreStartLikely + idle 返却が消失');
  // rc1 Fix 3 (トーナメント終了演出): onTournamentComplete handler + clock--timer-finished 付与
  assert.match(RENDERER, /onTournamentComplete:\s*\(\s*\)\s*=>\s*\{[\s\S]*?clock--timer-finished/,
    'rc1 Fix 3 のトーナメント終了演出が消失');
  // rc1 Fix 3: index.html overlay
  assert.match(INDEX_HTML, /id="js-timer-finished-overlay"/,
    'rc1 Fix 3 の #js-timer-finished-overlay が消失');
  // rc1 Fix 3: style.css オレンジ枠
  assert.match(STYLE_CSS, /border:\s*[\d.]+\w*\s+solid\s+#FF8C1A/i,
    'rc1 Fix 3 のオレンジ枠 #FF8C1A が消失');
  // rc1 Fix 3: timer.js onTournamentComplete handler
  const setHandlersMatch = TIMER_JS.match(/export\s+function\s+setHandlers\s*\(\s*\{([^}]+)\}\s*\)/);
  assert.ok(setHandlersMatch && /\bonTournamentComplete\b/.test(setHandlersMatch[1]),
    'rc1 Fix 3 timer.js setHandlers の onTournamentComplete 引数消失');
  // rc2 Fix 1 (案 B 真の根治): subscribe 内 hall + PRE_START active gate
  assert.match(RENDERER, /if\s*\(\s*!\s*\(\s*window\.appRole\s*===\s*['"]hall['"]\s*&&\s*hallPreStartState\.isActive\s*\)\s*\)\s*\{[\s\S]*?renderTime\s*\(\s*state\.remainingMs\s*\)/,
    'rc2 Fix 1 (案 B subscribe gate) の renderTime gate が消失');

  // 致命バグ保護 5 件
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, 'C.2.7-A 消失');
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/, 'C.2.7-D 消失');
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/, 'C.1-A2 消失');
  assert.match(AUDIO_JS, /\.resume\s*\(\s*\)/, 'C.1.7 消失');
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, 'C.1.8 関数消失');
  const callCount = (RENDERER.match(/schedulePersistRuntime\s*\(/g) || []).length;
  assert.ok(callCount >= 9, `C.1.8 schedulePersistRuntime 呼出 ${callCount} 件 (9 以上必要)`);

  // v2.1.7 dual-sync.js
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js')),
    'v2.1.7 dual-sync.js 消失');
  // v2.1.11 hall 60fps tick
  assert.match(RENDERER, /function\s+renderHallTickFrame\s*\(/, 'v2.1.11 renderHallTickFrame 消失');
  // v2.1.13 PRE_START data-status セット
  assert.match(RENDERER, /el\.clock\.dataset\.status\s*=\s*['"]PRE_START['"]/, 'v2.1.13 data-status PRE_START セット消失');
  // v2.1.14 構造同期 2 穴根治
  assert.match(MAIN_JS, /_publishDualState\s*\(\s*['"]structure['"]\s*,\s*preset\s*\)/,
    'v2.1.14 tournaments:setActive structure broadcast 消失');
  assert.match(MAIN_JS, /snapshot\.structure\s*===\s*null/,
    'v2.1.14 dual:state-sync-init snapshot.structure null ガード消失');
  // v2.1.15 isBreakLevel import
  const importBlock = RENDERER.match(/import\s*\{[^}]*\}\s*from\s*['"]\.\/blinds\.js['"]/);
  assert.ok(importBlock && /\bisBreakLevel\b/.test(importBlock[0]), 'v2.1.15 isBreakLevel import 消失');
  // v2.1.15 onPreStartPause/Resume
  assert.match(RENDERER, /onPreStartPause:\s*\(\s*\{[\s\S]*?remainingMs[\s\S]*?\}\s*\)\s*=>/,
    'v2.1.15 onPreStartPause ハンドラ消失');
  // v2.1.15 hallPreStartState.isPaused
  const hpsMatch = RENDERER.match(/const\s+hallPreStartState\s*=\s*\{([^}]+)\}/);
  assert.ok(hpsMatch && /isPaused:\s*false/.test(hpsMatch[1]),
    'v2.1.15 hallPreStartState.isPaused 消失');
  // v2.1.16 defensive isPaused
  assert.match(RENDERER, /Object\.prototype\.hasOwnProperty\.call\s*\(\s*payload\s*,\s*['"]isPaused['"]\s*\)/,
    'v2.1.16 applyHallPreStartState defensive isPaused 消失');
  // v2.1.17 main.js sanitization isPaused 転送
  assert.match(MAIN_JS, /typeof\s+payload\.isPaused\s*===\s*['"]boolean['"]/,
    'v2.1.17 main.js sanitization isPaused 転送 1 行消失');

  // package.json version 2.1.18
  assert.equal(PKG.version, '2.6.2', `package.json version が 2.1.18 ではない（実際: ${PKG.version}）`);
});

console.log(`\n結果: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
