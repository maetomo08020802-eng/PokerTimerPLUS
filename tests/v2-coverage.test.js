/**
 * v2.0.4 Coverage — 残検証 D/E/I/J/K の修正に対応する静的解析テスト
 *
 * 対象 Fix:
 *   D-1  handleTournamentDuplicate に _inFlight 連打ガード追加
 *   E-1  applyTimerStateToTimer の idle / 不正値経路で clock--timer-finished overlay 解除
 *   E-1b doApplyTournament apply-only 経路で clock--timer-finished overlay 解除
 *   B-1  グローバル keydown ガードを document.querySelector('dialog[open]') に汎化
 *
 * 注: I / J は実コードで再現する不具合なし（fix なし、テストも追加しない）
 *
 * 実行: node tests/v2-coverage.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

function extractFunctionBody(source, signaturePattern) {
  const m = source.match(signaturePattern);
  if (!m) return null;
  let depth = 1, i = m.index + m[0].length;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(m.index, i);
}

// ============================================================
// D-1: handleTournamentDuplicate に _inFlight 連打ガードあり
// ============================================================
test('D-1: handleTournamentDuplicate が _inFlight ガードを持つ', () => {
  const body = extractFunctionBody(RENDERER, /async function handleTournamentDuplicate\s*\(\s*\)\s*\{/);
  assert.ok(body, 'handleTournamentDuplicate が見つからない');
  // _inFlight チェック + 設定 + finally 解除がある
  assert.match(body, /handleTournamentDuplicate\._inFlight/,
    'handleTournamentDuplicate._inFlight 参照なし');
  assert.match(body, /if\s*\(\s*handleTournamentDuplicate\._inFlight\s*\)\s*return/,
    '_inFlight チェックの早期 return なし');
  assert.match(body, /handleTournamentDuplicate\._inFlight\s*=\s*true/,
    '_inFlight = true 設定なし');
  assert.match(body, /handleTournamentDuplicate\._inFlight\s*=\s*false/,
    '_inFlight = false 解除なし（finally 内）');
});

test('D-1 cross-check: handleTournamentNew の同 inFlight パターンが維持されている', () => {
  const body = extractFunctionBody(RENDERER, /async function handleTournamentNew\s*\(\s*\)\s*\{/);
  assert.ok(body, 'handleTournamentNew が見つからない');
  assert.match(body, /handleTournamentNew\._inFlight/,
    'handleTournamentNew._inFlight が消失（既存実装の保護）');
});

// ============================================================
// E-1: applyTimerStateToTimer の idle / 不正値経路で finished overlay 解除
// ============================================================
test('E-1: applyTimerStateToTimer の idle 分岐で clock--timer-finished が解除される', () => {
  const body = extractFunctionBody(RENDERER, /function applyTimerStateToTimer\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'applyTimerStateToTimer が見つからない');
  // ts.status === 'idle' で classList.remove('clock--timer-finished') がある
  assert.match(body,
    /ts\.status\s*===\s*['"]idle['"]\s*\)\s*\{[^}]*classList\.remove\(\s*['"]clock--timer-finished['"]/,
    'idle 分岐で clock--timer-finished overlay 解除なし');
});

test('E-1: applyTimerStateToTimer の不正値（!ts || typeof !== object）経路で finished overlay 解除', () => {
  const body = extractFunctionBody(RENDERER, /function applyTimerStateToTimer\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'applyTimerStateToTimer が見つからない');
  // !ts || typeof ts !== 'object' で classList.remove
  assert.match(body,
    /!ts\s*\|\|\s*typeof\s+ts\s*!==\s*['"]object['"][\s\S]{0,200}?classList\.remove\(\s*['"]clock--timer-finished['"]/,
    '不正値経路で clock--timer-finished overlay 解除なし');
});

test('E-1: 既存 finished 設定（status === "finished" → add overlay）は維持されている', () => {
  const body = extractFunctionBody(RENDERER, /function applyTimerStateToTimer\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'applyTimerStateToTimer が見つからない');
  // 'finished' → classList.add は維持
  assert.match(body,
    /ts\.status\s*===\s*['"]finished['"][\s\S]*?classList\.add\(\s*['"]clock--timer-finished['"]/,
    'finished 状態で overlay 付与経路が壊れている（C.1.2 Fix 2 違反）');
});

// ============================================================
// E-1b: doApplyTournament apply-only 経路でも overlay 解除
// ============================================================
test('E-1b: doApplyTournament の apply-only 経路で clock--timer-finished が解除される', () => {
  // doApplyTournament 全体から apply-only ブロックを抽出
  const m = RENDERER.match(/if\s*\(\s*mode\s*===\s*['"]apply-only['"][\s\S]*?return\s*;?\s*\}/);
  assert.ok(m, "doApplyTournament の mode === 'apply-only' ブロックが見つからない");
  assert.match(m[0], /classList\.remove\(\s*['"]clock--timer-finished['"]/,
    'apply-only 経路で clock--timer-finished overlay 解除なし');
});

// ============================================================
// B-1: グローバル keydown ガードが任意の dialog[open] に対応
// ============================================================
test('B-1: ショートカット dispatcher に document.querySelector(\'dialog[open]\') 汎化ガード', () => {
  // v2.0.4-rc4 refactor: ガードは dispatchClockShortcut 内に移動（ローカル keydown / hall IPC 両経路で適用）
  const body = extractFunctionBody(RENDERER, /function dispatchClockShortcut\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'dispatchClockShortcut が見つからない（rc4 refactor で導入された共通 dispatcher）');
  assert.match(body, /document\.querySelector\(\s*['"]dialog\[open\]['"]/,
    'dispatchClockShortcut に document.querySelector("dialog[open]") の汎化ガードなし');
});

// ============================================================
// 致命バグ保護 5 件 — cross-check（影響なし確認）
// ============================================================
test('致命バグ保護 cross-check: resetBlindProgressOnly が clock--timer-finished を引き続き解除', () => {
  const body = extractFunctionBody(RENDERER, /function resetBlindProgressOnly\s*\(\s*\)\s*\{/);
  assert.ok(body, 'resetBlindProgressOnly が見つからない');
  assert.match(body, /classList\.remove\(\s*['"]clock--timer-finished['"]/,
    'resetBlindProgressOnly の overlay 解除が消失（C.1.2 Fix 2 違反）');
  // C.2.7-A 不変条件: tournamentRuntime に触れない
  assert.doesNotMatch(body, /tournamentRuntime\.\w+\s*=/,
    'resetBlindProgressOnly が tournamentRuntime を変更（C.2.7-A 違反）');
});

test('致命バグ保護 cross-check: handleReset が runtime 含めて完全リセット（C.2.7-A 経路区分）', () => {
  const body = extractFunctionBody(RENDERER, /function handleReset\s*\(\s*\)\s*\{/);
  assert.ok(body, 'handleReset が見つからない');
  assert.match(body, /resetTournamentRuntime\s*\(/,
    'handleReset から resetTournamentRuntime 呼出が消失（C.2.7-A 違反）');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
