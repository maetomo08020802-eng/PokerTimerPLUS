/**
 * v2.1.18-rc2 静的解析テスト — 案 B 真の根治 (hall subscribe gate) + 計測ログ 4 個保険
 *
 *   Fix 1 (案 B): renderer.js subscribe で hall + PRE_START active 中の renderTime / renderNextBreak を skip
 *   Fix 2-A: subscribe 冒頭に hall:subscribe:fire 計測ログ
 *   Fix 2-B: renderTime 冒頭に hall:renderTime:enter 計測ログ
 *   Fix 2-C: dual-sync.js _applyDiffToState の setState({dual_*}) 直前に hall:setState:dual 計測ログ
 *   Fix 2-D: el.clock.dataset.status 書き換え 4 箇所すべてに hall:dataset:status:write 計測ログ
 *
 * 真因: hall 側 dual-sync._applyDiffToState の setState({dual_timerState}) が subscribe を無条件 notify、
 *   subscribe 内 renderTime(state.remainingMs) が hall 起動時 idle 経路でセットされた Lv1 duration を表示
 *   → PRE_START 表示を上書き（v2.1.17 / v2.1.18-rc1 で 2 連続失敗の真因）。
 *
 * 致命バグ保護 5 件すべて完全無傷、v2.1.6〜v2.1.18-rc1 機構すべて完全保持。
 *
 * 実行: node tests/v232-hall-subscribe-gate-and-meas.test.js
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
// T1 (Fix 1): subscribe リスナの renderTime(state.remainingMs) が gate されている
// ============================================================
test('T1 (Fix 1): subscribe の renderTime 呼出が hall + PRE_START active gate 配下', () => {
  // gate 条件: if (!(window.appRole === 'hall' && hallPreStartState.isActive))
  assert.match(RENDERER, /if\s*\(\s*!\s*\(\s*window\.appRole\s*===\s*['"]hall['"]\s*&&\s*hallPreStartState\.isActive\s*\)\s*\)\s*\{[\s\S]*?renderTime\s*\(\s*state\.remainingMs\s*\)/,
    'subscribe の renderTime 呼出が gate 配下にない（Fix 1 未実装）');
});

// ============================================================
// T2 (Fix 1): subscribe の renderNextBreak も同 gate 配下
// ============================================================
test('T2 (Fix 1): subscribe の renderNextBreak 呼出が同 gate 配下', () => {
  // gate ブロック内に renderNextBreak も含まれる
  assert.match(RENDERER, /if\s*\(\s*!\s*\(\s*window\.appRole\s*===\s*['"]hall['"]\s*&&\s*hallPreStartState\.isActive\s*\)\s*\)\s*\{[\s\S]*?renderTime\s*\(\s*state\.remainingMs\s*\)[\s\S]*?renderNextBreak\s*\(\s*state\.remainingMs\s*,\s*state\.currentLevelIndex\s*\)/,
    'subscribe の renderNextBreak 呼出が gate 配下にない（Fix 1 未実装）');
});

// ============================================================
// T3〜T6: rc2 計測ログ 4 個 — 本番（v2.1.18 以降）では撤去済、-rcN ビルドでのみ存在検証。
//   v2.1.18 本番では v233 が「撤去確認」を実施するため、ここでは rc-build のみ存在を検証する。
// ============================================================
test('T3 (Fix 2-A): subscribe 冒頭に hall:subscribe:fire ログ — 本番では撤去、rc では存在', () => {
  // v2.1.19-rc2: 本テストは v2.1.18-rc\d+ または v2.1.18-meas\d+ 専用（rc2 計測ログ Fix 2-A〜D を検証）。
  //   v2.1.18 本番 / v2.1.19-rc\d+ 以降では撤去済（v233 / v236 で撤去確認）→ 本テストは skip。
  // v2.1.20-meas1: rc2 計測ログ (hall:subscribe:fire 等) は v2.1.18-rc / v2.1.18-meas 限定で、
  //   v2.1.20-meas では復活しない（meas1 計測機構は復活するが、rc2 専用ログは別系統）→ skip 維持。
  const isV218RcOrMeas = /^2\.1\.(18-rc|18-meas)/.test(PKG.version || '');
  if (!isV218RcOrMeas) return;   // 本番ビルドでは v233 で撤去確認、ここはスキップ
  assert.match(RENDERER, /subscribe\s*\(\s*\(\s*state\s*,\s*prev\s*\)\s*=>\s*\{[\s\S]{0,500}?window\.appRole\s*===\s*['"]hall['"][\s\S]{0,200}?hall:subscribe:fire/,
    'subscribe 冒頭に hall:subscribe:fire ログ + hall ガードがない（Fix 2-A 未実装）');
});

test('T4 (Fix 2-B): renderTime 冒頭に hall:renderTime:enter ログ — 本番では撤去、rc では存在', () => {
  // v2.1.19-rc2: 本テストは v2.1.18-rc\d+ または v2.1.18-meas\d+ 専用（rc2 計測ログ Fix 2-A〜D を検証）。
  //   v2.1.18 本番 / v2.1.19-rc\d+ 以降では撤去済（v233 / v236 で撤去確認）→ 本テストは skip。
  // v2.1.20-meas1: rc2 計測ログ (hall:subscribe:fire 等) は v2.1.18-rc / v2.1.18-meas 限定で、
  //   v2.1.20-meas では復活しない（meas1 計測機構は復活するが、rc2 専用ログは別系統）→ skip 維持。
  const isV218RcOrMeas = /^2\.1\.(18-rc|18-meas)/.test(PKG.version || '');
  if (!isV218RcOrMeas) return;
  const fnMatch = RENDERER.match(/function\s+renderTime\s*\(\s*remainingMs\s*\)\s*\{([\s\S]{0,800})/);
  assert.ok(fnMatch, 'renderTime 関数本体が見当たらない');
  const earlyBody = fnMatch[1];
  assert.match(earlyBody, /window\.appRole\s*===\s*['"]hall['"][\s\S]{0,200}?hall:renderTime:enter/,
    'renderTime 冒頭に hall:renderTime:enter ログ + hall ガードがない（Fix 2-B 未実装）');
});

test('T5 (Fix 2-C): dual-sync.js setState({dual_*}) 直前に hall:setState:dual ログ — 本番では撤去、rc では存在', () => {
  // v2.1.19-rc2: 本テストは v2.1.18-rc\d+ または v2.1.18-meas\d+ 専用（rc2 計測ログ Fix 2-A〜D を検証）。
  //   v2.1.18 本番 / v2.1.19-rc\d+ 以降では撤去済（v233 / v236 で撤去確認）→ 本テストは skip。
  // v2.1.20-meas1: rc2 計測ログ (hall:subscribe:fire 等) は v2.1.18-rc / v2.1.18-meas 限定で、
  //   v2.1.20-meas では復活しない（meas1 計測機構は復活するが、rc2 専用ログは別系統）→ skip 維持。
  const isV218RcOrMeas = /^2\.1\.(18-rc|18-meas)/.test(PKG.version || '');
  if (!isV218RcOrMeas) return;
  const setStateIdx = DUAL_SYNC.indexOf('setState({ [`dual_');
  assert.ok(setStateIdx > 0, 'dual-sync.js の setState({dual_*}) 呼出が見当たらない');
  const before = DUAL_SYNC.slice(Math.max(0, setStateIdx - 500), setStateIdx);
  assert.match(before, /hall:setState:dual/,
    'setState({dual_*}) 直前に hall:setState:dual ログがない（Fix 2-C 未実装）');
  assert.match(before, /window\.appRole\s*===\s*['"]hall['"]/,
    'hall:setState:dual ログに window.appRole === "hall" ガードがない');
});

test('T6 (Fix 2-D): hall:dataset:status:write 4 箇所 + caller 4 種すべて存在 — 本番では撤去、rc では存在', () => {
  // v2.1.19-rc2: 本テストは v2.1.18-rc\d+ または v2.1.18-meas\d+ 専用（rc2 計測ログ Fix 2-A〜D を検証）。
  //   v2.1.18 本番 / v2.1.19-rc\d+ 以降では撤去済（v233 / v236 で撤去確認）→ 本テストは skip。
  // v2.1.20-meas1: rc2 計測ログ (hall:subscribe:fire 等) は v2.1.18-rc / v2.1.18-meas 限定で、
  //   v2.1.20-meas では復活しない（meas1 計測機構は復活するが、rc2 専用ログは別系統）→ skip 維持。
  const isV218RcOrMeas = /^2\.1\.(18-rc|18-meas)/.test(PKG.version || '');
  if (!isV218RcOrMeas) return;
  const labelCount = (RENDERER.match(/hall:dataset:status:write/g) || []).length;
  assert.equal(labelCount, 4, `hall:dataset:status:write の出現件数が ${labelCount} (4 件必須)`);
  const callers = ['renderControls', 'applyHallPreStartState:paused', 'applyHallPreStartState:inactive', 'renderHallPreStartTick'];
  for (const c of callers) {
    assert.match(RENDERER, new RegExp(`caller:\\s*['"]${c.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}['"]`),
      `caller: '${c}' がない（Fix 2-D で 4 種すべて必要）`);
  }
});

// ============================================================
// T7: rc1 の Fix 1 (A 候補) + Fix 2 (B 候補) + Fix 3 (トーナメント終了演出) すべて touch なし
// ============================================================
test('T7: rc1 Fix 1 / Fix 2 / Fix 3 すべて完全保持', () => {
  // rc1 Fix 1 (A 候補): hall dual-sync timerState 分岐に !hallPreStartState.isActive gate
  assert.match(RENDERER, /else\s+if\s*\(\s*kind\s*===\s*['"]timerState['"]\s*&&\s*value\s*&&\s*!hallPreStartState\.isActive\s*\)/,
    'rc1 Fix 1 (A 候補) の hall timerState gate が消失');
  // rc1 Fix 2 (B 候補): captureCurrentTimerState の isPreStartActive() 拡張
  assert.match(RENDERER, /isPreStartLikely[\s\S]*?return\s*\{\s*status:\s*['"]idle['"]/,
    'rc1 Fix 2 (B 候補) の isPreStartLikely + idle 返却が消失');
  // rc1 Fix 3 (トーナメント終了演出): onTournamentComplete handler + clock--timer-finished 付与
  assert.match(RENDERER, /onTournamentComplete:\s*\(\s*\)\s*=>\s*\{[\s\S]*?clock--timer-finished/,
    'rc1 Fix 3 のトーナメント終了演出が消失');
  // index.html の overlay
  assert.match(INDEX_HTML, /id="js-timer-finished-overlay"/,
    'rc1 Fix 3 の #js-timer-finished-overlay が消失');
  // style.css のオレンジ枠
  assert.match(STYLE_CSS, /border:\s*[\d.]+\w*\s+solid\s+#FF8C1A/i,
    'rc1 Fix 3 のオレンジ枠 #FF8C1A が消失');
  // v2.1.18 識別コメント維持
  assert.match(RENDERER, /v2\.1\.18\s+①\s+A/, 'v2.1.18 ① A コメント維持失敗');
  assert.match(RENDERER, /v2\.1\.18\s+①\s+B/, 'v2.1.18 ① B コメント維持失敗');
});

// ============================================================
// T8: 致命バグ保護 5 件 + v2.1.6〜v2.1.17 機構 + v2.1.18-rc1 機構すべて完全保持
// ============================================================
test('T8: 致命バグ保護 5 件 + v2.1.6〜v2.1.18-rc1 機構すべて完全保持', () => {
  // C.2.7-A
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, 'C.2.7-A 消失');
  // C.2.7-D
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/, 'C.2.7-D 消失');
  // C.1-A2
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/, 'C.1-A2 消失');
  // C.1.7
  assert.match(AUDIO_JS, /\.resume\s*\(\s*\)/, 'C.1.7 消失');
  // C.1.8
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
  // v2.1.15 onPreStartPause / onPreStartResume
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
  // v2.1.18-rc1 onTournamentComplete handler in timer.js
  const setHandlersMatch = TIMER_JS.match(/export\s+function\s+setHandlers\s*\(\s*\{([^}]+)\}\s*\)/);
  assert.ok(setHandlersMatch && /\bonTournamentComplete\b/.test(setHandlersMatch[1]),
    'v2.1.18-rc1 timer.js setHandlers の onTournamentComplete 引数消失');
});

console.log(`\n結果: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
