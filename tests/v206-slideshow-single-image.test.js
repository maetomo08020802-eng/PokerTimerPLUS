/**
 * v2.0.6 静的解析テスト
 *   STEP 1（修正 c）: スライドショー画像が 1 枚しかない場合は静止表示
 *     - 旧挙動: 1 枚しかなくても setInterval が動作 → 同じ画像が無意味な opacity 切替で点滅
 *     - 新挙動: images.length === 1 のとき setInterval を起動せず、1 枚目を静止表示
 *     - 既存 setInterval が動いていれば停止（2 枚→1 枚減少時の追従）
 *     - 1↔N 切替時は persistBreakImagesField の deactivate→activate で再評価
 *
 * 致命バグ保護 5 件 + rc12 / rc18 / rc22 / rc23 + C.1.4-fix1 Fix 4（PIP ボタン位置）すべて完全無傷。
 *
 * 実行: node tests/v206-slideshow-single-image.test.js
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

// ブレース深度カウントで関数本体を抽出
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

// activateSlideshow 関数本体を取得
const activateBody = extractFunctionBody(RENDERER, 'activateSlideshow');

// ============================================================
// STEP 1: スライド 1 枚静止表示
// ============================================================

test('T1: activateSlideshow 内に images.length === 1 の早期分岐が存在', () => {
  assert.ok(activateBody, 'activateSlideshow 関数本体が抽出できない');
  // 1 枚分岐: breakImagesState.images.length === 1 の判定
  assert.match(activateBody, /breakImagesState\.images\.length\s*===\s*1/,
    'activateSlideshow 内に images.length === 1 の判定がない（修正 (c) 未実装）');
});

test('T2: 1 枚分岐内で setInterval を呼ばない（return より前で setInterval が出てこない）', () => {
  assert.ok(activateBody, 'activateSlideshow 関数本体が抽出できない');
  // images.length === 1 の判定から、最初の return; までの部分を抽出
  const m = activateBody.match(/breakImagesState\.images\.length\s*===\s*1[\s\S]*?return\s*;/);
  assert.ok(m, '1 枚分岐ブロック（length === 1 から return まで）が抽出できない');
  const branchBody = m[0];
  // この分岐内で setInterval を呼んでいないこと
  assert.doesNotMatch(branchBody, /setInterval\s*\(/,
    '1 枚分岐内で setInterval が呼ばれている（点滅症状の根本原因）');
});

test('T3: 1 枚分岐内で既存 setInterval を停止する clearInterval 経路が存在', () => {
  assert.ok(activateBody, 'activateSlideshow 関数本体が抽出できない');
  const m = activateBody.match(/breakImagesState\.images\.length\s*===\s*1[\s\S]*?return\s*;/);
  assert.ok(m, '1 枚分岐ブロックが抽出できない');
  const branchBody = m[0];
  // 既存 setInterval が動いていれば停止（2 枚→1 枚減少時の追従）
  assert.match(branchBody, /clearInterval\s*\(\s*slideshowState\.intervalId\s*\)/,
    '1 枚分岐内に clearInterval(slideshowState.intervalId) がない（2→1 枚減少時に setInterval が残存）');
  assert.match(branchBody, /slideshowState\.intervalId\s*=\s*null/,
    '1 枚分岐内で intervalId を null にリセットしていない');
});

// ============================================================
// 1↔N 切替時の再評価（persistBreakImagesField）
// ============================================================

test('1↔N 再評価: persistBreakImagesField で images 枚数変化時に deactivate→activate 経路が存在', () => {
  const persistBody = extractFunctionBody(RENDERER, 'persistBreakImagesField');
  assert.ok(persistBody, 'persistBreakImagesField 関数本体が抽出できない');
  // 旧枚数を保存
  assert.match(persistBody, /oldImagesLength\s*=\s*breakImagesState\.images\.length/,
    'persistBreakImagesField で oldImagesLength の記録がない');
  // breakImages フィールドかつ active かつ枚数変化したときの再評価
  assert.match(persistBody, /field\s*===\s*['"]breakImages['"]/,
    'breakImages フィールド限定のガードがない');
  assert.match(persistBody, /slideshowState\.active/,
    'slideshowState.active のチェックがない');
  assert.match(persistBody, /oldImagesLength\s*!==\s*breakImagesState\.images\.length/,
    '枚数変化チェックがない');
  // deactivate → activate ペアで再起動
  assert.match(persistBody, /deactivateSlideshow\s*\(\s*\)[\s\S]*?activateSlideshow\s*\(\s*\)/,
    'deactivateSlideshow → activateSlideshow の再起動経路がない');
});

// ============================================================
// 既存 1 枚以下の早期 return（0 枚 → 早期 return）保護
// ============================================================

test('既存ガード保護: images.length === 0 の早期 return 経路は維持', () => {
  assert.ok(activateBody, 'activateSlideshow 関数本体が抽出できない');
  // 0 枚 → 早期 return（修正 (c) 1 枚分岐の前にあるべき）
  assert.match(activateBody, /breakImagesState\.images\.length\s*===\s*0[\s\S]*?return/,
    'images.length === 0 の早期 return 経路が削除された（既存ガード破壊）');
});

// ============================================================
// 致命バグ保護: deactivateSlideshow 関数は不変
// ============================================================

test('保護: deactivateSlideshow は intervalId クリア + active=false を維持', () => {
  const deactivateBody = extractFunctionBody(RENDERER, 'deactivateSlideshow');
  assert.ok(deactivateBody, 'deactivateSlideshow 関数本体が抽出できない');
  assert.match(deactivateBody, /slideshowState\.active\s*=\s*false/,
    'deactivateSlideshow 内の active=false 設定がない');
  assert.match(deactivateBody, /clearInterval\s*\(\s*slideshowState\.intervalId\s*\)/,
    'deactivateSlideshow 内の clearInterval がない');
});

// ============================================================
// version assertion
// ============================================================

test('version: package.json は 2.0.6', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.6',
    `package.json version が ${pkg.version}（期待 2.0.6）`);
});

test('version: scripts.test に v206-slideshow-single-image.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v206-slideshow-single-image\.test\.js/,
    'package.json scripts.test に v206-slideshow-single-image.test.js が含まれていない');
});

// ============================================================
console.log('');
console.log(`v206-slideshow-single-image.test.js: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
