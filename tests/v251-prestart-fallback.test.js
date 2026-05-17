/**
 * v2.2.2 hotfix Phase 2 第 1.5 段階 静的解析テスト
 *   — §8.B-2 setTimeout フォールバック機構の構造検証
 *
 *   検証対象:
 *     Fix B-2-1: timer.js に preStartFallbackTimerId 変数追加
 *     Fix B-2-2: timer.js _preStartFallbackCallback ヘルパ追加（早期 return ガード 3 種 + 発動時の startAtLevel(0)）
 *     Fix B-2-3: startPreStart 末尾で setTimeout(_preStartFallbackCallback, +1000ms バッファ) 仕掛け
 *     Fix B-2-4: cancelPreStart で clearTimeout（既存 handlers.onPreStartCancel 呼出は touch なし）
 *     Fix B-2-5: pause（PRE_START 経路）で clearTimeout
 *     Fix B-2-6: resume（PRE_START 経路）で setTimeout 再仕掛け
 *     Fix B-2-7: preStartTick の 0:00 検出経路で clearTimeout（rAF 先に動いた時の解除）
 *     Fix B-2-8: restorePreStart 非 paused 経路で setTimeout 仕掛け
 *     Fix B-2-9: main.js PRIORITY_LOG_LABELS に prestart:fallback:scheduled / cleared / fired 追加
 *
 *   既存機構保護:
 *     - 致命バグ保護 5 件 + rc1〜rc10.1 + v2.1.6〜v2.1.18 + v2.1.19 機構 touch ゼロ
 *     - Phase 2 第 1 段階の観測ラベル群 + prevent-app-suspension 機構 touch ゼロ
 *     - 既存 startPreStart / cancelPreStart / pause / resume / preStartTick の本体ロジック touch ゼロ
 *
 * 実行: node tests/v251-prestart-fallback.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT       = path.join(__dirname, '..');
const TIMER_JS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'timer.js'), 'utf8');
const MAIN_JS    = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// balanced-brace function body 抽出ヘルパ（v248 と同パターン）
function extractFnBody(src, sigRe) {
  const m = src.match(sigRe);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null;
}

// ============================================================
// T1: timer.js に preStartFallbackTimerId 変数が存在
// ============================================================
test('T1: preStartFallbackTimerId 変数が timer.js に存在', () => {
  assert.match(TIMER_JS, /\blet\s+preStartFallbackTimerId\s*=\s*null\s*;/,
    'preStartFallbackTimerId 変数宣言 (let preStartFallbackTimerId = null;) が見つからない');
});

// ============================================================
// T2: timer.js に _preStartFallbackCallback 関数が存在
// ============================================================
test('T2: _preStartFallbackCallback ヘルパ関数が timer.js に存在', () => {
  assert.match(TIMER_JS, /function\s+_preStartFallbackCallback\s*\(\s*\)\s*\{/,
    '_preStartFallbackCallback 関数定義が見つからない');
  const body = extractFnBody(TIMER_JS, /function\s+_preStartFallbackCallback\s*\(\s*\)\s*\{/);
  assert.ok(body, '_preStartFallbackCallback 関数本体が抽出できない');
  // preStartFallbackTimerId = null（次のスケジュールを邪魔しない）
  assert.match(body, /preStartFallbackTimerId\s*=\s*null/,
    '_preStartFallbackCallback で preStartFallbackTimerId = null クリアがない');
});

// ============================================================
// T3: _preStartFallbackCallback の早期 return ガード 3 種（!isPreStart / PAUSED / targetTime 未経過）
// ============================================================
test('T3: _preStartFallbackCallback の早期 return ガード 3 種が実装されている', () => {
  const body = extractFnBody(TIMER_JS, /function\s+_preStartFallbackCallback\s*\(\s*\)\s*\{/);
  assert.ok(body, '_preStartFallbackCallback 関数本体が抽出できない');
  // ガード 1: !isPreStart
  assert.match(body, /if\s*\(\s*!isPreStart\s*\)\s*return/,
    '_preStartFallbackCallback に if (!isPreStart) return ガードがない');
  // ガード 2: PAUSED 状態
  assert.match(body, /getState\(\)\.status\s*===\s*States\.PAUSED/,
    '_preStartFallbackCallback に States.PAUSED チェックがない');
  // ガード 3: performance.now() < targetTime（バッファ前は無視）
  assert.match(body, /performance\.now\(\)\s*<\s*targetTime/,
    '_preStartFallbackCallback に performance.now() < targetTime ガードがない');
});

// ============================================================
// T4: _preStartFallbackCallback が発動時に prestart:fallback:fired ラベル発火 + startAtLevel(0) 呼出
// ============================================================
test('T4: _preStartFallbackCallback の発動経路に prestart:fallback:fired + startAtLevel(0) 実装', () => {
  const body = extractFnBody(TIMER_JS, /function\s+_preStartFallbackCallback\s*\(\s*\)\s*\{/);
  assert.ok(body, '_preStartFallbackCallback 関数本体が抽出できない');
  // 観測ラベル発火
  assert.match(body, /prestart:fallback:fired/,
    '_preStartFallbackCallback で prestart:fallback:fired ラベル発火がない');
  // overshootMs 計算（rAF chain breakage の決定的証拠）
  assert.match(body, /overshootMs/,
    '_preStartFallbackCallback の発火 payload に overshootMs がない');
  // startAtLevel(0) で Level 1 RUNNING 遷移
  assert.match(body, /startAtLevel\s*\(\s*0\s*\)/,
    '_preStartFallbackCallback で startAtLevel(0) 呼出がない');
  // 既存 0:00 遷移と同じ handler 呼出（onPreStartEnd / onPreStartCancel）
  assert.match(body, /handlers\.onPreStartEnd\s*\(/,
    '_preStartFallbackCallback で handlers.onPreStartEnd 呼出がない');
  assert.match(body, /handlers\.onPreStartCancel\s*\(/,
    '_preStartFallbackCallback で handlers.onPreStartCancel 呼出がない');
});

// ============================================================
// T5: startPreStart 末尾で setTimeout(_preStartFallbackCallback, +1000ms バッファ) 仕掛け
// ============================================================
test('T5: startPreStart 末尾で setTimeout フォールバック仕掛けが実装されている', () => {
  const body = extractFnBody(TIMER_JS, /export\s+function\s+startPreStart\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'startPreStart 関数本体が抽出できない');
  // preStartFallbackTimerId = setTimeout(_preStartFallbackCallback, ...) 代入
  assert.match(body, /preStartFallbackTimerId\s*=\s*setTimeout\s*\(\s*_preStartFallbackCallback/,
    'startPreStart 末尾で preStartFallbackTimerId = setTimeout(_preStartFallbackCallback, ...) がない');
  // + 1000ms バッファ（正常 rAF より 1 秒遅い）
  assert.match(body, /Math\.max\s*\(\s*0\s*,\s*targetTime\s*-\s*performance\.now\(\)\s*\)\s*\+\s*1000/,
    'startPreStart で setTimeout 遅延 (targetTime - performance.now()) + 1000ms バッファがない');
  // 観測ラベル
  assert.match(body, /prestart:fallback:scheduled/,
    'startPreStart で prestart:fallback:scheduled ラベル発火がない');
});

// ============================================================
// T6: cancelPreStart で clearTimeout 実装（既存 handlers.onPreStartCancel 呼出は touch なし）
// ============================================================
test('T6: cancelPreStart で clearTimeout + prestart:fallback:cleared 発火が実装', () => {
  const body = extractFnBody(TIMER_JS, /export\s+function\s+cancelPreStart\s*\(\s*\)\s*\{/);
  assert.ok(body, 'cancelPreStart 関数本体が抽出できない');
  // clearTimeout 呼出
  assert.match(body, /clearTimeout\s*\(\s*preStartFallbackTimerId\s*\)/,
    'cancelPreStart で clearTimeout(preStartFallbackTimerId) がない');
  // ctx ラベル
  assert.match(body, /prestart:fallback:cleared[\s\S]{0,200}?ctx:\s*['"]cancel['"]/,
    'cancelPreStart で prestart:fallback:cleared ctx:cancel ラベル発火がない');
  // 既存 handlers.onPreStartCancel 呼出が保持されている（touch ゼロ）
  assert.match(body, /handlers\.onPreStartCancel\s*\(/,
    'cancelPreStart 既存 handlers.onPreStartCancel 呼出が消失している（touch ゼロ違反）');
});

// ============================================================
// T7: pause で PRE_START 経路の clearTimeout 実装
// ============================================================
test('T7: pause（PRE_START 経路）で clearTimeout + prestart:fallback:cleared ctx:pause', () => {
  const body = extractFnBody(TIMER_JS, /export\s+function\s+pause\s*\(\s*\)\s*\{/);
  assert.ok(body, 'pause 関数本体が抽出できない');
  // pause の if (isPreStart) 経路内で clearTimeout
  assert.match(body, /if\s*\(\s*isPreStart\s*\)\s*\{[\s\S]{0,500}?clearTimeout\s*\(\s*preStartFallbackTimerId\s*\)/,
    'pause の if (isPreStart) 経路で clearTimeout がない');
  // ctx ラベル
  assert.match(body, /prestart:fallback:cleared[\s\S]{0,200}?ctx:\s*['"]pause['"]/,
    'pause で prestart:fallback:cleared ctx:pause ラベル発火がない');
});

// ============================================================
// T8: resume で PRE_START 経路の setTimeout 再仕掛け実装
// ============================================================
test('T8: resume（PRE_START 経路）で setTimeout 再仕掛け + prestart:fallback:scheduled', () => {
  const body = extractFnBody(TIMER_JS, /export\s+function\s+resume\s*\(\s*\)\s*\{/);
  assert.ok(body, 'resume 関数本体が抽出できない');
  // resume の if (isPreStart) 経路内で setTimeout 再仕掛け
  assert.match(body, /if\s*\(\s*isPreStart\s*\)\s*\{[\s\S]{0,800}?preStartFallbackTimerId\s*=\s*setTimeout\s*\(\s*_preStartFallbackCallback/,
    'resume の if (isPreStart) 経路で setTimeout(_preStartFallbackCallback, ...) がない');
  // + 1000ms バッファ
  assert.match(body, /\+\s*1000/,
    'resume で setTimeout 遅延 + 1000ms バッファがない');
  // 観測ラベル
  assert.match(body, /prestart:fallback:scheduled/,
    'resume で prestart:fallback:scheduled ラベル発火がない');
});

// ============================================================
// T9: preStartTick の 0:00 検出経路で clearTimeout 実装
// ============================================================
test('T9: preStartTick の 0:00 検出経路で clearTimeout + prestart:fallback:cleared ctx:tick-zero', () => {
  // preStartTick は関数なので extractFnBody で抽出
  const tickIdx = TIMER_JS.indexOf('function preStartTick');
  assert.ok(tickIdx >= 0, 'preStartTick 関数が見つからない');
  // remainingMs <= 0 分岐内に clearTimeout が存在
  // 関数全体（拡張済の rAF gap / throttle 込み）から取得
  const body = extractFnBody(TIMER_JS, /function\s+preStartTick\s*\(\s*\)\s*\{/);
  assert.ok(body, 'preStartTick 関数本体が抽出できない');
  assert.match(body,
    /if\s*\(\s*remainingMs\s*<=\s*0\s*\)\s*\{[\s\S]{0,2000}?clearTimeout\s*\(\s*preStartFallbackTimerId\s*\)/,
    'preStartTick の if (remainingMs <= 0) 経路で clearTimeout(preStartFallbackTimerId) がない');
  // ctx:tick-zero ラベル
  assert.match(body, /prestart:fallback:cleared[\s\S]{0,200}?ctx:\s*['"]tick-zero['"]/,
    'preStartTick で prestart:fallback:cleared ctx:tick-zero ラベル発火がない');
  // 既存 startAtLevel(0) 呼出が保持されている（touch ゼロ）
  assert.match(body, /startAtLevel\s*\(\s*0\s*\)/,
    'preStartTick 既存 startAtLevel(0) 呼出が消失している（touch ゼロ違反）');
});

// ============================================================
// T10: restorePreStart 非 paused 経路で setTimeout 仕掛け実装
// ============================================================
test('T10: restorePreStart 非 paused 経路で setTimeout 仕掛け + prestart:fallback:scheduled', () => {
  const body = extractFnBody(TIMER_JS, /export\s+function\s+restorePreStart\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'restorePreStart 関数本体が抽出できない');
  // restorePreStart の else 経路（非 paused）で setTimeout 仕掛け
  // startPreStartLoop() 呼出後に setTimeout が来る構造
  assert.match(body,
    /startPreStartLoop\s*\(\s*\)\s*;[\s\S]{0,800}?preStartFallbackTimerId\s*=\s*setTimeout\s*\(\s*_preStartFallbackCallback/,
    'restorePreStart 非 paused 経路で startPreStartLoop() 後の setTimeout(_preStartFallbackCallback, ...) がない');
});

// ============================================================
// T11: main.js PRIORITY_LOG_LABELS に prestart:fallback:* 3 ラベル追加
// ============================================================
test('T11: main.js PRIORITY_LOG_LABELS に prestart:fallback:scheduled / cleared / fired 3 ラベル追加', () => {
  // PRIORITY_LOG_LABELS Set 定義箇所
  const labelsIdx = MAIN_JS.indexOf('PRIORITY_LOG_LABELS');
  assert.ok(labelsIdx >= 0, 'PRIORITY_LOG_LABELS が main.js に見つからない');
  // Set の closing bracket までを抽出
  const slice = MAIN_JS.slice(labelsIdx, labelsIdx + 3000);
  assert.match(slice, /['"]prestart:fallback:scheduled['"]/,
    'PRIORITY_LOG_LABELS に prestart:fallback:scheduled がない');
  assert.match(slice, /['"]prestart:fallback:cleared['"]/,
    'PRIORITY_LOG_LABELS に prestart:fallback:cleared がない');
  assert.match(slice, /['"]prestart:fallback:fired['"]/,
    'PRIORITY_LOG_LABELS に prestart:fallback:fired がない');
});

// ============================================================
// T12: 既存機構 touch ゼロ確認（reset 関数本体は window.api?.log?.write?. を呼ばない、rc10 設計判断）
// ============================================================
test('T12: timer.js reset() 関数本体は window.api?.log?.write?. を呼ばない（v247 T10 / rc10 設計判断保持）', () => {
  const resetBody = extractFnBody(TIMER_JS, /export\s+function\s+reset\s*\([^)]*\)\s*\{/);
  assert.ok(resetBody, 'reset 関数本体が抽出できない');
  // reset 内に window.api?.log?.write?. パターンが存在しないこと
  assert.doesNotMatch(resetBody, /window\.api\?\.log\?\.write\?\./,
    'reset 関数本体に window.api?.log?.write?. が混入している（rc10 設計判断違反）');
  // 既存 wasPreStart + handlers.onPreStartCancel 構造保持
  assert.match(resetBody, /wasPreStart/, 'reset 内の wasPreStart 変数が消失（v2.1.6 機構違反）');
  assert.match(resetBody, /handlers\.onPreStartCancel\(/,
    'reset 内の wasPreStart 経由 onPreStartCancel 呼出が消失（v2.1.6 機構違反）');
});

// ============================================================
// T13: 既存 Phase 2 第 1 段階の観測ラベル群 + prevent-app-suspension 機構 保持
// ============================================================
test('T13: Phase 2 第 1 段階の観測ラベル群 + prevent-app-suspension 機構が完全保持', () => {
  // Phase 2 第 1 段階で追加されたラベル代表的なものが PRIORITY_LOG_LABELS に残存
  assert.match(MAIN_JS, /['"]prestart:tick['"]/, 'prestart:tick ラベル消失（Phase 2 第 1 段階退行）');
  assert.match(MAIN_JS, /['"]prestart:tick:zero-detected['"]/, 'prestart:tick:zero-detected ラベル消失');
  assert.match(MAIN_JS, /['"]timer:startAtLevel:enter['"]/, 'timer:startAtLevel:enter ラベル消失');
  assert.match(MAIN_JS, /['"]window:rAF-gap['"]/, 'window:rAF-gap ラベル消失');
  assert.match(MAIN_JS, /['"]timer:reset:caller['"]/, 'timer:reset:caller ラベル消失');
  // prevent-app-suspension IPC ハンドラ存在
  assert.match(MAIN_JS, /ipcMain\.handle\(['"]power:preventAppSuspension['"]/,
    'prevent-app-suspension IPC ハンドラ消失');
  assert.match(MAIN_JS, /ipcMain\.handle\(['"]power:allowAppSuspension['"]/,
    'allow-app-suspension IPC ハンドラ消失');
  // power-save-blocker の 'prevent-app-suspension' 文字列発火
  assert.match(MAIN_JS, /powerSaveBlocker\.start\(\s*['"]prevent-app-suspension['"]/,
    'powerSaveBlocker.start("prevent-app-suspension") 呼出消失');
});

// ============================================================
// T14: 既存致命バグ保護 + rc 機構保持（v247 / v248 / v249 と整合）
// ============================================================
test('T14: 既存致命バグ保護 5 件 + rc1〜rc10.1 機構が完全保持', () => {
  // C.2.7-A: resetBlindProgressOnly が renderer.js に存在
  const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, 'resetBlindProgressOnly 関数消失（C.2.7-A 違反）');
  // C.1-A2: ensureEditorEditableState が renderer.js に存在
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'ensureEditorEditableState 関数消失（C.1-A2 違反）');
  // rc10: reset({force:false}) ガード（timer.js）
  assert.match(TIMER_JS, /if\s*\(\s*!\s*force\s+&&\s+isPreStart\s*\)\s*\{?\s*\n?\s*return\s+false\s*;/,
    'rc10 reset({force:false}) ガード消失');
  // rc10.1: timer:reset:race-window-entry ラベル
  assert.match(MAIN_JS, /['"]timer:reset:race-window-entry['"]/,
    'rc10.1 timer:reset:race-window-entry ラベル消失');
});

console.log(`=== Summary: ${pass} passed / ${fail} failed ===`);
if (fail > 0) process.exit(1);
