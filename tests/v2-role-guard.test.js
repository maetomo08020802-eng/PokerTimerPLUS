/**
 * v2.0.0 STEP 3 — PC 側 UI 分離（役割ガード方式）静的解析テスト
 *
 * 検証対象:
 *   - style.css に [data-role="hall" / "operator" / "operator-solo"] セレクタが存在し、
 *     hall は操作 UI を hidden、operator は大表示を hidden + ミニ状態バー、operator-solo は無変更
 *   - renderer.js の主要 handler 関数 5 箇所以上の冒頭に window.appRole === 'hall' ガード
 *   - STEP 1 のバッジセレクタ（::before content "🖥 HALL" / "💻 OPERATOR"）が削除されている
 *   - notifyOperatorAction / notifyOperatorActionIfNeeded は v2.0.2 で撤去（dual:operator-action がデッドコード）
 *   - <dialog> 要素自体に display: flex 等が当たっていない（feedback_dialog_no_flex）
 *   - 致命バグ保護関連の関数（resetBlindProgressOnly / ensureEditorEditableState）に
 *     role ガードが**誤って**追加されていない（PC 側で動作必須）
 *
 * 実行: node tests/v2-role-guard.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT     = path.join(__dirname, '..');
const STYLE    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');

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
// T1: style.css に役割別 UI 分離セレクタが存在
// ============================================================
test('T1: style.css に [data-role="hall"] / "operator" / "operator-solo" 系セレクタ', () => {
  // hall は操作 UI を完全 hidden（.bottom-bar / .form-dialog / .confirm-dialog）
  assert.match(STYLE, /\[data-role="hall"\]\s+\.bottom-bar/, '[data-role="hall"] .bottom-bar セレクタなし');
  assert.match(STYLE, /\[data-role="hall"\][^{]*\.form-dialog/, '[data-role="hall"] .form-dialog セレクタなし');
  assert.match(STYLE, /\[data-role="hall"\][^{]*\.confirm-dialog/, '[data-role="hall"] .confirm-dialog セレクタなし');
  // operator は大表示を hidden（.clock）
  assert.match(STYLE, /\[data-role="operator"\]\s+\.clock\s*\{/, '[data-role="operator"] .clock セレクタなし');
  // operator は marquee / slideshow / pip を hidden
  assert.match(STYLE, /\[data-role="operator"\][^{]*\.marquee/, '[data-role="operator"] .marquee セレクタなし');
  // operator のミニ状態バーが display: flex で表示される
  assert.match(STYLE, /\[data-role="operator"\]\s+\.operator-status-bar\s*\{[^}]*display:\s*flex/,
    '[data-role="operator"] .operator-status-bar { display: flex } セレクタなし');
});

// ============================================================
// T2: renderer.js の主要 handler 関数 5 箇所以上に role ガード
// ============================================================
test('T2: 主要 handler 関数 5 箇所以上の冒頭に window.appRole === "hall" ガード', () => {
  const handlers = [
    'handleStartPauseToggle', 'openResetDialog', 'openPreStartDialog', 'openSettingsDialog',
    'handleTournamentNew', 'handleTournamentDuplicate', 'handleTournamentRowDelete',
    'handleTournamentSave', 'handlePresetSave', 'handlePresetApply',
    'handleMarqueeSave', 'handleReset', 'addNewEntry', 'eliminatePlayer'
  ];
  let guardedCount = 0;
  const missing = [];
  for (const h of handlers) {
    const body = extractFunctionBody(RENDERER, h);
    if (!body) continue;
    // 関数本体の最初の 200 文字以内に hall ガードがあること
    const head = body.slice(0, 200);
    if (/window\.appRole\s*===\s*['"]hall['"]/.test(head)) {
      guardedCount++;
    } else {
      missing.push(h);
    }
  }
  assert.ok(guardedCount >= 5,
    `主要 handler の hall ガードは ${guardedCount}/${handlers.length} 件、5 件以上必要。未ガード: ${missing.join(', ')}`);
});

// ============================================================
// T3: STEP 1 のバッジセレクタが削除されている（本番運用での誤表示防止）
// ============================================================
test('T3: STEP 1 バッジ（content "🖥 HALL" / "💻 OPERATOR"）が削除されている', () => {
  // バッジの content 文字列が CSS に残っていないこと
  assert.doesNotMatch(STYLE, /content:\s*["']🖥\s*HALL["']/, 'バッジ "🖥 HALL" がまだ存在する');
  assert.doesNotMatch(STYLE, /content:\s*["']💻\s*OPERATOR["']/, 'バッジ "💻 OPERATOR" がまだ存在する');
  // ::before { content: ... } が hall / operator にバッジとして残っていないこと
  // （他用途で ::before を使う場合があるので、HALL / OPERATOR キーワード検査で代替）
});

// ============================================================
// T4: v2.0.2 cleanup — notifyOperatorActionIfNeeded ヘルパー一式が削除されている
//     （元々 dual:operator-action へ通知する wrapper、main 側ハンドラがデッドコード）
// ============================================================
test('T4: notifyOperatorActionIfNeeded ヘルパーと呼出が削除されている（v2.0.2 cleanup）', () => {
  // 関数定義が消えている
  assert.doesNotMatch(RENDERER, /function\s+notifyOperatorActionIfNeeded\s*\(/,
    'notifyOperatorActionIfNeeded 関数定義が残存（v2.0.2 で撤去予定）');
  // timer:start / timer:pause の呼出が消えている（btnStart / btnPause は handleStartPauseToggle のみで動作）
  assert.doesNotMatch(RENDERER, /notifyOperatorActionIfNeeded\(\s*['"]timer:/,
    'notifyOperatorActionIfNeeded(timer:...) 呼出が残存（v2.0.2 で撤去予定）');
});

// ============================================================
// T5: index.html に operator status bar 要素が追加されている
// ============================================================
test('T5: index.html に .operator-status-bar 要素 + 子 span が追加されている', () => {
  assert.match(HTML, /class="operator-status-bar"/, '.operator-status-bar 要素なし');
  assert.match(HTML, /id="js-operator-status-level"/, 'js-operator-status-level なし');
  assert.match(HTML, /id="js-operator-status-time"/, 'js-operator-status-time なし');
  assert.match(HTML, /id="js-operator-status-state"/, 'js-operator-status-state なし');
});

// ============================================================
// T6: <dialog> 要素自体に display: flex / flex-direction: column が当たっていない
//      （feedback_dialog_no_flex 不変条件、C.1.3-fix1-rollback 教訓）
// ============================================================
test('T6: <dialog> 自体に display: flex 等が当たっていない（form-dialog / confirm-dialog）', () => {
  // [data-role="hall"] のセレクタは display: none を当てるが、それは hidden 化なので OK
  // ただし dialog 自体に display: flex / flex-direction: column を当てている宣言が無いこと
  // .form-dialog または dialog.form-dialog のセレクタ群を抽出してチェック
  // 簡易チェック: "form-dialog" を含むブロック内で display:flex があった場合、
  //   それが [data-role] 経由の hidden 化目的でないこと（display:none ならOK）
  // フェーズC.1.6 の form-dialog__shell wrapper 経由で flex 化しているのが正解パス
  const formDialogShellMatch = STYLE.match(/\.form-dialog__shell\s*\{[^}]*display:\s*flex/);
  assert.ok(formDialogShellMatch, 'form-dialog__shell wrapper の flex 化が見つからない（C.1.6 維持）');
  // dialog 自体（.form-dialog でかつ __shell を含まない宣言）に flex が当たっていないこと
  // strict 検査は複雑なので、過去の rollback 印として「.form-dialog.form-dialog--tabs { display: flex」が無いことを確認
  assert.doesNotMatch(STYLE, /\.form-dialog\.form-dialog--tabs\s*\{[^}]*display:\s*flex/,
    '.form-dialog.form-dialog--tabs { display: flex } が再発（feedback_dialog_no_flex 違反）');
});

// ============================================================
// T7: 致命バグ保護関連の関数に role ガードが誤って追加されていない
//      resetBlindProgressOnly / ensureEditorEditableState は PC 側で動作必須
// ============================================================
test('T7: resetBlindProgressOnly / ensureEditorEditableState に hall ガードが**ない**', () => {
  const reset = extractFunctionBody(RENDERER, 'resetBlindProgressOnly');
  assert.ok(reset, 'resetBlindProgressOnly 関数本体が見つからない');
  assert.doesNotMatch(reset, /window\.appRole\s*===\s*['"]hall['"]/,
    'resetBlindProgressOnly に誤って hall ガードが追加されている（致命バグ保護違反、PC 側で必ず動作する必要）');

  const ensure = extractFunctionBody(RENDERER, 'ensureEditorEditableState');
  if (ensure) {
    assert.doesNotMatch(ensure, /window\.appRole\s*===\s*['"]hall['"]/,
      'ensureEditorEditableState に誤って hall ガードが追加されている（致命バグ保護違反）');
  }
  // handleReset は role ガード OK だが、resetTournamentRuntime / timerReset 自体は無ガード
  const reset2 = extractFunctionBody(RENDERER, 'resetTournamentRuntime');
  if (reset2) {
    assert.doesNotMatch(reset2, /window\.appRole\s*===\s*['"]hall['"]/,
      'resetTournamentRuntime に誤って hall ガードが追加されている');
  }
});

// ============================================================
// T8: operator-solo モードで全 UI が表示される（hidden が当たっていない）
// ============================================================
test('T8: operator-solo モードで .clock / .bottom-bar / .marquee に hidden が当たっていない', () => {
  // [data-role="operator-solo"] のスタイル宣言を抽出
  const soloRules = STYLE.match(/\[data-role="operator-solo"\][^{]*\{[^}]*\}/g) || [];
  // operator-solo に display: none を当てているルールがあれば NG（v1.3.0 完全同等を破壊）
  for (const rule of soloRules) {
    if (/\.clock\s*\{|\.bottom-bar\s*\{|\.marquee\s*\{/.test(rule) && /display:\s*none/.test(rule)) {
      throw new Error(`operator-solo モードで重要要素を hidden 化している: ${rule}`);
    }
  }
  // hall / operator のみが display: none を持つことを確認
  assert.match(STYLE, /\[data-role="hall"\]\s+\.bottom-bar\s*\{[^}]*display:\s*none/,
    'hall モードで .bottom-bar の display:none がない');
  assert.match(STYLE, /\[data-role="operator"\]\s+\.clock\s*\{[^}]*display:\s*none/,
    'operator モードで .clock の display:none がない');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
