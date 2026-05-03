/**
 * v2.0.6 静的解析テスト
 *   STEP 2（修正 d）: スライドショー実行中に切替間隔を変更したら即時反映
 *     - 旧挙動: handleBreakImageIntervalChange は値を保存するだけ → 既存 setInterval が古い間隔のまま継続
 *     - 新挙動: 永続化成功後、active かつ setInterval 動作中なら deactivate→activate で再起動
 *     - 1 枚静止モード（active かつ intervalId === null）は再起動不要（修正 (c) との整合）
 *
 * 致命バグ保護 5 件 + rc12 / rc18 / rc22 / rc23 + C.1.4-fix1 Fix 4 すべて完全無傷。
 *
 * 実行: node tests/v206-slideshow-interval-live-update.test.js
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

const handleIntervalBody = extractFunctionBody(RENDERER, 'handleBreakImageIntervalChange');

// ============================================================
// STEP 2: 切替間隔即時反映
// ============================================================

test('T1: handleBreakImageIntervalChange 内で slideshowState.intervalId 存在チェック + 再起動経路を呼ぶ', () => {
  assert.ok(handleIntervalBody, 'handleBreakImageIntervalChange 関数本体が抽出できない');
  // active かつ intervalId 動作中の判定
  assert.match(handleIntervalBody, /slideshowState\.active/,
    'slideshowState.active のチェックがない');
  assert.match(handleIntervalBody, /slideshowState\.intervalId/,
    'slideshowState.intervalId のチェックがない');
  // 再起動経路: deactivate → activate
  assert.match(handleIntervalBody, /deactivateSlideshow\s*\(\s*\)[\s\S]*?activateSlideshow\s*\(\s*\)/,
    'deactivateSlideshow → activateSlideshow の再起動経路がない');
});

test('T2: 1 枚しかない場合は再起動経路に入っても setInterval が起動しない（修正 (c) との整合）', () => {
  // 修正 (c) の整合性は activateSlideshow 内の 1 枚分岐に依存。
  // ここでは activateSlideshow の 1 枚分岐内で setInterval を呼ばないことを再確認。
  const activateBody = extractFunctionBody(RENDERER, 'activateSlideshow');
  assert.ok(activateBody, 'activateSlideshow 関数本体が抽出できない');
  const m = activateBody.match(/breakImagesState\.images\.length\s*===\s*1[\s\S]*?return\s*;/);
  assert.ok(m, '1 枚分岐ブロックが抽出できない');
  const branchBody = m[0];
  assert.doesNotMatch(branchBody, /setInterval\s*\(/,
    '1 枚分岐内で setInterval が呼ばれている（修正 (d) 再起動時に点滅再発）');
});

test('T3: 永続化が値変更前に完了する順序（await persistBreakImagesField → 再起動）', () => {
  assert.ok(handleIntervalBody, 'handleBreakImageIntervalChange 関数本体が抽出できない');
  // await persistBreakImagesField が再起動より前にあること
  const persistIdx = handleIntervalBody.search(/await\s+persistBreakImagesField/);
  const reactivateIdx = handleIntervalBody.search(/deactivateSlideshow\s*\(\s*\)/);
  assert.ok(persistIdx >= 0, 'await persistBreakImagesField 呼出がない');
  assert.ok(reactivateIdx >= 0, 'deactivateSlideshow 呼出がない');
  assert.ok(persistIdx < reactivateIdx,
    'await persistBreakImagesField が再起動より後にある（新間隔が breakImagesState.intervalSec に反映される前に再起動してしまう）');
});

// ============================================================
// 既存ガード保護: 不正値は早期 return
// ============================================================

test('既存ガード保護: Number.isFinite で不正値を弾く早期 return 維持', () => {
  assert.ok(handleIntervalBody, 'handleBreakImageIntervalChange 関数本体が抽出できない');
  assert.match(handleIntervalBody, /Number\.isFinite\s*\(\s*v\s*\)/,
    'Number.isFinite による不正値チェックが削除された');
  assert.match(handleIntervalBody, /if\s*\(\s*!Number\.isFinite[\s\S]*?return\s*;/,
    '不正値の早期 return がない');
});

// ============================================================
// 既存 change イベント仕様維持
// ============================================================

test('既存仕様保護: el.breakImageInterval の change イベントで handleBreakImageIntervalChange を呼ぶ', () => {
  assert.match(RENDERER,
    /el\.breakImageInterval[\s\S]*?addEventListener\s*\(\s*['"]change['"][\s\S]*?handleBreakImageIntervalChange/,
    'el.breakImageInterval の change イベントハンドラが変更されている（input への変更は仕様変更）');
});

// ============================================================
// activateSlideshow 内で intervalSec を直接読む（再起動時に新値が反映される証明）
// ============================================================

test('再起動時新値反映: activateSlideshow が breakImagesState.intervalSec を毎回読んで intervalMs を計算', () => {
  const activateBody = extractFunctionBody(RENDERER, 'activateSlideshow');
  assert.ok(activateBody, 'activateSlideshow 関数本体が抽出できない');
  // intervalMs = Math.max(3, breakImagesState.intervalSec) * 1000
  assert.match(activateBody,
    /intervalMs\s*=\s*Math\.max\s*\(\s*3\s*,\s*breakImagesState\.intervalSec\s*\)\s*\*\s*1000/,
    'activateSlideshow が breakImagesState.intervalSec を再評価していない（古い値で setInterval が再起動される）');
});

// ============================================================
// version assertion
// ============================================================

test('version: package.json は 2.0.6', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.6',
    `package.json version が ${pkg.version}（期待 2.0.6）`);
});

test('version: scripts.test に v206-slideshow-interval-live-update.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v206-slideshow-interval-live-update\.test\.js/,
    'package.json scripts.test に v206-slideshow-interval-live-update.test.js が含まれていない');
});

// ============================================================
console.log('');
console.log(`v206-slideshow-interval-live-update.test.js: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
