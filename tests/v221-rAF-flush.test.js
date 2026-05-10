/**
 * v2.1.9 静的解析テスト — hall 表示遅延 0.2 秒の根治 + 会場モニターのスライドショー切替ボタン表示根治
 *
 *   Fix 1: src/renderer/dual-sync.js _bufferDiff の flush 予約を
 *          setTimeout(0) → requestAnimationFrame に変更
 *   Fix 2: src/renderer/dual-sync.js beforeunload cleanup を
 *          clearTimeout → cancelAnimationFrame に変更
 *   Fix 3: 既存 v219 テストの追従更新（本テスト範囲外）
 *   Fix 4: src/renderer/style.css の [data-role="hall"] .pip-action-btn
 *          { display: none !important; } ルールを削除
 *
 * 真因（hall 表示遅延）: v2.1.7 で導入した setTimeout(0) は macrotask boundary で
 *                       50〜200ms 遅延が発生し、音と表示のズレを生んでいた。
 *                       requestAnimationFrame に切替えで次フレーム（16〜50ms）同期。
 * 真因（hall ボタン消失）: [data-role="hall"] .pip-action-btn { display: none !important; }
 *                          が hall window で強制非表示にしていた。
 *
 * 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）。
 * v2.1.7 dual-sync buffer の dedup / 上限 / 例外耐性 / 再帰防止は完全維持。
 *
 * 実行: node tests/v221-rAF-flush.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const PKG      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const DUAL_SYNC= fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');
const STYLE_CSS= fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// 関数本体（balanced brace）抽出ヘルパ
function extractFnBody(source, signatureRe) {
  const m = source.match(signatureRe);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(open + 1, i); }
  }
  return null;
}

// ============================================================
// T1 (Fix 1): _bufferDiff 内で requestAnimationFrame が呼ばれている
// ============================================================
test('T1 (Fix 1): _bufferDiff 内で requestAnimationFrame で flush が予約されている', () => {
  const body = extractFnBody(DUAL_SYNC, /function\s+_bufferDiff\s*\([^)]*\)\s*\{/);
  assert.ok(body, '_bufferDiff 関数本体が抽出できない');
  // _flushTimer === null のガード後に requestAnimationFrame で予約
  assert.match(body, /_flushTimer\s*===\s*null[\s\S]*?_flushTimer\s*=\s*requestAnimationFrame\s*\(/,
    '_bufferDiff に "_flushTimer === null チェック後の requestAnimationFrame 予約" がない');
});

// ============================================================
// T2 (Fix 1 regression): _bufferDiff 内で setTimeout が呼ばれていない
// ============================================================
test('T2 (Fix 1 regression): _bufferDiff 内で setTimeout が使われていない', () => {
  const body = extractFnBody(DUAL_SYNC, /function\s+_bufferDiff\s*\([^)]*\)\s*\{/);
  assert.ok(body, '_bufferDiff 関数本体が抽出できない');
  // コメント（//... と /* ... */）を剥がしてからチェック（コメント内の "setTimeout(0)" を誤検知しないため）
  const stripped = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(stripped, /setTimeout\s*\(/,
    '_bufferDiff 内に setTimeout が残っている（v2.1.9 で完全移行済の regression）');
});

