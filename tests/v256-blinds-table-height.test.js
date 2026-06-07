/**
 * settings-scope-clarity STEP3 — ブラインドのレベル表を縦に広げる（6段→10〜12段、フッタ常時可視）
 *
 * 検証対象（CSS レイアウトのみ。JS・保存ロジック・他タブ非接触）:
 *   - table-wrap の約6段固定（旧 max-height:36vh）を撤廃し flex 連動の内側スクロール領域に
 *   - blinds タブのみ flex column 化（他タブは display:block のまま）
 *   - footer / add-row を flex-shrink:0 で常時可視
 *   - 既定ダイアログ高を引き上げ（700→920px）
 *   - sticky thead 維持 / <dialog> に flex 足さない / position:fixed・transform:scale 不使用
 *
 * 実行: node tests/v256-blinds-table-height.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT  = path.join(__dirname, '..');
const STYLE = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

function cssBlock(selectorRegexSource) {
  const re = new RegExp(`${selectorRegexSource}\\s*\\{[\\s\\S]*?\\}`);
  return STYLE.match(re);
}

// ============================================================
// table-wrap: 約6段固定の撤廃 + flex 化
// ============================================================
test('T1: .blinds-editor__table-wrap から max-height:36vh が撤廃され flex 連動に', () => {
  const block = cssBlock('\\.blinds-editor__table-wrap');
  assert.ok(block, '.blinds-editor__table-wrap ブロックがない');
  assert.doesNotMatch(block[0], /max-height:\s*36vh/, '約6段固定（max-height:36vh）が残存');
  assert.doesNotMatch(block[0], /max-height:/, 'table-wrap に max-height が残存（段数制限の恐れ）');
  assert.match(block[0], /flex:\s*1\s+1\s+auto/, 'flex:1 1 auto がない（余剰高を吸収しない）');
  assert.match(block[0], /min-height:\s*0/, 'min-height:0 がない（footer 押し出しの恐れ）');
  assert.match(block[0], /overflow-y:\s*auto/, '内側スクロール（overflow-y:auto）がない');
});

// ============================================================
// blinds タブのみ flex column 化（他タブ非破壊）
// ============================================================
test('T2: blinds タブのみ flex column 化（属性セレクタで is-active を上書き）', () => {
  const block = cssBlock('\\.settings-tab\\[data-tab="blinds"\\]\\.is-active');
  assert.ok(block, '.settings-tab[data-tab="blinds"].is-active ブロックがない');
  assert.match(block[0], /display:\s*flex/, 'blinds タブが flex 化されていない');
  assert.match(block[0], /flex-direction:\s*column/, 'flex-direction:column がない');
  assert.match(block[0], /min-height:\s*0/, 'min-height:0 がない');
});

test('T3: 他タブ非破壊 — 素の .settings-tab.is-active は display:block のまま', () => {
  const block = STYLE.match(/\.settings-tab\.is-active\s*\{[^}]*\}/);
  assert.ok(block, '.settings-tab.is-active ブロックがない');
  assert.match(block[0], /display:\s*block/, '素の is-active が block でない（全タブ flex 化の恐れ）');
});

test('T4: 素の .settings-tab に max-height を持ち込んでいない（C.1.6 一元スクロール維持）', () => {
  const block = STYLE.match(/^\.settings-tab\s*\{[\s\S]*?\}/m);
  assert.ok(block, '.settings-tab ブロックがない');
  assert.doesNotMatch(block[0], /max-height:/, '.settings-tab に max-height が混入');
});

// ============================================================
// footer / add-row 常時可視
// ============================================================
test('T5: footer / add-row が flex-shrink:0（常時可視）', () => {
  const footer = cssBlock('\\.blinds-editor__footer');
  assert.ok(footer, '.blinds-editor__footer ブロックがない');
  assert.match(footer[0], /flex-shrink:\s*0/, 'footer に flex-shrink:0 がない');
  const addRow = cssBlock('\\.blinds-editor__add-row');
  assert.ok(addRow, '.blinds-editor__add-row ブロックがない');
  assert.match(addRow[0], /flex-shrink:\s*0/, 'add-row に flex-shrink:0 がない');
});

// ============================================================
// sticky thead 維持
// ============================================================
test('T6: sticky thead 維持（position:sticky; top:0）', () => {
  const block = cssBlock('\\.blinds-table thead');
  assert.ok(block, '.blinds-table thead ブロックがない');
  assert.match(block[0], /position:\s*sticky/, 'sticky thead が壊れた');
  assert.match(block[0], /top:\s*0/, 'thead の top:0 がない');
});

// ============================================================
// 既定ダイアログ高の引き上げ
// ============================================================
test('T7: .form-dialog--tabs の既定高が引き上げ済（min(700px ではない）+ resize 維持', () => {
  const block = cssBlock('\\.form-dialog\\.form-dialog--tabs');
  assert.ok(block, '.form-dialog.form-dialog--tabs ブロックがない');
  assert.doesNotMatch(block[0], /height:\s*min\(700px/, '既定高が 700px のまま（段数が増えない）');
  assert.match(block[0], /height:\s*min\(\d+px,\s*92vh\)/, '既定高が min(NNNpx, 92vh) 形式でない');
  assert.match(block[0], /resize:\s*both/, 'resize:both が消えた（縦リサイズ追従が壊れる）');
});

// ============================================================
// 不変条件: <dialog> flex なし / fixed・scale 不使用
// ============================================================
test('T8: .form-dialog.form-dialog--tabs（<dialog>）に display:flex が無い（c16 T31 整合）', () => {
  const block = cssBlock('\\.form-dialog\\.form-dialog--tabs');
  assert.doesNotMatch(block[0], /display:\s*flex/, '<dialog> 自体に display:flex が再発');
});

test('T9: 本 STEP の追加 CSS に position:fixed / transform:scale を持ち込んでいない', () => {
  const targets = [
    '\\.blinds-editor__table-wrap',
    '\\.settings-tab\\[data-tab="blinds"\\]\\.is-active',
    '\\.blinds-editor__footer',
    '\\.blinds-editor__add-row'
  ];
  for (const sel of targets) {
    const block = cssBlock(sel);
    if (!block) continue;
    assert.doesNotMatch(block[0], /position:\s*fixed/, `${sel} に position:fixed が混入`);
    assert.doesNotMatch(block[0], /transform:\s*scale/, `${sel} に transform:scale が混入`);
  }
});

// ============================================================
// version 据え置き
// ============================================================
test('version: package.json は 2.5.1 据え置き（STEP3 で bump しない）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.5.1', `version が ${pkg.version}（STEP3 は 2.5.1 据え置き）`);
});

test('version: scripts.test に v256-blinds-table-height.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v256-blinds-table-height\.test\.js/,
    'package.json scripts.test に v256 が含まれていない');
});

// ============================================================
console.log('');
console.log(`v256-blinds-table-height.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
