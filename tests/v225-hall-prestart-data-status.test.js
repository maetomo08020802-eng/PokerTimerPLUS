/**
 * v2.1.13 静的解析テスト — hall 側 PRE_START の data-status セット漏れ根治
 *
 *   Fix 1: src/renderer/renderer.js renderHallPreStartTick 内で毎フレーム
 *          el.clock.dataset.status = 'PRE_START' をセット
 *   Fix 2: src/renderer/renderer.js applyHallPreStartState の isActive=false 経路で
 *          el.clock.dataset.status = 'IDLE' + delete el.clock.dataset.prestartFormat
 *
 * 真因: v2.0.3「PRE_START は永続化しない」設計により hall 側 state.status は IDLE のまま、
 *   renderControls 経由では el.clock.dataset.status が PRE_START にならない。
 *   CSS の `.clock[data-status="PRE_START"] .clock__pre-start-label` 表示と
 *   `.clock[data-status="PRE_START"][data-prestart-format="hms|ms"] .clock__time` の
 *   フォーマット切替が発火せず「トーナメントスタートまで」ラベルが消失していた。
 *   v2.1.6 から潜伏した data-status セット漏れの根治（v2.1.12 の el.clockTime → el.time
 *   typo 修正で時間表示は出るようになったが、ラベルとフォーマット切替は残課題だった）。
 *
 * 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）。
 *
 * 実行: node tests/v225-hall-prestart-data-status.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const PKG      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const MAIN_JS  = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const AUDIO_JS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

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
// T1 (Fix 1): renderHallPreStartTick 内で el.clock.dataset.status = 'PRE_START' セット
// ============================================================
test('T1 (Fix 1): renderHallPreStartTick 内で el.clock.dataset.status = "PRE_START" セット存在', () => {
  const rawBody = extractFnBody(RENDERER, /function\s+renderHallPreStartTick\s*\([^)]*\)\s*\{/);
  assert.ok(rawBody, 'renderHallPreStartTick 関数本体が抽出できない');
  // コメント剥がし
  const body = rawBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // el.clock.dataset.status = 'PRE_START' の代入が存在
  assert.match(body, /el\.clock\.dataset\.status\s*=\s*['"]PRE_START['"]/,
    'renderHallPreStartTick 内に el.clock.dataset.status = "PRE_START" の代入がない');
});

// ============================================================
// T2 (Fix 1): セット位置が el.time.textContent = formatPreStartTime(...) と同ブロック内
// ============================================================
test('T2 (Fix 1): el.clock.dataset.status="PRE_START" セットが el.time 書込同ブロック内', () => {
  const rawBody = extractFnBody(RENDERER, /function\s+renderHallPreStartTick\s*\([^)]*\)\s*\{/);
  assert.ok(rawBody, 'renderHallPreStartTick 関数本体が抽出できない');
  const body = rawBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // el.time.textContent = formatPreStartTime(...) → ... → el.clock.dataset.status = 'PRE_START' の順序を確認
  assert.match(body, /el\.time\.textContent\s*=\s*formatPreStartTime[\s\S]{0,500}?el\.clock\.dataset\.status\s*=\s*['"]PRE_START['"]/,
    'el.time.textContent 書込 → el.clock.dataset.status = "PRE_START" の順序になっていない');
  // prestartFormat 属性も同ブロック内でセットされている（Fix 1 の隣接、既存挙動維持）
  assert.match(body, /el\.clock\.dataset\.status\s*=\s*['"]PRE_START['"][\s\S]{0,300}?el\.clock\.dataset\.prestartFormat\s*=/,
    'data-status="PRE_START" セット直後に prestartFormat 属性セットが続いていない（既存隣接挙動の崩壊）');
});

// ============================================================
// T3 (Fix 2): applyHallPreStartState の isActive=false 経路で data-status="IDLE" 復元
// ============================================================
test('T3 (Fix 2): applyHallPreStartState の解除経路で el.clock.dataset.status = "IDLE" 代入', () => {
  const rawBody = extractFnBody(RENDERER, /function\s+applyHallPreStartState\s*\([^)]*\)\s*\{/);
  assert.ok(rawBody, 'applyHallPreStartState 関数本体が抽出できない');
  const body = rawBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // hallPreStartState.startAtMs = 0 直後付近に el.clock.dataset.status = 'IDLE' が存在
  assert.match(body, /hallPreStartState\.startAtMs\s*=\s*0;[\s\S]{0,500}?el\.clock\.dataset\.status\s*=\s*['"]IDLE['"]/,
    'isActive=false 解除経路に el.clock.dataset.status = "IDLE" 復元コードがない');
});

// ============================================================
// T4 (Fix 2): 同経路で delete el.clock.dataset.prestartFormat
// ============================================================
test('T4 (Fix 2): applyHallPreStartState 解除経路で delete el.clock.dataset.prestartFormat', () => {
  const rawBody = extractFnBody(RENDERER, /function\s+applyHallPreStartState\s*\([^)]*\)\s*\{/);
  assert.ok(rawBody, 'applyHallPreStartState 関数本体が抽出できない');
  const body = rawBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.match(body, /delete\s+el\.clock\.dataset\.prestartFormat/,
    'isActive=false 解除経路に delete el.clock.dataset.prestartFormat がない');
  // status="IDLE" 代入と delete prestartFormat が同じブロック内（隣接）
  assert.match(body, /el\.clock\.dataset\.status\s*=\s*['"]IDLE['"][\s\S]{0,200}?delete\s+el\.clock\.dataset\.prestartFormat/,
    'status="IDLE" 代入直後に delete prestartFormat が続いていない');
});

// ============================================================
// T5: package.json version 2.1.13 + scripts.test に v225 登録
// ============================================================
test('T5: package.json version は 2.1.13 + scripts.test に v225 登録', () => {
  assert.equal(PKG.version, '2.1.15',
    `package.json version が ${PKG.version}（期待 2.1.15）`);
  assert.match(PKG.scripts.test, /v225-hall-prestart-data-status\.test\.js/,
    'scripts.test に v225-hall-prestart-data-status.test.js が登録されていない');
});

// ============================================================
// T6: 致命バグ保護 5 件すべて維持
// ============================================================
test('T6: 致命バグ保護 5 件すべて維持', () => {
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
// T7: hallPreStartState / hallTickState / renderHallTickFrame 機構（v2.1.11）に touch なし
// ============================================================
test('T7: v2.1.11 機構（hallPreStartState / hallTickState / renderHallTickFrame）touch なし', () => {
  // hallPreStartState 状態オブジェクト定義維持
  assert.match(RENDERER, /const\s+hallPreStartState\s*=\s*\{/,
    'hallPreStartState 定義が消えている（v2.1.6 機構の core）');
  // hallTickState 状態オブジェクト定義維持（v2.1.11 60fps tick）
  assert.match(RENDERER, /const\s+hallTickState\s*=\s*\{/,
    'hallTickState 定義が消えている（v2.1.11 60fps tick の core）');
  // renderHallPreStartTick 関数維持
  assert.match(RENDERER, /function\s+renderHallPreStartTick\s*\(/,
    'renderHallPreStartTick 関数が消えている');
  // renderHallTickFrame 関数維持（v2.1.11 RUNNING/BREAK 60fps tick）
  assert.match(RENDERER, /function\s+renderHallTickFrame\s*\(/,
    'renderHallTickFrame 関数が消えている');
  // 自己再帰 rAF（renderHallPreStartTick 内に requestAnimationFrame で再帰）維持
  const rawBody = extractFnBody(RENDERER, /function\s+renderHallPreStartTick\s*\([^)]*\)\s*\{/);
  assert.ok(rawBody, 'renderHallPreStartTick 関数本体が抽出できない');
  assert.match(rawBody, /requestAnimationFrame\s*\(\s*renderHallPreStartTick\s*\)/,
    'renderHallPreStartTick の自己再帰 rAF が消えている（v2.1.11 機構）');
  // v2.1.12 で確立した el.time 書込経路維持（v2.1.13 で改変なし）
  assert.match(rawBody, /el\.time\.textContent\s*=\s*formatPreStartTime/,
    'v2.1.12 で確立した el.time.textContent = formatPreStartTime 経路が消えている');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
