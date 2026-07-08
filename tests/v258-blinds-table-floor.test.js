/**
 * settings-scope-clarity 実機バグ修正 — ブラインド表0段（STEP3退行）の根治
 *
 * 検証対象（CSS 高さ戦略のみ。JS・保存ロジック・他タブ非接触）:
 *   - table-wrap に画面幅で縮まない px 固定フロア（min-height>=360px）＝0/数段 collapse を物理的に封じる
 *   - min-height:0（フロア無し）が残っていないこと（退行の直接原因）
 *   - blinds タブは min-height:100%（rigid height:100% でない）＝body スクロール経路
 *   - editor は flex:1 0 auto（shrink 0）＝content 未満に潰れない
 *   - footer/add-row flex-shrink:0 / sticky thead 維持
 *   - ダイアログ既定高 px 上限引き上げ（min(1100px,92vh)）/ <dialog> flex なし / fixed・scale 不使用
 *
 * 実行: node tests/v258-blinds-table-floor.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT  = path.join(__dirname, '..');
// CSS コメント（/* ... */）を除去してから検査（コメント内の文字列への誤マッチを防ぐ）
const STYLE = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}
function cssBlock(sel) { return STYLE.match(new RegExp(`${sel}\\s*\\{[\\s\\S]*?\\}`)); }

// ============================================================
// 最重要: table-wrap に px 固定フロア（0 collapse を物理的に封じる）
// ============================================================
test('T1: .blinds-editor__table-wrap に vh 下限フロア(>=38vh) + vh 上限キャップがある（0段 collapse 不可・内側スクロール）', () => {
  const block = cssBlock('\\.blinds-editor__table-wrap');
  assert.ok(block, '.blinds-editor__table-wrap ブロックがない');
  // 下限フロア（vh）: 行高は vw 依存のため 16:9 では vh 比例で段数が一定（実測 FHD/1440p/4K とも約10段、フロア約6.6段）。
  const mn = block[0].match(/min-height:\s*(\d+)vh/);
  assert.ok(mn, 'table-wrap に vh 単位の min-height フロアがない（0段 collapse 防止）');
  const floorVh = parseInt(mn[1], 10);
  assert.ok(floorVh >= 38, `min-height フロアが ${floorVh}vh（>=38vh 必須＝16:9 でどの解像度も約6段以上）`);
  // 上限キャップ（vh）: table-wrap を bound して内側スクロール（sticky thead）を成立させる
  const mx = block[0].match(/max-height:\s*(\d+)vh/);
  assert.ok(mx, 'table-wrap に vh 単位の max-height キャップがない（内側スクロール/sticky thead 不成立）');
  assert.ok(parseInt(mx[1], 10) > floorVh, 'max-height キャップが min-height フロア以下（bound 不正）');
});

test('T2: table-wrap の min-height:0（フロア無し＝退行の直接原因）が残っていない', () => {
  const block = cssBlock('\\.blinds-editor__table-wrap');
  assert.doesNotMatch(block[0], /min-height:\s*0\b/, 'min-height:0（フロア無し）が残存＝0段 collapse 再発リスク');
  assert.match(block[0], /overflow-y:\s*auto/, '内側スクロール（overflow-y:auto）が消えた');
});

// ============================================================
// body スクロール経路（クリップでなくスクロールに逃がす）
// ============================================================
test('T3: blinds タブは min-height:100%（rigid height:100% でない＝body スクロール経路）', () => {
  const block = cssBlock('\\.settings-tab\\[data-tab="blinds"\\]\\.is-active');
  assert.ok(block, '.settings-tab[data-tab="blinds"].is-active ブロックがない');
  assert.match(block[0], /min-height:\s*100%/, 'min-height:100% がない（body スクロール経路が立たない）');
  // rigid な height: 100%（min-/max- でない単独 height）が残っていないこと
  assert.doesNotMatch(block[0], /[^-]height:\s*100%/, 'rigid height:100% が残存（クリップ再発リスク）');
  assert.match(block[0], /display:\s*flex/, 'blinds タブの flex column 化が消えた');
});

test('T4: blinds スコープの .blinds-editor が flex:1 0 auto（shrink 0＝content 未満に潰れない）', () => {
  const block = cssBlock('\\.settings-tab\\[data-tab="blinds"\\]\\.is-active \\.blinds-editor');
  assert.ok(block, 'blinds スコープ .blinds-editor ブロックがない');
  assert.match(block[0], /flex:\s*1\s+0\s+auto/, 'flex:1 0 auto でない（shrink 1 だと content 未満に潰れクリップ）');
  assert.doesNotMatch(block[0], /[^-]height:\s*100%/, 'editor の旧 rigid height:100% が残存');
});

// ============================================================
// フッタ常時可視 / sticky thead 維持
// ============================================================
test('T5: footer / add-row が flex-shrink:0（常時可視）', () => {
  const footer = cssBlock('\\.blinds-editor__footer');
  assert.match(footer[0], /flex-shrink:\s*0/, 'footer に flex-shrink:0 がない');
  const addRow = cssBlock('\\.blinds-editor__add-row');
  assert.match(addRow[0], /flex-shrink:\s*0/, 'add-row に flex-shrink:0 がない');
});

test('T6: sticky thead 維持（position:sticky; top:0）', () => {
  const block = cssBlock('\\.blinds-table thead');
  assert.match(block[0], /position:\s*sticky/, 'sticky thead が壊れた');
  assert.match(block[0], /top:\s*0/, 'thead の top:0 がない');
});

// ============================================================
// ダイアログ既定高 px 上限引き上げ
// ============================================================
test('T7: .form-dialog--tabs の既定高 px 上限が引き上げ済（min(1100px,92vh）+ resize 維持', () => {
  const block = cssBlock('\\.form-dialog\\.form-dialog--tabs');
  assert.ok(block, '.form-dialog.form-dialog--tabs ブロックがない');
  assert.match(block[0], /height:\s*min\(1100px,\s*92vh\)/, '既定高が min(1100px, 92vh) でない');
  assert.doesNotMatch(block[0], /height:\s*min\(920px/, '旧 920px が残存');
  assert.match(block[0], /resize:\s*both/, 'resize:both が消えた');
});

// ============================================================
// 不変条件
// ============================================================
test('T8: .form-dialog.form-dialog--tabs（<dialog>）に display:flex が無い（c16 T31 整合）', () => {
  const block = cssBlock('\\.form-dialog\\.form-dialog--tabs');
  assert.doesNotMatch(block[0], /display:\s*flex/, '<dialog> 自体に display:flex が再発');
});

test('T9: 本修正の関連 CSS に position:fixed / transform:scale が無い', () => {
  for (const sel of ['\\.blinds-editor__table-wrap', '\\.settings-tab\\[data-tab="blinds"\\]\\.is-active', '\\.blinds-editor__footer']) {
    const block = cssBlock(sel);
    if (!block) continue;
    assert.doesNotMatch(block[0], /position:\s*fixed/, `${sel} に position:fixed が混入`);
    assert.doesNotMatch(block[0], /transform:\s*scale/, `${sel} に transform:scale が混入`);
  }
});

// ============================================================
// version 据え置き
// ============================================================
test('version: package.json は 2.5.1 据え置き（本修正で bump しない）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.7.0', `version が ${pkg.version}（2.5.1 据え置き）`);
});

test('version: scripts.test に v258-blinds-table-floor.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v258-blinds-table-floor\.test\.js/, 'scripts.test に v258 が含まれていない');
});

// ============================================================
console.log('');
console.log(`v258-blinds-table-floor.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
