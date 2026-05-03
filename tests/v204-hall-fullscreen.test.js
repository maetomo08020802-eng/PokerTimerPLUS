/**
 * v2.0.4-rc2 — ホール側ウィンドウ自動全画面化 + F11 hall 対応の静的解析テスト
 *
 * 対象修正:
 *   - createHallWindow に fullscreen: true 設定 + ready-to-show での setFullScreen(true) 保険
 *   - toggleFullScreen が getFocusedWindow() で operator / hall の両方を切替可能
 *
 * 実行: node tests/v204-hall-fullscreen.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

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
// T1: createHallWindow の opts に fullscreen: true がある
// ============================================================
test('T1: createHallWindow が opts.fullscreen = true を持つ', () => {
  const body = extractFunctionBody(MAIN, /function createHallWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createHallWindow が見つからない');
  // BrowserWindow の opts 内に fullscreen: true がある（minWidth/minHeight 周辺）
  assert.match(body, /fullscreen:\s*true/,
    'createHallWindow の opts に fullscreen: true なし');
});

// ============================================================
// T2: createHallWindow が ready-to-show 後に setFullScreen(true) を保険として呼ぶ
// ============================================================
test('T2: createHallWindow が ready-to-show で setFullScreen(true) を再適用', () => {
  const body = extractFunctionBody(MAIN, /function createHallWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createHallWindow が見つからない');
  // win.once('ready-to-show', ...) の中で setFullScreen(true) がある
  assert.match(body,
    /once\(\s*['"]ready-to-show['"][\s\S]*?setFullScreen\(\s*true\s*\)/,
    'createHallWindow の ready-to-show コールバックに setFullScreen(true) なし');
});

// ============================================================
// T3: toggleFullScreen が getFocusedWindow を使い operator / hall 両対応
// ============================================================
test('T3: toggleFullScreen は hall を優先、単画面時は mainWindow に fallback（rc6 改修）', () => {
  // v2.0.4-rc6 Fix 3: 「focused window」前提が実運用で崩れる（操作者は PC 側で操作するため
  //   hall focused は発生しない）→ 常に hall を優先、不在時のみ mainWindow（v1.3.0 互換）。
  const body = extractFunctionBody(MAIN, /function toggleFullScreen\s*\(\s*\)\s*\{/);
  assert.ok(body, 'toggleFullScreen が見つからない');
  // hallWindow を優先する三項演算
  assert.match(body, /hallWindow\s*&&\s*!hallWindow\.isDestroyed\(\)\s*\)\s*\?\s*hallWindow\s*:\s*mainWindow/,
    'toggleFullScreen が hallWindow 優先 / mainWindow fallback の三項演算になっていない（rc6 改修）');
  // setFullScreen 呼出がある
  assert.match(body, /setFullScreen\s*\(/, 'setFullScreen 呼出なし');
});

// ============================================================
// T4: F11 が引き続き globalShortcut で登録されている（既存挙動維持）
// ============================================================
test('T4: globalShortcut.register(\'F11\', toggleFullScreen) が維持されている', () => {
  assert.match(MAIN,
    /globalShortcut\.register\(\s*['"]F11['"]\s*,\s*toggleFullScreen\s*\)/,
    'F11 → toggleFullScreen の globalShortcut 登録が消失（既存挙動の互換破壊）');
});

// ============================================================
// T5: createOperatorWindow には fullscreen: true が混入していない（v1.3.0 互換）
// ============================================================
test('T5: createOperatorWindow には fullscreen: true なし（operator-solo 互換）', () => {
  const body = extractFunctionBody(MAIN, /function createOperatorWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createOperatorWindow が見つからない');
  // operator / operator-solo の opts には fullscreen: true 混入していない（v1.3.0 互換）
  assert.doesNotMatch(body, /fullscreen:\s*true/,
    'createOperatorWindow に fullscreen: true 混入（operator-solo / v1.3.0 互換違反）');
});

// ============================================================
// 致命バグ保護 5 件 cross-check
// ============================================================
test('致命バグ保護 cross-check: createHallWindow の race 防止 + closed ハンドラ維持', () => {
  const body = extractFunctionBody(MAIN, /function createHallWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createHallWindow が見つからない');
  assert.match(body, /const\s+win\s*=\s*new\s+BrowserWindow/,
    'createHallWindow が const win = new BrowserWindow パターンを使っていない（v2.0.1 race 修正違反）');
  assert.match(body, /if\s*\(\s*hallWindow\s*===\s*win\s*\)/,
    'createHallWindow の closed で「hallWindow === win」race ガード消失（v2.0.1 違反）');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
