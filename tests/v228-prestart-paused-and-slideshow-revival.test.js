/**
 * v2.1.16 静的解析テスト — ① PRE_START 一時停止 hall 同期完全根治 + 試験 4 退行根治
 *
 *   Fix 1: renderer.js `onPreStartAdjust` で isPaused 現状値保持送信（① 根治、operator 側）
 *   Fix 2: renderer.js `onPreStartTick` で isPaused:false 明示送信（① 根治防御）
 *   Fix 3: renderer.js `applyHallPreStartState` で isPaused フィールド未指定時は現状値維持（① 根治防御二重化、hall 側）
 *   Fix 4: renderer.js `isSlideshowEligibleStatus` を拡張、BREAK 行中 / PRE_START active 中の PAUSED でも true（試験 4 退行根治）
 *
 * 真因: v2.1.15 で `onPreStartPause` 単発送信のみで isPaused:true が維持される設計だったが、
 *   PAUSED 中の `→ キー` 連打 → onPreStartAdjust 発火 → isPaused フィールド付け忘れで
 *   hall 側 isPaused が false に上書き → rAF 再開 → カウントダウン進行（v2.1.15 残課題）。
 *
 * 試験 4 退行: v2.1.15 で BREAK 検出機能 → BREAK 中 PAUSE → 「タイマーに戻す」→「スライドショーに戻る」
 *   → handlePipShowSlideshow 内 isSlideshowEligibleStatus(PAUSED)=false → activateSlideshow skip。
 *   既存潜伏バグだが BREAK 検出が機能して初めて顕在化。
 *
 * 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）。
 *
 * 実行: node tests/v228-prestart-paused-and-slideshow-revival.test.js
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
const STYLE_CSS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const AUDIO_JS  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1 (Fix 1): onPreStartAdjust で isPreStartActive() + status===PAUSED 判定 + isPaused 付き送信
// ============================================================
test('T1 (Fix 1): onPreStartAdjust 内に isPreStartActive() 呼出 + PAUSED 判定 + isPaused 付き送信', () => {
  // onPreStartAdjust ハンドラ本体抽出（balanced brace なし、行レベル）
  const adjustMatch = RENDERER.match(/onPreStartAdjust:\s*\(\s*\{[^}]*\}\s*\)\s*=>\s*\{([\s\S]*?)\n\s*\}\s*\}\)/);
  assert.ok(adjustMatch, 'onPreStartAdjust ハンドラ本体が抽出できない');
  const body = adjustMatch[1];
  // isPreStartActive() 呼出
  assert.match(body, /isPreStartActive\s*\(\s*\)/,
    'onPreStartAdjust 内に isPreStartActive() 呼出がない（Fix 1 未実装）');
  // status === States.PAUSED 判定
  assert.match(body, /status\s*===\s*States\.PAUSED/,
    'onPreStartAdjust 内に status === States.PAUSED 判定がない');
  // publishPreStartIfOperator に isPaused フィールド送信
  assert.match(body, /publishPreStartIfOperator\s*\(\s*\{[^}]*isPaused[^}]*\}\s*\)/,
    'onPreStartAdjust の publishPreStartIfOperator に isPaused フィールドがない');
});

// ============================================================
// T2 (Fix 2): onPreStartTick 内 publishPreStartIfOperator に isPaused: false 明示
// ============================================================
test('T2 (Fix 2): onPreStartTick 内 publishPreStartIfOperator に isPaused: false 明示', () => {
  // onPreStartTick ハンドラ本体抽出
  const tickMatch = RENDERER.match(/onPreStartTick:\s*\(\s*remainingMs\s*\)\s*=>\s*\{([\s\S]*?)\n\s*\},/);
  assert.ok(tickMatch, 'onPreStartTick ハンドラ本体が抽出できない');
  const body = tickMatch[1];
  assert.match(body, /publishPreStartIfOperator\s*\(\s*\{[^}]*isPaused:\s*false[^}]*\}\s*\)/,
    'onPreStartTick の publishPreStartIfOperator に isPaused: false フィールドが明示されていない（Fix 2 未実装）');
});

// ============================================================
// T3 (Fix 3): applyHallPreStartState 内に hasOwnProperty(payload, 'isPaused') 検査 + 未指定時 hallPreStartState.isPaused 維持
// ============================================================
test('T3 (Fix 3): applyHallPreStartState 内 isPaused 受信に hasOwnProperty 検査 + 現状値維持', () => {
  const fnMatch = RENDERER.match(/function\s+applyHallPreStartState\s*\([^)]*\)\s*\{([\s\S]*?\n\})/);
  assert.ok(fnMatch, 'applyHallPreStartState 関数本体が見当たらない');
  const body = fnMatch[1];
  // Object.prototype.hasOwnProperty.call(payload, 'isPaused')
  assert.match(body, /Object\.prototype\.hasOwnProperty\.call\s*\(\s*payload\s*,\s*['"]isPaused['"]\s*\)/,
    'applyHallPreStartState 内に hasOwnProperty(payload, "isPaused") 検査がない（Fix 3 未実装）');
  // : hallPreStartState.isPaused（else 経路）
  assert.match(body, /hallPreStartState\.isPaused/,
    'applyHallPreStartState の isPaused 算出に hallPreStartState.isPaused 参照（現状値維持）がない');
  // isActive と isPaused が別行で抽出される構造は崩していない
  assert.match(body, /const\s+isActive\s*=\s*!!payload\.isActive/,
    'applyHallPreStartState 内の isActive 抽出が消失');
});

// ============================================================
// T4 (Fix 4): isSlideshowEligibleStatus が PAUSED 経路で getState().currentLevelIndex + isBreakLevel(...) を持つ
// ============================================================
test('T4 (Fix 4): isSlideshowEligibleStatus に PAUSED + isBreakLevel(currentLevelIndex) 経路', () => {
  const fnMatch = RENDERER.match(/function\s+isSlideshowEligibleStatus\s*\(\s*status\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(fnMatch, 'isSlideshowEligibleStatus 関数本体が見当たらない');
  const body = fnMatch[1];
  // PAUSED 経路
  assert.match(body, /status\s*===\s*States\.PAUSED/,
    'isSlideshowEligibleStatus 内に status === States.PAUSED 経路がない（Fix 4 未実装）');
  // currentLevelIndex 抽出
  assert.match(body, /currentLevelIndex/,
    'PAUSED 経路で currentLevelIndex 抽出がない');
  // isBreakLevel 呼出
  assert.match(body, /isBreakLevel\s*\(\s*currentLevelIndex\s*\)/,
    'PAUSED 経路で isBreakLevel(currentLevelIndex) 呼出がない');
});

// ============================================================
// T5 (Fix 4): isSlideshowEligibleStatus PAUSED 経路で hall hallPreStartState.isActive も含む
// ============================================================
test('T5 (Fix 4): isSlideshowEligibleStatus PAUSED 経路 hall PRE_START active 継続経路', () => {
  const fnMatch = RENDERER.match(/function\s+isSlideshowEligibleStatus\s*\(\s*status\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(fnMatch, 'isSlideshowEligibleStatus 関数本体が見当たらない');
  const body = fnMatch[1];
  // PAUSED ブロックの開始位置 → 関数末尾までで balanced brace 抽出
  const pausedStartIdx = body.search(/if\s*\(\s*status\s*===\s*States\.PAUSED\s*\)\s*\{/);
  assert.ok(pausedStartIdx >= 0, 'PAUSED if ブロックが見当たらない');
  const fromPaused = body.slice(pausedStartIdx);
  // 以降に hallPreStartState.isActive チェック
  // 関数末尾の return false の前に PAUSED ブロックが閉じる、その範囲内に hallPreStartState.isActive
  const beforeReturn = fromPaused.split(/return\s+false/)[0];
  assert.match(beforeReturn, /hallPreStartState\.isActive/,
    'isSlideshowEligibleStatus PAUSED 経路に hallPreStartState.isActive 経路がない');
});

// ============================================================
// T6: 通常レベル中の PAUSED は引き続き false 返却（既存挙動維持）
// ============================================================
test('T6: isSlideshowEligibleStatus 末尾は return false（通常レベル PAUSED は false 維持）', () => {
  const fnMatch = RENDERER.match(/function\s+isSlideshowEligibleStatus\s*\(\s*status\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(fnMatch, 'isSlideshowEligibleStatus 関数本体が見当たらない');
  const body = fnMatch[1];
  // 関数末尾に return false
  assert.match(body, /return\s+false\s*;?\s*$/m,
    'isSlideshowEligibleStatus 末尾に return false がない（通常レベル PAUSED が true 返却される可能性）');
});

// ============================================================
// T7 (Fix 5): package.json version 2.1.16
// ============================================================
test('T7 (Fix 5): package.json version が 2.1.16', () => {
  assert.equal(PKG.version, '2.5.1', `package.json version が 2.1.16 ではない（実際: ${PKG.version}）`);
});

// ============================================================
// T8: 致命バグ保護 5 件 cross-check
// ============================================================
test('T8: 致命バグ保護 5 件すべて維持（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）', () => {
  // C.2.7-A: resetBlindProgressOnly 関数が存在
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'C.2.7-A: resetBlindProgressOnly 関数が消失');
  // C.2.7-D: tournaments:setDisplaySettings ハンドラ存在
  assert.match(MAIN_JS, /tournaments:setDisplaySettings/,
    'C.2.7-D: tournaments:setDisplaySettings ハンドラが消失');
  // C.1-A2: ensureEditorEditableState 関数が存在
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'C.1-A2: ensureEditorEditableState 関数が消失');
  // C.1.7: AudioContext resume 防御
  assert.match(AUDIO_JS, /\.resume\s*\(\s*\)/,
    'C.1.7: AudioContext resume 防御が消失');
  // C.1.8: schedulePersistRuntime 関数 + 8 箇所以上の呼出
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/,
    'C.1.8: schedulePersistRuntime 関数が消失（renderer.js）');
  const callCount = (RENDERER.match(/schedulePersistRuntime\s*\(/g) || []).length;
  assert.ok(callCount >= 9, `C.1.8: schedulePersistRuntime 出現回数が ${callCount} 件（9 件以上必要）`);
});

// ============================================================
// T9: v2.1.6〜v2.1.15 機構（onPreStartPause / hallPreStartState.isPaused 等）touch なし
// ============================================================
test('T9: v2.1.6〜v2.1.15 機構すべて完全保持（v2.1.15 onPreStartPause / hallPreStartState.isPaused / dataset.prestartPaused / computeHeaderLevelText / isBreakLevel import / 構造同期 2 穴根治）', () => {
  // v2.1.6 PRE_START broadcast: onPreStartCancel
  assert.match(RENDERER, /onPreStartCancel:\s*\(\s*\)\s*=>\s*\{\s*publishPreStartIfOperator\s*\(\s*\{\s*isActive:\s*false\s*\}\s*\)/,
    'v2.1.6 onPreStartCancel broadcast 経路消失');
  // v2.1.15 onPreStartPause: 単発専用ハンドラが存在
  assert.match(RENDERER, /onPreStartPause:\s*\(\s*\{[\s\S]*?remainingMs[\s\S]*?\}\s*\)\s*=>/,
    'v2.1.15 onPreStartPause ハンドラ消失');
  // v2.1.15 onPreStartResume
  assert.match(RENDERER, /onPreStartResume:\s*\(\s*\{[\s\S]*?remainingMs[\s\S]*?\}\s*\)\s*=>/,
    'v2.1.15 onPreStartResume ハンドラ消失');
  // v2.1.15 hallPreStartState.isPaused 拡張
  const hpsMatch = RENDERER.match(/const\s+hallPreStartState\s*=\s*\{([^}]+)\}/);
  assert.ok(hpsMatch, 'hallPreStartState 定義が見当たらない');
  assert.match(hpsMatch[1], /isPaused:\s*false/, 'v2.1.15 hallPreStartState.isPaused 初期値消失');
  // v2.1.15 dataset.prestartPaused セット
  assert.match(RENDERER, /dataset\.prestartPaused\s*=\s*['"]true['"]/,
    'v2.1.15 dataset.prestartPaused="true" セット消失');
  // v2.1.15 computeHeaderLevelText
  assert.match(RENDERER, /function\s+computeHeaderLevelText\s*\(/,
    'v2.1.15 computeHeaderLevelText 関数消失');
  // v2.1.15 isBreakLevel import
  const importBlock = RENDERER.match(/import\s*\{[^}]*\}\s*from\s*['"]\.\/blinds\.js['"]/);
  assert.ok(importBlock && /\bisBreakLevel\b/.test(importBlock[0]),
    'v2.1.15 isBreakLevel import 消失');
  // v2.1.14 構造同期 2 穴根治
  assert.match(MAIN_JS, /_publishDualState\s*\(\s*['"]structure['"]\s*,\s*preset\s*\)/,
    'v2.1.14 tournaments:setActive structure broadcast 消失');
  assert.match(MAIN_JS, /snapshot\.structure\s*===\s*null/,
    'v2.1.14 dual:state-sync-init 内の snapshot.structure === null ガード消失');
  // v2.1.13 PRE_START data-status セット経路
  assert.match(RENDERER, /el\.clock\.dataset\.status\s*=\s*['"]PRE_START['"]/,
    'v2.1.13 data-status PRE_START セット経路消失');
  // v2.1.11 hall 60fps tick
  assert.match(RENDERER, /function\s+renderHallTickFrame\s*\(/,
    'v2.1.11 renderHallTickFrame 関数消失');
});

// ============================================================
// T10: v2.1.15-rc1 計測ログ 6 ラベル 0 件維持。
//   measurement-mode-badge は本番では 0 件、-rcN ビルド（v2.1.15-rc1 / v2.1.17-rc1）では復活許容。
// ============================================================
test('T10: v2.1.15-rc1 計測ログ 6 ラベル 0 件維持 + measurement-mode-badge は本番のみ 0 件', () => {
  const labels = [
    'meas:structure:publish',
    'meas:structure:recv',
    'meas:isBreakLevel:check',
    'meas:preset:save',
    'meas:headerLevel:render',
    'meas:timer:pause:enter'
  ];
  // v2.1.15-rc1 の 6 ラベルは v2.1.17-rc1 でも撤去状態維持（v2.1.17-rc1 は別ラベルを導入）
  for (const label of labels) {
    assert.ok(!MAIN_JS.includes(label), `main.js に ${label} が残存（rc1 撤去状態が崩れている）`);
    assert.ok(!RENDERER.includes(label), `renderer.js に ${label} が残存`);
    assert.ok(!TIMER_JS.includes(label), `timer.js に ${label} が残存`);
  }
  // measurement-mode-badge は -rcN ビルドでは復活許容（観測ビルド識別用、v2.1.15-rc1 / v2.1.17-rc1 共通パターン）
  const isRc = /-rc\d+/.test(PKG.version || '');
  if (isRc) return;
  assert.ok(!INDEX_HTML.includes('measurement-mode-badge'),
    'index.html に measurement-mode-badge が残存（本番ビルドでは撤去必須）');
  assert.ok(!STYLE_CSS.includes('measurement-mode-badge'),
    'style.css に measurement-mode-badge が残存（本番ビルドでは撤去必須）');
  assert.ok(!RENDERER.includes('measurement-mode-badge'),
    'renderer.js に measurement-mode-badge が残存（本番ビルドでは撤去必須）');
});

console.log(`\n結果: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
