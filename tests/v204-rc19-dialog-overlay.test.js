/**
 * v2.0.4-rc19 タスク 1（問題 ④ 修正）静的解析テスト
 *
 * 対象修正:
 *   タスク 1（案 A'' + 案 C）: style.css に
 *     - body:has(dialog[open]) [data-role="operator"] .operator-pane に pointer-events: none
 *     - .form-dialog.form-dialog--tabs に z-index: 10000
 *   通常時の operator-pane クリック focus 取得（前原さん運用）は維持される。
 *
 * 実行: node tests/v204-rc19-dialog-overlay.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT  = path.join(__dirname, '..');
const CSS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// タスク 1: 問題 ④（presetName 編集不可）CSS 修正
// ============================================================

test('T1: style.css に body:has(dialog[open]) [data-role="operator"] .operator-pane ルール存在', () => {
  // ホワイトスペース許容で照合
  const re = /body:has\(\s*dialog\[open\]\s*\)\s*\[data-role=["']operator["']\]\s*\.operator-pane\s*\{/;
  assert.match(CSS, re,
    'body:has(dialog[open]) [data-role="operator"] .operator-pane セレクタが見つからない（タスク 1 案 A2 不在）');
});

test('T2: T1 ルール内に pointer-events: none 宣言あり', () => {
  // body:has(dialog[open]) ルールブロック内に pointer-events: none を含む
  const re = /body:has\(\s*dialog\[open\]\s*\)\s*\[data-role=["']operator["']\]\s*\.operator-pane\s*\{[\s\S]*?pointer-events\s*:\s*none\s*;[\s\S]*?\}/;
  assert.match(CSS, re,
    'body:has(dialog[open]) [data-role="operator"] .operator-pane に pointer-events: none 宣言が見つからない');
});

test('T3: style.css に .form-dialog.form-dialog--tabs の z-index: 10000 宣言あり', () => {
  // .form-dialog.form-dialog--tabs ルールブロック内に z-index: 10000 を含む
  const re = /\.form-dialog\.form-dialog--tabs\s*\{[\s\S]*?z-index\s*:\s*10000\s*;[\s\S]*?\}/;
  assert.match(CSS, re,
    '.form-dialog.form-dialog--tabs に z-index: 10000 宣言が見つからない（案 C 不在）');
});

test('T4: .operator-pane 本体ルール（[data-role="operator"] .operator-pane）には pointer-events 宣言が無い（無傷確認）', () => {
  // [data-role="operator"] .operator-pane { ... } の本体ブロックを抽出
  // body:has(...) 修飾子付きはマッチさせないため、行頭から [data-role 始まりに限定
  const m = CSS.match(/(^|\n)\[data-role=["']operator["']\]\s*\.operator-pane\s*\{([\s\S]*?)\}/);
  assert.ok(m, '[data-role="operator"] .operator-pane 本体ルールが見つからない');
  // 本体ブロック内に pointer-events 宣言が含まれないこと
  assert.doesNotMatch(m[2], /pointer-events\s*:/,
    '.operator-pane 本体ルールに pointer-events 宣言が混入（前原さん運用「クリックで window focus 取得」破壊）');
});

// ============================================================
// version assertion（rc19）
// ============================================================

test('version: package.json は 2.0.4-rc19', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.4-rc19',
    `package.json version が ${pkg.version}（期待 2.0.4-rc19）`);
});

// ============================================================
console.log('');
console.log(`Summary: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
