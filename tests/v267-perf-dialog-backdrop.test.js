/**
 * v2.6.0 perf-dialog-backdrop（2026-06-08）
 *
 * 設定ダイアログ（S キー）激重の主因＝ダイアログ ::backdrop の backdrop-filter: blur(4px)。
 * ダイアログ中央のみ覆い、外周は backdrop 下で動き続けるメイン画面（RUNNING 中 60fps＋marquee）が
 * 透けるため全画面ぼかしを毎フレーム再計算 → 非力 GPU で激重。blur を撤去し暗幕 rgba は維持。
 *
 * 退行防止: .confirm-dialog::backdrop / .form-dialog::backdrop に backdrop-filter が無いこと +
 *   暗幕 rgba(0,0,0,0.7) が残ることを静的検証。
 *
 * 実行: node tests/v267-perf-dialog-backdrop.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT  = path.join(__dirname, '..');
const PKG   = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const STYLE = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// コメント除去（説明コメント内の "backdrop-filter" 等による誤検出回避）
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}
const STYLE_NC = stripComments(STYLE);

// ::backdrop 規則のブロック本文を抽出（コメント除去後）
function backdropBlock(selector) {
  const i = STYLE_NC.indexOf(selector + ' {');
  if (i < 0) return null;
  const open = STYLE_NC.indexOf('{', i);
  const close = STYLE_NC.indexOf('}', open);
  return (open >= 0 && close >= 0) ? STYLE_NC.slice(open + 1, close) : null;
}

test('D1: .confirm-dialog::backdrop に backdrop-filter が無い / 暗幕 rgba 維持', () => {
  const blk = backdropBlock('.confirm-dialog::backdrop');
  assert.ok(blk !== null, '.confirm-dialog::backdrop が見つからない');
  assert.ok(!/backdrop-filter/.test(blk), '.confirm-dialog::backdrop に backdrop-filter が残存');
  assert.match(blk, /background-color:\s*rgba\(0,\s*0,\s*0,\s*0\.7\)/, '暗幕 rgba(0,0,0,0.7) が消えた');
});

test('D2: .form-dialog::backdrop に backdrop-filter が無い / 暗幕 rgba 維持', () => {
  const blk = backdropBlock('.form-dialog::backdrop');
  assert.ok(blk !== null, '.form-dialog::backdrop が見つからない');
  assert.ok(!/backdrop-filter/.test(blk), '.form-dialog::backdrop に backdrop-filter が残存');
  assert.match(blk, /background-color:\s*rgba\(0,\s*0,\s*0,\s*0\.7\)/, '暗幕 rgba(0,0,0,0.7) が消えた');
});

test('D3: style.css 全体（コメント除去後）に backdrop-filter 宣言が 0 件（::backdrop 含む全 overlay）', () => {
  // .card は既撤去。fade-in-soft は filter:blur（backdrop-filter ではない）で対象外。
  assert.ok(!/backdrop-filter\s*:/.test(STYLE_NC), 'backdrop-filter 宣言が残存している');
  assert.ok(!/-webkit-backdrop-filter\s*:/.test(STYLE_NC), '-webkit-backdrop-filter 宣言が残存している');
});

test('D4: ::backdrop 規則は 2 つだけ（confirm / form）＝個別 overlay の見落とし防止', () => {
  const count = (STYLE_NC.match(/::backdrop\s*\{/g) || []).length;
  assert.equal(count, 2, `::backdrop 規則が ${count} 個（confirm/form の 2 個を想定）`);
});

test('P1: version 2.6.0 据置（早期 bump なし）+ v267 登録', () => {
  assert.equal(PKG.version, '2.10.0', `version が ${PKG.version}`);
  assert.ok(PKG.scripts.test.includes('v267-perf-dialog-backdrop.test.js'), 'v267 未登録');
});

console.log(`\nv267-perf-dialog-backdrop.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
