/**
 * v2.0.4-rc4 — AC（operator role）ウィンドウ中身刷新の静的解析テスト
 *
 * 対象修正:
 *   - index.html: <section class="operator-pane" id="js-operator-pane" hidden> 追加（フォーカス案内 + 7 項目運用情報 + 操作一覧）
 *   - style.css: [data-role="operator"] でのみ display 有効化（3 重防御 CSS 層）
 *   - style.css: operator role で body 背景画像を打ち消し（写真消去）
 *   - renderer.js: updateOperatorPane(state) が role guard 付きで定義され subscribe で呼ばれる
 *
 * 実行: node tests/v204-rc4-operator-pane.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const STYLE    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');

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
// HTML: operator-pane セクションが存在
// ============================================================
test('HTML-1: <section class="operator-pane" id="js-operator-pane" hidden> が存在', () => {
  assert.match(HTML, /<section[^>]*class="operator-pane"[^>]*id="js-operator-pane"[^>]*hidden/,
    'operator-pane セクションなし、もしくは hidden 属性なし（3 重防御の HTML 層違反）');
});

test('HTML-2: フォーカス案内文言（C-1）が表示されている', () => {
  assert.match(HTML, /このウィンドウをクリックすると、会場モニターを操作できます/,
    'フォーカス案内文言（C-1 採用）なし');
});

test('HTML-3: 運用情報 7 項目の dd 要素が存在', () => {
  for (const id of ['op-pane-event-name', 'op-pane-status', 'op-pane-current-blind',
                    'op-pane-next-blind', 'op-pane-players', 'op-pane-avg-stack',
                    'op-pane-reentry-addon']) {
    assert.match(HTML, new RegExp(`id="${id}"`),
      `運用情報 dd id="${id}" なし（表示項目欠落）`);
  }
});

test('HTML-4: 操作一覧 ul に主要キー（Space / Ctrl+R / Ctrl+E）が含まれる', () => {
  // operator-pane 配下の <ul class="operator-pane__shortcut-list"> ブロック抽出
  const m = HTML.match(/<ul[^>]*operator-pane__shortcut-list[\s\S]*?<\/ul>/);
  assert.ok(m, '操作一覧 ul なし');
  const list = m[0];
  assert.match(list, /<kbd>Space<\/kbd>/, '操作一覧に Space なし');
  assert.match(list, /<kbd>Ctrl<\/kbd>\+<kbd>R<\/kbd>/, '操作一覧に Ctrl+R なし');
  assert.match(list, /<kbd>Ctrl<\/kbd>\+<kbd>E<\/kbd>/, '操作一覧に Ctrl+E なし（rc3 で無反応だったキー）');
  assert.match(list, /<kbd>Ctrl<\/kbd>\+<kbd>T<\/kbd>/, '操作一覧に Ctrl+T なし');
});

// ============================================================
// CSS: 3 重防御の CSS 層 + 写真消去
// ============================================================
test('CSS-1: [data-role="operator"] のみで .operator-pane が display 有効化（3 重防御 CSS 層）', () => {
  // [data-role="operator"] .operator-pane { display: flex !important } に類するルール
  assert.match(STYLE,
    /\[data-role="operator"\]\s+\.operator-pane\s*\{[^}]*display\s*:\s*flex/,
    '[data-role="operator"] .operator-pane に display: flex なし');
});

test('CSS-2: operator-solo / hall には .operator-pane の表示打ち消しがない（hidden 維持）', () => {
  // [data-role="operator-solo"] や [data-role="hall"] で operator-pane を打ち消すルールがあってはならない
  assert.doesNotMatch(STYLE,
    /\[data-role="operator-solo"\]\s+\.operator-pane\s*\{[^}]*display/,
    'operator-solo に .operator-pane 表示ルールが混入（v1.3.0 互換違反）');
  assert.doesNotMatch(STYLE,
    /\[data-role="hall"\]\s+\.operator-pane\s*\{[^}]*display/,
    'hall に .operator-pane 表示ルールが混入');
});

test('CSS-3: operator role で body 背景画像を打ち消すルール（写真消去）', () => {
  assert.match(STYLE,
    /\[data-role="operator"\]\[data-bg="image"\]\s+body\s*\{[^}]*background-image\s*:\s*none/,
    'operator role で body 背景画像を打ち消すルールなし（写真消去違反）');
});

test('CSS-4: 写真消去ルールが operator-solo にマッチしない（attribute selector で operator のみ）', () => {
  // selector が `[data-role="operator"]` であり、`[data-role="operator-solo"]` ではない
  // attribute selector の完全一致仕様により、`[data-role="operator"]` は `operator-solo` にマッチしない
  // この検証は CSS 文字列に operator-solo を対象とした打ち消しが無いことを確認する
  assert.doesNotMatch(STYLE,
    /\[data-role="operator-solo"\]\[data-bg="image"\]\s+body\s*\{[^}]*background-image\s*:\s*none/,
    'operator-solo に背景画像打ち消しが混入（v1.3.0 互換違反）');
});

// ============================================================
// renderer.js: updateOperatorPane 関数 + role guard
// ============================================================
test('JS-1: updateOperatorPane 関数が定義されている', () => {
  assert.match(RENDERER, /function\s+updateOperatorPane\s*\([^)]*\)\s*\{/,
    'updateOperatorPane 関数定義なし');
});

test('JS-2: updateOperatorPane 冒頭に operator role guard（3 重防御の JS 層）', () => {
  const body = extractFunctionBody(RENDERER, /function\s+updateOperatorPane\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'updateOperatorPane 抽出失敗');
  assert.match(body, /window\.appRole\s*!==\s*['"]operator['"]/,
    'updateOperatorPane に window.appRole !== "operator" の早期 return ガードなし（3 重防御の JS 層違反）');
});

test('JS-3: subscribe 末尾で updateOperatorPane(state) が呼ばれる', () => {
  // updateOperatorStatusBar(state) の隣に updateOperatorPane(state) がある
  assert.match(RENDERER,
    /updateOperatorStatusBar\s*\(\s*state\s*\)[\s\S]{0,200}updateOperatorPane\s*\(\s*state\s*\)/,
    'subscribe 末尾で updateOperatorStatusBar の隣に updateOperatorPane(state) 呼出なし');
});

test('JS-4: updateOperatorPane が状態を日本語化マップで表示', () => {
  // _STATUS_JP_MAP / 'idle' → '開始前' / 'running' → '進行中' 等
  assert.match(RENDERER, /idle[\s\S]{0,30}開始前/, "状態 'idle' → '開始前' マッピングなし");
  assert.match(RENDERER, /running[\s\S]{0,30}進行中/, "状態 'running' → '進行中' マッピングなし");
  assert.match(RENDERER, /paused[\s\S]{0,30}一時停止/, "状態 'paused' → '一時停止' マッピングなし");
  assert.match(RENDERER, /break[\s\S]{0,30}ブレイク中/, "状態 'break' → 'ブレイク中' マッピングなし");
});

test('JS-5: updateOperatorPane が tournamentState / tournamentRuntime の値を read のみ（write しない）', () => {
  const body = extractFunctionBody(RENDERER, /function\s+updateOperatorPane\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'updateOperatorPane 抽出失敗');
  // tournamentRuntime.xxx = ... のような代入が無い（C.1.8 致命バグ保護違反防止）
  assert.doesNotMatch(body, /tournamentRuntime\.\w+\s*=[^=]/,
    'updateOperatorPane が tournamentRuntime を変更している（read only 違反 / C.1.8 違反）');
  assert.doesNotMatch(body, /tournamentState\.\w+\s*=[^=]/,
    'updateOperatorPane が tournamentState を変更している（read only 違反）');
});

// ============================================================
// 致命バグ保護 5 件 cross-check
// ============================================================
test('致命バグ保護: 既存 updateOperatorStatusBar が維持されている（rc4 で破壊されていない）', () => {
  assert.match(RENDERER, /function\s+updateOperatorStatusBar\s*\(/,
    'updateOperatorStatusBar 関数が消失');
  // 既存の role guard も維持
  const body = extractFunctionBody(RENDERER, /function\s+updateOperatorStatusBar\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'updateOperatorStatusBar 抽出失敗');
  assert.match(body, /window\.appRole\s*!==\s*['"]operator['"]/,
    'updateOperatorStatusBar の role guard が消失');
});

test('致命バグ保護: dispatchClockShortcut が adjustReentry 等を呼ぶ（C.1.8 不変条件のフック維持）', () => {
  const body = extractFunctionBody(RENDERER, /function\s+dispatchClockShortcut\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'dispatchClockShortcut 抽出失敗');
  for (const fn of ['adjustReentry', 'adjustAddOn', 'addNewEntry', 'eliminatePlayer']) {
    assert.match(body, new RegExp(`${fn}\\s*\\(`),
      `dispatchClockShortcut から ${fn}() 呼出が消失`);
  }
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
