/**
 * v2.1.18-rc1 静的解析テスト — PRE_START 一時停止 hall 表示破綻 A+B 二重防御
 *
 *   Fix 1 (A): hall 受信 gate — renderer.js dual-sync `kind === 'timerState'` 分岐に
 *              `!hallPreStartState.isActive` gate 追加
 *   Fix 2 (B): 送信側抑止 — captureCurrentTimerState の PRE_START ガードを `isPreStartActive()` で拡張
 *
 * 真因: PRE_START 中の Space 一時停止 → setState({status: PAUSED}) → subscribe で schedulePersistTimerState
 *   500ms debounce 発火 → captureCurrentTimerState が PRE_START ガード素通り（status は PAUSED に変化済）
 *   → tournaments:setTimerState IPC → main.js → _publishDualState('timerState') → hall に届く
 *   → hall 側 timerState 分岐に gate なし → applyTimerStateToTimer 呼出 → 実 Lv1 残り時間で上書き
 *   → 「トーナメントスタートまで」ラベル消失 + 残り時間破綻（例: 9:50 → 00:50）
 *
 * 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）。
 *
 * 実行: node tests/v230-prestart-pause-hall-overwrite-fix.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT      = path.join(__dirname, '..');
const PKG       = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const TIMER_JS  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'timer.js'), 'utf8');
const MAIN_JS   = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const AUDIO_JS  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1 (Fix 1): renderer.js hall dual-sync `kind === 'timerState'` 分岐に !hallPreStartState.isActive gate
// ============================================================
test('T1 (Fix 1): hall dual-sync timerState 分岐に !hallPreStartState.isActive gate', () => {
  // else if (kind === 'timerState' && value && !hallPreStartState.isActive)
  assert.match(RENDERER, /else\s+if\s*\(\s*kind\s*===\s*['"]timerState['"]\s*&&\s*value\s*&&\s*!hallPreStartState\.isActive\s*\)/,
    'hall timerState 分岐に !hallPreStartState.isActive gate がない（Fix 1 未実装）');
});

// ============================================================
// T2 (Fix 2): captureCurrentTimerState 内で isPreStartActive() 経由 PAUSED 検知 → idle 返却
// ============================================================
test('T2 (Fix 2): captureCurrentTimerState で isPreStartActive() 経由 idle 返却', () => {
  const fnMatch = RENDERER.match(/function\s+captureCurrentTimerState\s*\(\s*\)\s*\{([\s\S]*?\n\})/);
  assert.ok(fnMatch, 'captureCurrentTimerState 関数本体が見当たらない');
  const body = fnMatch[1];
  // isPreStartActive() 呼出
  assert.match(body, /isPreStartActive\s*\(\s*\)/,
    'captureCurrentTimerState 内に isPreStartActive() 呼出がない（Fix 2 未実装）');
  // 'isPreStartLikely' 変数または同等の判定 + idle 返却
  assert.match(body, /isPreStartLikely[\s\S]*?return\s*\{\s*status:\s*['"]idle['"]/,
    'captureCurrentTimerState の isPreStartLikely 判定 + idle 返却経路がない');
});

// ============================================================
// T3 (Fix 1/2): v2.1.18 識別コメント存在
// ============================================================
test('T3: v2.1.18 識別コメント文言存在（Fix 1 / Fix 2）', () => {
  assert.match(RENDERER, /v2\.1\.18\s+①\s+A/,
    'Fix 1 の v2.1.18 ① A コメントがない');
  assert.match(RENDERER, /v2\.1\.18\s+①\s+B/,
    'Fix 2 の v2.1.18 ① B コメントがない');
});

// ============================================================
// T4: preStartState 経路（v2.1.6〜v2.1.17 機構）touch なし、main.js sanitization isPaused 転送維持
// ============================================================
test('T4: preStartState 経路 + main.js sanitization isPaused 転送 1 行維持', () => {
  // main.js sanitization isPaused 転送
  assert.match(MAIN_JS, /typeof\s+payload\.isPaused\s*===\s*['"]boolean['"]/,
    'main.js の payload.isPaused boolean 判定が消失');
  assert.match(MAIN_JS, /sanitized\.isPaused\s*=\s*payload\.isPaused/,
    'main.js の sanitized.isPaused = payload.isPaused 代入が消失');
  // dual:publish-pre-start-state ハンドラ存在
  assert.match(MAIN_JS, /ipcMain\.on\s*\(\s*['"]dual:publish-pre-start-state['"]/,
    'dual:publish-pre-start-state ハンドラが消失');
});

// ============================================================
// T5: hall 側 applyHallPreStartState 既存ロジック touch なし
// ============================================================
test('T5: applyHallPreStartState 既存ロジック touch なし', () => {
  // v2.1.16 defensive isPaused
  assert.match(RENDERER, /Object\.prototype\.hasOwnProperty\.call\s*\(\s*payload\s*,\s*['"]isPaused['"]\s*\)/,
    'v2.1.16 applyHallPreStartState defensive isPaused が消失');
  // dataset.prestartPaused セット
  assert.match(RENDERER, /dataset\.prestartPaused\s*=\s*['"]true['"]/,
    'v2.1.15 dataset.prestartPaused="true" セット消失');
});

// ============================================================
// T6: timer.js pause() / resume() の if (isPreStart) 分岐 + onPreStartPause / onPreStartResume 呼出 touch なし
// ============================================================
test('T6: timer.js pause/resume の onPreStartPause/onPreStartResume 呼出 touch なし', () => {
  assert.match(TIMER_JS, /if\s*\(\s*isPreStart\s*\)\s*\{[\s\S]*?handlers\.onPreStartPause\s*\(/,
    'timer.js pause() の onPreStartPause 呼出消失');
  assert.match(TIMER_JS, /if\s*\(\s*isPreStart\s*\)\s*\{[\s\S]*?handlers\.onPreStartResume\s*\(/,
    'timer.js resume() の onPreStartResume 呼出消失');
});

// ============================================================
// T7: 致命バグ保護 5 件 cross-check
// ============================================================
test('T7: 致命バグ保護 5 件すべて維持', () => {
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'C.2.7-A: resetBlindProgressOnly 関数消失');
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/,
    'C.2.7-D: tournaments:setDisplaySettings ハンドラ消失');
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'C.1-A2: ensureEditorEditableState 関数消失');
  assert.match(AUDIO_JS, /\.resume\s*\(\s*\)/,
    'C.1.7: AudioContext resume 防御消失');
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/,
    'C.1.8: schedulePersistRuntime 関数消失');
  const callCount = (RENDERER.match(/schedulePersistRuntime\s*\(/g) || []).length;
  assert.ok(callCount >= 9, `C.1.8: schedulePersistRuntime 出現回数 ${callCount} (9 件以上必要)`);
});

// ============================================================
// T8: v2.1.6〜v2.1.17 機構（dual-sync diff buffer / hall 60fps tick / isBreakLevel import / computeHeaderLevelText / 構造同期 2 穴根治 / isSlideshowEligibleStatus 拡張 / onPreStartTick isPaused:false 明示）touch なし
// ============================================================
test('T8: v2.1.6〜v2.1.17 機構すべて完全保持', () => {
  // v2.1.7 dual-sync.js
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js')),
    'v2.1.7 dual-sync.js 消失');
  // v2.1.11 renderHallTickFrame
  assert.match(RENDERER, /function\s+renderHallTickFrame\s*\(/,
    'v2.1.11 renderHallTickFrame 消失');
  // v2.1.13 PRE_START data-status
  assert.match(RENDERER, /el\.clock\.dataset\.status\s*=\s*['"]PRE_START['"]/,
    'v2.1.13 data-status PRE_START セット消失');
  // v2.1.14 構造同期 2 穴根治
  assert.match(MAIN_JS, /_publishDualState\s*\(\s*['"]structure['"]\s*,\s*preset\s*\)/,
    'v2.1.14 tournaments:setActive structure broadcast 消失');
  assert.match(MAIN_JS, /snapshot\.structure\s*===\s*null/,
    'v2.1.14 dual:state-sync-init snapshot.structure null ガード消失');
  // v2.1.15 isBreakLevel import
  const importBlock = RENDERER.match(/import\s*\{[^}]*\}\s*from\s*['"]\.\/blinds\.js['"]/);
  assert.ok(importBlock && /\bisBreakLevel\b/.test(importBlock[0]),
    'v2.1.15 isBreakLevel import 消失');
  // v2.1.15 computeHeaderLevelText
  assert.match(RENDERER, /function\s+computeHeaderLevelText\s*\(/,
    'v2.1.15 computeHeaderLevelText 消失');
  // v2.1.16 isSlideshowEligibleStatus 拡張
  const islideMatch = RENDERER.match(/function\s+isSlideshowEligibleStatus\s*\(\s*status\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(islideMatch, 'isSlideshowEligibleStatus 関数消失');
  assert.match(islideMatch[1], /status\s*===\s*States\.PAUSED/,
    'v2.1.16 isSlideshowEligibleStatus PAUSED 経路消失');
  // v2.1.17 main.js sanitization は T4 で確認済
  // onPreStartTick の isPaused:false 明示送信
  assert.match(RENDERER, /onPreStartTick:[\s\S]*?publishPreStartIfOperator\s*\(\s*\{[^}]*isPaused:\s*false[^}]*\}\s*\)/,
    'onPreStartTick の isPaused: false 明示送信消失');
});

console.log(`\n結果: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
