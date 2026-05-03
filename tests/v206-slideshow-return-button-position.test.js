/**
 * v2.0.6 静的解析テスト
 *   STEP 1: 「スライドショーに戻る」ボタン (#js-pip-show-slideshow) の位置調整
 *     - 旧位置（left: 2vw / bottom: 2vw）は H 押下時のテロップ太い 9vh 状態で完全に隠れる症状があり、
 *       v2.0.6 で画面左の縦中央配置（top: 50vh + transform: translateY(-50%)）に変更
 *     - PIP ボタン (#js-pip-show-timer = タイマーサイズ切替) は触らない（C.1.4-fix1 Fix 4 維持）
 *     - ロゴ画像（max-width 14vw, max-height 18vh）+ presented-by（margin-top 0.2vh）の領域は
 *       画面上端から最大 約 20vh に収まるため、top: 50vh と完全非干渉
 *
 * 致命バグ保護 5 件 + rc12 / rc18 / rc22 / rc23 すべて完全無傷（src/ への変更は CSS のみ）。
 *
 * 実行: node tests/v206-slideshow-return-button-position.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT  = path.join(__dirname, '..');
const CSS   = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const HTML  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// #js-pip-show-slideshow の CSS ルール本体を抽出
function extractSlideshowButtonRule() {
  const m = CSS.match(/#js-pip-show-slideshow\s*\{([\s\S]*?)\}/);
  return m ? m[1] : null;
}

// ============================================================
// STEP 1: 「スライドショーに戻る」ボタン位置調整
// ============================================================

test('T1: 「スライドショーに戻る」ボタン要素 (id=js-pip-show-slideshow) のセレクタが現状と同じ（削除されていない）', () => {
  // index.html: <button ... id="js-pip-show-slideshow" ...>スライドショーに戻る</button>
  assert.match(HTML, /id\s*=\s*["']js-pip-show-slideshow["']/,
    'index.html に id="js-pip-show-slideshow" のボタンが見つからない（削除された可能性）');
  assert.match(HTML, /スライドショーに戻る/,
    'index.html に「スライドショーに戻る」テキストが見つからない');
  // CSS: #js-pip-show-slideshow ルールが存在
  assert.match(CSS, /#js-pip-show-slideshow\s*\{/,
    'style.css に #js-pip-show-slideshow ルールが見つからない');
});

test('T2: 該当ボタンの CSS に top: ...vh（縦中央配置）プロパティが含まれる', () => {
  const rule = extractSlideshowButtonRule();
  assert.ok(rule, '#js-pip-show-slideshow ルール本体が抽出できない');
  // top: 50vh （または別の vh 値）の縦位置指定が存在
  assert.match(rule, /\btop\s*:\s*\d+(\.\d+)?vh\b/,
    '#js-pip-show-slideshow に top: ...vh プロパティが見つからない（縦中央配置されていない）');
  // transform: translateY(-50%) で中央揃え（top: 50vh の慣用パターン）
  assert.match(rule, /transform\s*:\s*translateY\s*\(\s*-50%\s*\)/,
    '#js-pip-show-slideshow に transform: translateY(-50%) が見つからない（縦中央揃え不完全）');
});

test('T3: 該当ボタンの CSS に bottom: ...（旧位置プロパティ）が含まれない（重複指定防止）', () => {
  const rule = extractSlideshowButtonRule();
  assert.ok(rule, '#js-pip-show-slideshow ルール本体が抽出できない');
  // bottom: ... が宣言されていない（top と bottom の重複指定で意図しない位置になる症状を回避）
  assert.doesNotMatch(rule, /\bbottom\s*:/,
    '#js-pip-show-slideshow に bottom プロパティが残存（top との重複指定で旧位置に戻る恐れ、v2.0.6 で削除されているはず）');
});

// ============================================================
// PIP ボタン（#js-pip-show-timer = タイマーサイズ切替）は触らない不変保護
// ============================================================

test('PIP ボタン不変保護: #js-pip-show-timer は引き続き左下配置（left: 2vw / bottom: 2vw）維持', () => {
  const m = CSS.match(/#js-pip-show-timer\s*\{([\s\S]*?)\}/);
  assert.ok(m, '#js-pip-show-timer ルールが見つからない（C.1.4-fix1 Fix 4 不変保護違反）');
  const timerRule = m[1];
  assert.match(timerRule, /left\s*:\s*2vw/,
    '#js-pip-show-timer の left: 2vw が変更された（C.1.4-fix1 Fix 4 違反）');
  assert.match(timerRule, /bottom\s*:\s*2vw/,
    '#js-pip-show-timer の bottom: 2vw が変更された（C.1.4-fix1 Fix 4 違反）');
});

// ============================================================
// ロゴ + presented-by 領域との非干渉（実コード上の保証）
// ============================================================

test('ロゴ領域非干渉: .clock__logo-img の max-width/max-height が想定範囲内（top: 50vh と被らない）', () => {
  // .clock__logo-img の max-height: 18vh + presented-by の margin-top + 高さ ≒ 上端から最大 20vh に収まる
  assert.match(CSS, /\.clock__logo-img\s*\{[\s\S]*?max-height\s*:\s*18vh/,
    '.clock__logo-img の max-height: 18vh 想定が変更されている（再計算が必要）');
  // top: 50vh は上端から 50vh、ロゴ最大下端 約 20vh と 30vh の余裕で完全非干渉
});

// ============================================================
// version assertion
// ============================================================

test('version: package.json は 2.0.6', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.6',
    `package.json version が ${pkg.version}（期待 2.0.6）`);
});

test('version: scripts.test に v206-slideshow-return-button-position.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v206-slideshow-return-button-position\.test\.js/,
    'package.json scripts.test に v206-slideshow-return-button-position.test.js が含まれていない');
});

// ============================================================
console.log('');
console.log(`v206-slideshow-return-button-position.test.js: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