// ============================================================
// T3 (Fix 2): beforeunload で cancelAnimationFrame が呼ばれている
// ============================================================
test('T3 (Fix 2): beforeunload listener 内で cancelAnimationFrame が呼ばれる', () => {
  // beforeunload listener body 抽出
  const m = DUAL_SYNC.match(/window\.addEventListener\(\s*['"]beforeunload['"]\s*,\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\{\s*once:\s*true\s*\}\s*\)/);
  assert.ok(m, 'beforeunload listener block が見つからない');
  const body = m[1];
  assert.match(body, /cancelAnimationFrame\s*\(\s*_flushTimer\s*\)/,
    'beforeunload listener 内に cancelAnimationFrame(_flushTimer) がない');
  // regression: clearTimeout が残っていないこと
  assert.doesNotMatch(body, /clearTimeout\s*\(/,
    'beforeunload listener に clearTimeout が残っている（v2.1.9 で完全移行済の regression）');
});

// ============================================================
// T4 (Fix 1 cleanup): rAF callback 内で _flushTimer = null が代入される
// ============================================================
test('T4 (Fix 1 cleanup): rAF callback 内で _flushTimer = null 代入が存在', () => {
  // requestAnimationFrame(() => { ... _flushTimer = null; ... _flushDiffBuffer(); ... }) パターン
  const m = DUAL_SYNC.match(/requestAnimationFrame\s*\(\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\)/);
  assert.ok(m, 'requestAnimationFrame の arrow function callback が見つからない');
  const body = m[1];
  assert.match(body, /_flushTimer\s*=\s*null/,
    'rAF callback 内で _flushTimer = null の代入が見つからない（cleanup 経路維持）');
  assert.match(body, /_flushDiffBuffer\s*\(\s*\)/,
    'rAF callback 内で _flushDiffBuffer() の呼出が見つからない');
});

// ============================================================
// T5 (Fix 4): style.css で [data-role="hall"] .pip-action-btn の display: none ルールが削除されている
// ============================================================
test('T5 (Fix 4): style.css に [data-role="hall"] .pip-action-btn の display: none ルールが存在しない', () => {
  // CSS コメント（/* ... */）を剥がしてからチェック（v2.1.9 削除コメント内の旧ルール文字列を誤検知しないため）
  const stripped = STYLE_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  // hall + pip-action-btn セレクタを持ち display: none を含むルールブロックが**ない**ことを確認
  const re = /\[data-role=["']hall["']\][^{]*\.pip-action-btn[^{]*\{[^}]*display\s*:\s*none[^}]*\}/;
  assert.doesNotMatch(stripped, re,
    '[data-role="hall"] .pip-action-btn { display: none ... } ルールが残っている（緊急差し込み regression）');
});

// ============================================================
// T6 (Fix 4): style.css の [data-role="operator"] セクション内の .pip-action-btn は維持されている
// ============================================================
test('T6 (Fix 4): style.css の [data-role="operator"] セクション内に .pip-action-btn セレクタが維持されている', () => {
  // operator セクション（[data-role="operator"] .marquee, ... .pip-action-btn, ... { display: none !important; }）
  // を持つルールブロックを検索
  const re = /\[data-role=["']operator["']\][^{]*\.pip-action-btn[^{]*\{[^}]*display\s*:\s*none[^}]*\}/;
  assert.match(STYLE_CSS, re,
    '[data-role="operator"] セクションの .pip-action-btn 行が消えている（手元 PC は引き続き非表示維持が期待）');
});

// ============================================================
// T7 (Fix 4 動作保証): クリックハンドラに appRole ガードが存在しない（hall でクリック可能）
// ============================================================
test('T7 (Fix 4 動作保証): handlePipShowTimer / handlePipShowSlideshow に appRole === "hall" ガードがない', () => {
  const showTimerBody = extractFnBody(RENDERER, /function\s+handlePipShowTimer\s*\([^)]*\)\s*\{/);
  assert.ok(showTimerBody, 'handlePipShowTimer 関数本体が抽出できない');
  assert.doesNotMatch(showTimerBody, /window\.appRole\s*===\s*['"]hall['"][\s\S]{0,30}return/,
    'handlePipShowTimer に hall 早期 return ガードが追加されている（hall クリック動作の妨げ）');

  const showSlideshowBody = extractFnBody(RENDERER, /function\s+handlePipShowSlideshow\s*\([^)]*\)\s*\{/);
  assert.ok(showSlideshowBody, 'handlePipShowSlideshow 関数本体が抽出できない');
  assert.doesNotMatch(showSlideshowBody, /window\.appRole\s*===\s*['"]hall['"][\s\S]{0,30}return/,
    'handlePipShowSlideshow に hall 早期 return ガードが追加されている（hall クリック動作の妨げ）');
});

// ============================================================
// T8: package.json version 2.1.12 + scripts.test に v221 登録
// ============================================================
test('T8: package.json version は 2.1.12 + scripts.test に v221 登録', () => {
  assert.equal(PKG.version, '2.1.19',
    `package.json version が ${PKG.version}（期待 2.1.18）`);
  assert.match(PKG.scripts.test, /v221-rAF-flush\.test\.js/,
    'scripts.test に v221-rAF-flush.test.js が登録されていない');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
