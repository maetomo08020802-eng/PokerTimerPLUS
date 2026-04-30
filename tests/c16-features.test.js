/**
 * STEP 10 フェーズC.1.6 — 設定ダイアログ wrapper 化 + NEXT BREAK IN ↔ TOTAL GAME TIME 切替
 *
 * 検証対象:
 *   Fix 1: <dialog> 内側 form-dialog__shell wrapper を flex column 化（dialog 自体は flex 化しない）
 *   Fix 2: 残ブレイクなし時の TOTAL GAME TIME 切替（ラベル + 値）
 *
 * 実行: node tests/c16-features.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT     = path.join(__dirname, '..');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const STYLE    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

function extractFunctionBody(source, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = source.match(re);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(start + 1, i); }
  }
  return null;
}

// ============================================================
// T29: form-dialog__shell wrapper 要素が dialog 直下に存在
// ============================================================
test("T29: index.html に <div class='form-dialog__shell'> wrapper が settings-dialog 内", () => {
  // dialog 開始 → 直後に form-dialog__shell wrapper
  assert.match(HTML, /<dialog[^>]*id=["']js-settings-dialog["'][\s\S]*?<div\s+class=["']form-dialog__shell["']/,
    'js-settings-dialog 直下に form-dialog__shell wrapper がない');
  // 閉じタグの存在
  assert.match(HTML, /\/\.form-dialog__shell/,
    'form-dialog__shell 閉じタグマーカーがない（HTML 構造未完了の可能性）');
});

// ============================================================
// T30: .form-dialog__shell の CSS（flex column + height: 100%）
// ============================================================
test('T30: style.css の .form-dialog__shell に display: flex + flex-direction: column + height: 100%', () => {
  const block = STYLE.match(/\.form-dialog__shell\s*\{[\s\S]*?\}/);
  assert.ok(block, '.form-dialog__shell ブロックがない');
  assert.match(block[0], /display:\s*flex/, '.form-dialog__shell に display: flex がない');
  assert.match(block[0], /flex-direction:\s*column/, '.form-dialog__shell に flex-direction: column がない');
  assert.match(block[0], /height:\s*100%/, '.form-dialog__shell に height: 100% がない');
  // 子セレクタの flex-shrink: 0 + body の flex: 1
  assert.match(STYLE, /\.form-dialog__shell\s*>\s*\.form-dialog__body[\s\S]*?flex:\s*1/,
    'form-dialog__shell > .form-dialog__body に flex: 1 がない');
  assert.match(STYLE, /\.form-dialog__shell\s*>\s*\.form-dialog__body[\s\S]*?max-height:\s*none/,
    'form-dialog__shell > .form-dialog__body に max-height: none がない');
});

// ============================================================
// T31: .form-dialog.form-dialog--tabs に display: flex が **無い**（再発防止）
// ============================================================
test('T31: .form-dialog.form-dialog--tabs に display: flex が無い（feedback_dialog_no_flex 厳守）', () => {
  // ブロック抽出
  const block = STYLE.match(/\.form-dialog\.form-dialog--tabs\s*\{[\s\S]*?\}/);
  assert.ok(block, '.form-dialog.form-dialog--tabs ブロックがない');
  // display: flex / flex-direction: column が含まれていないこと
  assert.doesNotMatch(block[0], /display:\s*flex/,
    '.form-dialog.form-dialog--tabs に display: flex が再発（dialog 自体は flex 化禁止）');
  assert.doesNotMatch(block[0], /flex-direction:\s*column/,
    '.form-dialog.form-dialog--tabs に flex-direction: column が再発');
});

// ============================================================
// T32: .settings-tab に max-height が **無い**（撤廃確認）
// ============================================================
test('T32: .settings-tab から max-height: 70vh が撤廃されている', () => {
  // is-active 等の派生セレクタを除外して、.settings-tab 単体ブロックを抽出
  const block = STYLE.match(/^\.settings-tab\s*\{[\s\S]*?\}/m);
  assert.ok(block, '.settings-tab ブロックがない');
  assert.doesNotMatch(block[0], /max-height:/,
    '.settings-tab に max-height が残存（C.1.6 Fix 1 で撤廃のはず）');
});

// ============================================================
// T33: index.html に id="js-next-break-label" が存在
// ============================================================
test('T33: index.html に id="js-next-break-label" が存在', () => {
  assert.match(HTML, /id=["']js-next-break-label["']/, 'js-next-break-label が HTML にない');
  // stat-label クラスの span/div 内（ラベル要素）に紐づく
  assert.match(HTML, /class=["']stat-label["']\s+id=["']js-next-break-label["']/,
    'js-next-break-label が stat-label クラスに紐づいていない');
});

// ============================================================
// T34: renderNextBreak 内で TOTAL GAME TIME 切替ロジック
// ============================================================
test("T34: renderNextBreak が ms === null で 'TOTAL GAME TIME' に切替", () => {
  const body = extractFunctionBody(RENDERER, 'renderNextBreak');
  assert.ok(body, 'renderNextBreak 関数本体抽出失敗');
  // 'TOTAL GAME TIME' 文字列の代入
  assert.match(body, /['"]TOTAL GAME TIME['"]/, "renderNextBreak に 'TOTAL GAME TIME' リテラルがない");
  // ms === null 分岐
  assert.match(body, /ms\s*===\s*null/, 'ms === null の分岐がない');
  // computeTotalGameTimeMs 呼出
  assert.match(body, /computeTotalGameTimeMs\s*\(\s*\)/, 'computeTotalGameTimeMs 呼出がない');
  // 通常時の 'NEXT BREAK IN' 復帰
  assert.match(body, /['"]NEXT BREAK IN['"]/, "通常時の 'NEXT BREAK IN' リテラルがない（else 分岐）");
});

// ============================================================
// T35: computeTotalGameTimeMs が renderer.js に定義されている
// ============================================================
test('T35: computeTotalGameTimeMs 関数が定義されている', () => {
  assert.match(RENDERER, /function\s+computeTotalGameTimeMs\s*\(/, 'computeTotalGameTimeMs 関数定義がない');
  const body = extractFunctionBody(RENDERER, 'computeTotalGameTimeMs');
  assert.ok(body, '関数本体抽出失敗');
  // IDLE / PRE_START で 0 を返す
  assert.match(body, /States\.IDLE\s*\|\|\s*[\s\S]*?States\.PRE_START|States\.PRE_START\s*\|\|\s*[\s\S]*?States\.IDLE/,
    'IDLE / PRE_START で 0 を返す分岐がない');
  // 完了レベルの duration 合計（for ループ）
  assert.match(body, /for\s*\(\s*let\s+i\s*=\s*0[\s\S]*?currentLevelIndex/,
    '完了レベル合計の for ループがない');
  // 現在レベル: dur - remainingMs
  assert.match(body, /dur\s*-\s*remainingMs|durationMinutes[\s\S]*?remainingMs/,
    '現在レベル経過分の計算がない');
});

// ============================================================
// 不変条件: 致命バグ修正の保護（C.2.7-A）
// ============================================================
test('T36: handlePresetApply の reset 分岐は引き続き resetBlindProgressOnly（致命バグ保護）', () => {
  const body = extractFunctionBody(RENDERER, 'handlePresetApply');
  assert.ok(body, 'handlePresetApply 関数本体抽出失敗');
  assert.match(body, /resetBlindProgressOnly\s*\(\s*\)/,
    'handlePresetApply 内で resetBlindProgressOnly が呼ばれていない（致命バグリグレッション）');
});

console.log(`\n=== Summary: ${pass} passed / ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
