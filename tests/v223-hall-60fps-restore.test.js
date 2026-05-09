/**
 * v2.1.11 静的解析テスト — hall 自前 60fps tick 再導入（v2.1.10 設計ミスの構造的根治）
 *
 *   Fix A: src/renderer/renderer.js applyTimerStateToTimer の hall 経路で
 *          hallTickState seed 更新 + renderHallTickFrame 起動 + PAUSED/IDLE/FINISHED で stopHallTickFrame
 *   Fix B: renderHallTickFrame() 関数新規追加（自己再帰 rAF、Date.now() ベース remainingMs 算出）
 *   Fix C: hallTickState + stopHallTickFrame() 新規追加
 *   Fix D: renderHallPreStartTick の rAF 自己再帰を v2.1.6 同等に復活
 *
 * 真因（v2.1.10 退行）: hall 側の自前 60fps 描画ループを全停止 → 描画は broadcast 受信時のみ
 *   （RUNNING/BREAK は 5 秒粒度の periodicPersistAllRunning 依存）→ BREAK カクカク + PRE_START 進まず
 * 修正効果: hall 側で Date.now() から remainingMs を毎フレーム計算 → 60fps 描画復帰
 *           rAF 同時 2 個（renderHallTickFrame + dual-sync flush）= v2.1.10 設計目標を達成
 *
 * 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）。
 * v2.1.10 Fix 1（timer.js 関数呼出の hall ガード）+ Fix 3（計測機構）は完全保持、Fix 2 のみ撤回。
 *
 * 実行: node tests/v223-hall-60fps-restore.test.js
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

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// 関数本体（balanced brace）抽出ヘルパ
function extractFnBody(source, signatureRe) {
  const m = source.match(signatureRe);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(open + 1, i); }
  }
  return null;
}

// ============================================================
// T1 (Fix C): hallTickState 定義 + 全フィールド網羅
// ============================================================
test('T1 (Fix C): hallTickState 定義 + 全フィールド網羅', () => {
  const m = RENDERER.match(/const\s+hallTickState\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(m, 'hallTickState 定義が見つからない');
  const body = m[1];
  // 必須フィールド: isActive / status / currentLevelIndex / totalMs / startedAtMs / rafId
  assert.match(body, /isActive\s*:/, 'hallTickState.isActive がない');
  assert.match(body, /status\s*:/, 'hallTickState.status がない');
  assert.match(body, /currentLevelIndex\s*:/, 'hallTickState.currentLevelIndex がない');
  assert.match(body, /totalMs\s*:/, 'hallTickState.totalMs がない');
  assert.match(body, /startedAtMs\s*:/, 'hallTickState.startedAtMs がない');
  assert.match(body, /rafId\s*:/, 'hallTickState.rafId がない');
});

// ============================================================
// T2 (Fix A): applyTimerStateToTimer の hall 経路で hallTickState seed 更新 + renderHallTickFrame 起動
// ============================================================
test('T2 (Fix A): applyTimerStateToTimer hall 経路で seed 更新 + renderHallTickFrame 起動', () => {
  const body = extractFnBody(RENDERER, /function\s+applyTimerStateToTimer\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'applyTimerStateToTimer 関数本体が抽出できない');
  // seed 更新: hallTickState.startedAtMs = Date.now() + remainingMs
  assert.match(body, /hallTickState\.startedAtMs\s*=\s*Date\.now\(\)\s*\+\s*remainingMs/,
    'hall 経路で hallTickState.startedAtMs = Date.now() + remainingMs の seed 更新がない');
  // status / currentLevelIndex / totalMs の seed 更新
  assert.match(body, /hallTickState\.status\s*=\s*status/,
    'hallTickState.status の seed 更新がない');
  assert.match(body, /hallTickState\.currentLevelIndex\s*=\s*idx/,
    'hallTickState.currentLevelIndex の seed 更新がない');
  assert.match(body, /hallTickState\.totalMs\s*=\s*totalMs/,
    'hallTickState.totalMs の seed 更新がない');
  // renderHallTickFrame() の呼出（RUNNING / BREAK 経路のみ）
  assert.match(body, /renderHallTickFrame\s*\(\s*\)/,
    'hall 経路で renderHallTickFrame() の呼出がない');
});

// ============================================================
// T3 (Fix B): renderHallTickFrame 関数定義 + 自己再帰 rAF
// ============================================================
test('T3 (Fix B): renderHallTickFrame 関数定義 + 自己再帰 requestAnimationFrame', () => {
  const body = extractFnBody(RENDERER, /function\s+renderHallTickFrame\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'renderHallTickFrame 関数本体が抽出できない');
  // hall ガード（appRole !== 'hall' 早期 return）
  assert.match(body, /window\.appRole\s*!==\s*['"]hall['"][\s\S]{0,30}return/,
    'renderHallTickFrame に hall ガード（appRole !== "hall" 早期 return）がない');
  // 自己再帰 rAF
  assert.match(body, /hallTickState\.rafId\s*=\s*requestAnimationFrame\s*\(\s*renderHallTickFrame\s*\)/,
    'renderHallTickFrame の自己再帰 rAF（hallTickState.rafId = requestAnimationFrame(renderHallTickFrame)）がない');
});

// ============================================================
// T4 (Fix B): renderHallTickFrame 内で Date.now() ベース remainingMs 算出 + setState({ remainingMs }) 呼出
// ============================================================
test('T4 (Fix B): renderHallTickFrame 内で Date.now() ベース remainingMs 算出 + setState 経由 DOM 更新', () => {
  const body = extractFnBody(RENDERER, /function\s+renderHallTickFrame\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'renderHallTickFrame 関数本体が抽出できない');
  // Date.now() で startedAtMs との差を計算
  assert.match(body, /Date\.now\(\)/, 'renderHallTickFrame 内で Date.now() の使用がない');
  assert.match(body, /hallTickState\.startedAtMs\s*-\s*now/,
    'remainingMs = startedAtMs - now の差分計算がない');
  // setState({ remainingMs }) で subscribe 経由 DOM 更新
  assert.match(body, /setState\s*\(\s*\{\s*remainingMs\s*\}\s*\)/,
    'renderHallTickFrame 内で setState({ remainingMs }) 呼出がない（subscribe 経由 DOM 更新経路）');
});

// ============================================================
// T5 (Fix D): renderHallPreStartTick の rAF 自己再帰が v2.1.6 同等に復活
// ============================================================
test('T5 (Fix D): renderHallPreStartTick の rAF 自己再帰復活', () => {
  const rawBody = extractFnBody(RENDERER, /function\s+renderHallPreStartTick\s*\([^)]*\)\s*\{/);
  assert.ok(rawBody, 'renderHallPreStartTick 関数本体が抽出できない');
  // コメント剥がし
  const body = rawBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // 自己再帰 rAF: hallPreStartState.rafId = requestAnimationFrame(renderHallPreStartTick)
  assert.match(body, /hallPreStartState\.rafId\s*=\s*requestAnimationFrame\s*\(\s*renderHallPreStartTick\s*\)/,
    'renderHallPreStartTick の自己再帰 rAF が復活していない（v2.1.10 で削除、v2.1.11 で復活すべき）');
});

// ============================================================
// T6 (Fix C): stopHallTickFrame 関数定義 + cancelAnimationFrame 呼出
// ============================================================
test('T6 (Fix C): stopHallTickFrame 関数定義 + cancelAnimationFrame 呼出', () => {
  const body = extractFnBody(RENDERER, /function\s+stopHallTickFrame\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'stopHallTickFrame 関数本体が抽出できない');
  assert.match(body, /cancelAnimationFrame\s*\(\s*hallTickState\.rafId\s*\)/,
    'stopHallTickFrame 内で cancelAnimationFrame(hallTickState.rafId) がない');
  assert.match(body, /hallTickState\.rafId\s*=\s*null/,
    'stopHallTickFrame 内で hallTickState.rafId = null クリアがない');
  assert.match(body, /hallTickState\.isActive\s*=\s*false/,
    'stopHallTickFrame 内で hallTickState.isActive = false がない');
});

// ============================================================
// T7 (Fix E): IDLE / FINISHED / PAUSED / 不正値 / levelCount===0 で stopHallTickFrame 呼出
// ============================================================
test('T7 (Fix E): applyTimerStateToTimer の停止経路で stopHallTickFrame 呼出網羅', () => {
  const body = extractFnBody(RENDERER, /function\s+applyTimerStateToTimer\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'applyTimerStateToTimer 関数本体が抽出できない');
  // stopHallTickFrame 呼出が複数箇所（!ts / idle / finished / levelCount===0 / PAUSED）にある
  const stopCalls = body.match(/stopHallTickFrame\s*\(\s*\)/g) || [];
  assert.ok(stopCalls.length >= 4,
    `stopHallTickFrame 呼出が 4 件以上必要（!ts / idle / finished / levelCount===0 / PAUSED）、現在 ${stopCalls.length}件`);
});

// ============================================================
// T8 (v2.1.10 Fix 1 保持): applyTimerStateToTimer の timer.js 関数呼出 hall ガード維持
// ============================================================
test('T8 (v2.1.10 Fix 1 保持): timer.js 関数呼出の !isHallApply ガード完全保持', () => {
  const body = extractFnBody(RENDERER, /function\s+applyTimerStateToTimer\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'applyTimerStateToTimer 関数本体が抽出できない');
  // isHallApply 変数定義
  assert.match(body, /isHallApply[\s\S]*?window\.appRole\s*===\s*['"]hall['"]/,
    'isHallApply 変数（hall 判定）が消えている');
  // timerReset 4 箇所すべて !isHallApply ガード付き
  const guardedReset = body.match(/!\s*isHallApply\s*\)\s*timerReset\s*\(\s*\)/g) || [];
  assert.ok(guardedReset.length >= 4,
    `timerReset の !isHallApply ガード付き呼出が 4 件以上必要、現在 ${guardedReset.length}件`);
  // timerStartAtLevel / timerAdvanceBy / timerPause すべて !isHallApply ブロック内
  assert.match(body, /if\s*\(\s*!isHallApply\s*\)\s*\{[\s\S]*?timerStartAtLevel\s*\(/,
    'timerStartAtLevel 呼出が !isHallApply ガードブロック内にない');
  assert.match(body, /if\s*\(\s*!isHallApply\s*\)\s*\{[\s\S]*?timerAdvanceBy\s*\(/,
    'timerAdvanceBy 呼出が !isHallApply ガードブロック内にない');
  assert.match(body, /if\s*\(\s*!isHallApply\s*\)\s*\{[\s\S]*?timerPause\s*\(\s*\)/,
    'timerPause 呼出が !isHallApply ガードブロック内にない');
});

// ============================================================
// T9 (Fix F): operator 側 broadcast の 1 秒 throttle 維持
// ============================================================
test('T9 (Fix F): _preStartTickLastSentAt >= 1000 throttle 維持', () => {
  // _preStartTickLastSentAt 変数 + 1000ms 閾値
  assert.match(RENDERER, /_preStartTickLastSentAt/,
    '_preStartTickLastSentAt（rAF tick 間引き計測）が消えている');
  assert.match(RENDERER, /now\s*-\s*_preStartTickLastSentAt\s*>=\s*1000/,
    'rAF tick の 1 秒（1000ms）throttle が消えている');
});

// ============================================================
// T10: 致命バグ保護 5 件 cross-check
// ============================================================
test('T10: 致命バグ保護 5 件すべて維持', () => {
  // C.2.7-A: resetBlindProgressOnly が renderer.js に存在
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'C.2.7-A: resetBlindProgressOnly が renderer.js から消えている');
  // C.2.7-D: tournaments:setDisplaySettings の timerState destructure 除外
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/,
    'C.2.7-D: tournaments:setDisplaySettings ハンドラが消えている');
  // C.1-A2: ensureEditorEditableState が renderer.js に存在
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'C.1-A2: ensureEditorEditableState が renderer.js から消えている');
  // C.1.7: AudioContext suspend resume 経路が audio.js _play に存在
  assert.match(AUDIO_JS, /audioContext\.state\s*===\s*['"]suspended['"]/,
    'C.1.7: AudioContext suspend 検出が audio.js から消えている');
  // C.1.8: tournaments:setRuntime IPC が main.js に存在
  assert.match(MAIN_JS, /tournaments:setRuntime/,
    'C.1.8: tournaments:setRuntime IPC が main.js から消えている');
  // schedulePersistRuntime 8 箇所以上
  const calls = (RENDERER.match(/schedulePersistRuntime\s*\(\s*\)/g) || []).length;
  assert.ok(calls >= 8, `C.1.8: schedulePersistRuntime 呼出が ${calls} 件（期待 8 以上）`);
});

// ============================================================
// T11: hallPreStartState と hallTickState の共存（案 B 分離設計）
// ============================================================
test('T11: hallPreStartState（PRE_START）と hallTickState（RUNNING/BREAK）の共存', () => {
  // 両 state オブジェクトが定義されている
  assert.match(RENDERER, /const\s+hallPreStartState\s*=\s*\{/,
    'hallPreStartState 定義が消えている（v2.1.6 機構の core）');
  assert.match(RENDERER, /const\s+hallTickState\s*=\s*\{/,
    'hallTickState 定義が消えている（v2.1.11 新規）');
  // 両 rAF 関数が定義されている
  assert.match(RENDERER, /function\s+renderHallPreStartTick\s*\(/,
    'renderHallPreStartTick 関数が消えている');
  assert.match(RENDERER, /function\s+renderHallTickFrame\s*\(/,
    'renderHallTickFrame 関数が消えている（v2.1.11 新規）');
});

// ============================================================
// T12: package.json version 2.1.12 + scripts.test に v223 登録
// ============================================================
test('T12: package.json version は 2.1.12 + scripts.test に v223 登録', () => {
  assert.equal(PKG.version, '2.1.18-meas1',
    `package.json version が ${PKG.version}（期待 2.1.18）`);
  assert.match(PKG.scripts.test, /v223-hall-60fps-restore\.test\.js/,
    'scripts.test に v223-hall-60fps-restore.test.js が登録されていない');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
