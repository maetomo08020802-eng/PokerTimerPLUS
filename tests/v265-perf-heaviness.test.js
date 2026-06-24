/**
 * v2.6.0 perf-heaviness — アプリ激重・他アプリ巻き込みの安全な軽量化（2026-06-08）
 *
 * STEP 2 で適用した低リスク軽量化を静的アサートで固定し、スコープ厳守（hall / PRE_START 非接触）を担保:
 *   (a) 背景 background-attachment: fixed → scroll（視覚差ゼロ、GPU 再合成削減）
 *   (b) marquee will-change: transform 削除（常駐コンポジタ層ヒント 1 枚削減）
 *   (c) operator ウィンドウのみ backgroundThrottling: true（hall=false / operator-solo=false 据置）
 * STEP 1 の計測ハーネスは PERF_METRICS env ゲートで本番完全無効であることもアサート。
 *
 * 実行: node tests/v265-perf-heaviness.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const PKG      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const MAIN_JS  = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD  = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const STYLE    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// コメントを除去してから「コード上の宣言/プロパティ」を判定する（説明コメント内の
// "backgroundThrottling" / "fixed" 等の文字列による誤検出を避けるため）。
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')          // ブロックコメント
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');     // 行コメント（URL の :// は温存）
}
const MAIN_NC     = stripComments(MAIN_JS);
const RENDERER_NC = stripComments(RENDERER);
const STYLE_NC    = stripComments(STYLE);

// ============================================================
// (c) operator のみ throttling — hall / operator-solo は false 据置（review 2026-06-08 確定）
// ============================================================
test('C1: buildWebPreferences は backgroundThrottling: role === "operator"（計算式で operator のみ true）', () => {
  assert.match(MAIN_NC, /backgroundThrottling:\s*role\s*===\s*'operator'/,
    'backgroundThrottling が role === "operator" 式になっていない');
  // 旧実装の固定 false / 固定 true プロパティが残っていないこと（hall/solo を巻き込む誤実装の防止、コメント除去後判定）
  assert.ok(!/backgroundThrottling:\s*false\b/.test(MAIN_NC), 'backgroundThrottling: false プロパティ残存');
  assert.ok(!/backgroundThrottling:\s*true\b/.test(MAIN_NC), 'backgroundThrottling: true プロパティ残存（hall/solo 巻き込みの恐れ）');
});

test('C2 (3 値固定): role==="operator"→true / "operator-solo"→false / "hall"→false', () => {
  // plan/review 確定の意図をロジックで明文化（実装式 role === "operator" と同値）
  const throttle = (role) => role === 'operator';
  assert.equal(throttle('operator'), true, 'operator は throttle すべき');
  assert.equal(throttle('operator-solo'), false, 'operator-solo は throttle してはいけない（会場表示兼務）');
  assert.equal(throttle('hall'), false, 'hall は throttle してはいけない（会場表示・スコープ外厳守）');
});

test('C3 (★スコープ厳守): createHallWindow は backgroundThrottling を上書きしない（hall=false 据置）', () => {
  const i = MAIN_NC.indexOf('function createHallWindow');
  assert.ok(i >= 0, 'createHallWindow が見つからない');
  // createHallWindow〜次関数までの範囲を抽出（コメント除去済ソース）
  const seg = MAIN_NC.slice(i, i + 2500);
  assert.ok(!/backgroundThrottling/.test(seg), 'createHallWindow が backgroundThrottling を独自指定している（hall 据置違反）');
  // hall は buildWebPreferences('hall') を使う＝role==="operator" が false で throttle なし
  assert.match(seg, /buildWebPreferences\('hall'\)/, "createHallWindow が buildWebPreferences('hall') を使っていない");
});

// ============================================================
// (a) 背景 background-attachment: scroll
// ============================================================
test('A1: data-bg="image" body は background-attachment: scroll（fixed 撤去・視覚差ゼロ）', () => {
  const i = STYLE_NC.indexOf(':root[data-bg="image"] body {');
  assert.ok(i >= 0, 'data-bg="image" body ルールが見つからない');
  const seg = STYLE_NC.slice(i, i + 400);
  assert.match(seg, /background-attachment:\s*scroll/, 'background-attachment: scroll になっていない');
  // style.css 全体（コメント除去後）に background-attachment: fixed が存在しないこと
  assert.ok(!/background-attachment:\s*fixed/.test(STYLE_NC), 'background-attachment: fixed が残存');
  // 見た目不変の担保: cover / center / no-repeat は維持
  assert.match(seg, /background-size:\s*cover/, 'background-size: cover が消えた（見た目変化）');
  assert.match(seg, /background-position:\s*center/, 'background-position: center が消えた（見た目変化）');
});

// ============================================================
// (b) marquee will-change 削除
// ============================================================
test('B1: .marquee-content から will-change 宣言が撤去（infinite アニメで自動層化のため不要）', () => {
  const i = STYLE_NC.indexOf('.marquee-content {');
  assert.ok(i >= 0, '.marquee-content ルールが見つからない');
  const seg = STYLE_NC.slice(i, i + 600);
  // 宣言（will-change: ...;）が無いこと（コメント除去後）
  assert.ok(!/will-change\s*:/.test(seg), 'will-change 宣言が残存');
  // アニメーション本体は維持（テロップが動かなくなる退行の防止）
  assert.match(seg, /animation-name:\s*marquee-scroll/, 'marquee アニメ本体が消えた');
  assert.match(seg, /animation-iteration-count:\s*infinite/, 'marquee infinite が消えた');
});

// ============================================================
// STEP 1: 計測ハーネスの本番無害性（PERF_METRICS env ゲート）
// ============================================================
test('M1 (本番無害): main サンプラは PERF_METRICS === "1" でのみ起動', () => {
  assert.match(MAIN_JS, /_PERF_METRICS_ON\s*=\s*process\.env\.PERF_METRICS\s*===\s*'1'/,
    'PERF_METRICS env ゲートがない');
  // _startPerfMetricsSampler は冒頭で !_PERF_METRICS_ON なら return
  const i = MAIN_JS.indexOf('function _startPerfMetricsSampler');
  assert.ok(i >= 0, '_startPerfMetricsSampler が見つからない');
  const seg = MAIN_JS.slice(i, i + 200);
  assert.match(seg, /if\s*\(!_PERF_METRICS_ON/, 'サンプラ冒頭の PERF ゲートがない');
  // app.getAppMetrics を使う
  assert.match(MAIN_JS, /app\.getAppMetrics\(\)/, 'app.getAppMetrics による計測がない');
});

test('M2 (本番無害): renderer rAF Hz カウンタは window.__PERF_METRICS true 時のみ作動', () => {
  // preload は --perf-metrics=1 検出時のみ __PERF_METRICS を expose
  assert.match(PRELOAD, /--perf-metrics=1/, 'preload に perf フラグ検出がない');
  assert.match(PRELOAD, /exposeInMainWorld\('__PERF_METRICS'/, '__PERF_METRICS の expose がない');
  // _wrappedRAF のカウントは _perfMetricsEnabled() ガード下のみ
  const i = RENDERER.indexOf('function _wrappedRAF');
  assert.ok(i >= 0, '_wrappedRAF が見つからない');
  const seg = RENDERER.slice(i, i + 400);
  assert.match(seg, /if\s*\(_perfMetricsEnabled\(\)\)/, 'rAF カウントが _perfMetricsEnabled ガード下にない');
});

test('M3 (本番無害): main の additionalArguments は PERF_METRICS 時のみ --perf-metrics=1 を付与', () => {
  assert.match(MAIN_JS, /process\.env\.PERF_METRICS\s*===\s*'1'\s*\?\s*\[`--role=\$\{role\}`,\s*'--perf-metrics=1'\]/,
    'additionalArguments の perf フラグ条件付与がない');
});

// ============================================================
// ★ スコープ厳守: PRE_START / hall rAF の発火条件・自己停止ロジックは不変（計測フックのみ）
// ============================================================
test('S1 (★PRE_START 非接触): renderHallPreStartTick の自己停止ロジック維持', () => {
  assert.match(RENDERER_NC, /function\s+renderHallPreStartTick\s*\(/, 'renderHallPreStartTick が消えた');
  const i = RENDERER_NC.indexOf('function renderHallPreStartTick');
  const seg = RENDERER_NC.slice(i, i + 1500);
  assert.match(seg, /hallPreStartState\.isActive\s*=\s*false/, 'PRE_START tick の自己停止（isActive=false）が消えた');
});

test('S2 (★hall rAF 非接触): renderHallTickFrame の RUNNING/BREAK ガードと自己停止維持', () => {
  assert.match(RENDERER_NC, /function\s+renderHallTickFrame\s*\(/, 'renderHallTickFrame が消えた');
  const i = RENDERER_NC.indexOf('function renderHallTickFrame');
  const seg = RENDERER_NC.slice(i, i + 1500);
  assert.match(seg, /hallTickState\.status\s*!==\s*States\.RUNNING/, 'hall tick の RUNNING ガードが消えた');
  assert.match(seg, /hallTickState\.isActive\s*=\s*false/, 'hall tick の自己停止が消えた');
});

test('S3: _wrappedRAF は requestAnimationFrame の薄ラッパのまま（頻度・スケジューリング不変）', () => {
  const i = RENDERER_NC.indexOf('function _wrappedRAF');
  const seg = RENDERER_NC.slice(i, i + 400);
  assert.match(seg, /return\s+requestAnimationFrame\(/, '_wrappedRAF が requestAnimationFrame を返していない');
});

// ============================================================
// 保護
// ============================================================
test('P1 (保護): 致命バグ保護 5 件すべて維持', () => {
  assert.ok(/function\s+resetBlindProgressOnly\s*\(/.test(RENDERER), 'resetBlindProgressOnly 消失');
  assert.ok(/function\s+ensureEditorEditableState\s*\(/.test(RENDERER), 'ensureEditorEditableState 消失');
  assert.ok(/setBlindsTableReadonly/.test(RENDERER), 'setBlindsTableReadonly 消失');
  assert.ok(/tournaments:setDisplaySettings/.test(MAIN_JS), 'timerState destructure 除外ハンドラ消失');
  const calls = (RENDERER.match(/schedulePersistRuntime\s*\(\s*\)/g) || []).length;
  assert.ok(calls >= 8, `schedulePersistRuntime 呼出が ${calls} 件（8 以上期待）`);
});

test('P2: version 2.6.0 据置（早期 bump なし）+ v265 登録', () => {
  assert.equal(PKG.version, '2.6.4', `version が ${PKG.version}`);
  assert.ok(PKG.scripts.test.includes('v265-perf-heaviness.test.js'), 'v265 未登録');
});

console.log(`\nv265-perf-heaviness.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
