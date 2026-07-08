/**
 * settings-scope-clarity STEP4 — トーナメント選択を折りたたみドロップダウン化
 *
 * 検証対象（一覧の見せ方＝折りたたみ DOM ラッパ + サマリ。行アクション本体・timer・store 非接触）:
 *   - 折りたたみ既定 / 開閉トグル / 開閉状態の毎秒再描画またぎ保持（<ul> 外の安定要素）
 *   - 委譲 install-once 非破壊 / 入力中保護維持 / hidden js-tournament-select 温存
 *   - サマリのライブ badge + 「他に実行中◯件」 / 行アクション本体ロジック不変
 *   - <dialog> flex なし / position:fixed・transform:scale 不使用
 *
 * 実行: node tests/v257-tournament-picker-collapse.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT     = path.join(__dirname, '..');
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
function cssBlock(sel) { return STYLE.match(new RegExp(`${sel}\\s*\\{[\\s\\S]*?\\}`)); }

// ============================================================
// DOM 構造: 折りたたみコンテナ + サマリ/トグル（<ul> 外の安定要素）
// ============================================================
test('A1: picker コンテナ + サマリ/トグル/chevron が存在し、<ul> を内包', () => {
  assert.match(HTML, /id="js-tournament-picker"[^>]*data-expanded="false"/, 'picker コンテナ（data-expanded=false 既定）がない');
  assert.match(HTML, /id="js-tournament-picker-toggle"/, 'トグルボタンがない');
  assert.match(HTML, /aria-controls="js-tournament-list"/, 'トグルの aria-controls がない');
  assert.match(HTML, /id="js-tournament-picker-summary"/, 'サマリ要素がない');
  assert.match(HTML, /id="js-tournament-picker-chevron"/, 'chevron がない');
  // picker 内に <ul id="js-tournament-list"> を内包（id/class 不変）
  assert.match(HTML, /id="js-tournament-picker"[\s\S]*?<ul class="tournament-list" id="js-tournament-list"[\s\S]*?<\/ul>[\s\S]*?<\/div>/,
    '<ul id="js-tournament-list"> が picker 内に温存されていない');
});

test('A2: hidden js-tournament-select が値保持源として温存', () => {
  assert.match(HTML, /<select id="js-tournament-select"[^>]*\shidden/, 'hidden js-tournament-select が消えた');
});

// ============================================================
// 開閉状態: <ul> 外の安定要素 + module 変数 + 冪等再適用（毎秒またぎ保持）
// ============================================================
test('B1: _tournamentListExpanded が既定 false（折りたたみ既定）', () => {
  assert.match(RENDERER, /let\s+_tournamentListExpanded\s*=\s*false/, '_tournamentListExpanded 既定 false がない');
});

test('B2: トグルは install-once（毎秒 listener 再登録なし）', () => {
  assert.match(RENDERER, /let\s+_tournamentPickerToggleInstalled\s*=\s*false/, 'install-once フラグがない');
  const body = extractFunctionBody(RENDERER, 'ensureTournamentPickerToggle');
  assert.ok(body, 'ensureTournamentPickerToggle 未定義');
  assert.match(body, /if\s*\(_tournamentPickerToggleInstalled\)\s*return/, 'install-once ガードがない');
  assert.match(body, /_tournamentListExpanded\s*=\s*!_tournamentListExpanded/, 'トグルで開閉反転していない');
});

test('B3: applyTournamentPickerExpanded が安定要素へ data-expanded を反映（毎秒またぎ保持）', () => {
  const body = extractFunctionBody(RENDERER, 'applyTournamentPickerExpanded');
  assert.ok(body, 'applyTournamentPickerExpanded 未定義');
  assert.match(body, /dataset\.expanded\s*=\s*String\(_tournamentListExpanded\)/, 'data-expanded 反映がない');
  assert.match(body, /aria-expanded/, 'aria-expanded 反映がない');
  assert.match(body, /chevron[\s\S]*▲[\s\S]*▼|▲[\s\S]*▼/, 'chevron 文字差し替えがない');
});

test('B4: renderTournamentList が install-once 呼出 + サマリ更新 + 開閉再適用を末尾で行う', () => {
  const body = extractFunctionBody(RENDERER, 'renderTournamentList');
  assert.ok(body, 'renderTournamentList 未定義');
  assert.match(body, /ensureTournamentPickerToggle\(\)/, 'トグル install-once 呼出がない');
  assert.match(body, /updateTournamentPickerSummary\(/, 'サマリ更新呼出がない');
  assert.match(body, /applyTournamentPickerExpanded\(\)/, '開閉状態の冪等再適用がない（勝手に畳まれる恐れ）');
  // 入力中保護の早期 return は維持
  assert.match(body, /if\s*\(isUserTypingInInput\(\)\)\s*return/, '入力中保護の早期 return が消えた');
  // <ul> は常に再構築（空リスト退行なし）
  assert.match(body, /el\.tournamentList\.appendChild\(fragment\)/, '<ul> への append が消えた（空リスト退行）');
});

test('B5: openSettingsDialog でフレッシュ open 時に折りたたみへリセット', () => {
  const body = extractFunctionBody(RENDERER, 'openSettingsDialog');
  assert.ok(body, 'openSettingsDialog 未定義');
  assert.match(body, /_tournamentListExpanded\s*=\s*false/, 'フレッシュ open 時の折りたたみリセットがない');
});

// ============================================================
// サマリ: ライブ badge + 「他に実行中◯件」
// ============================================================
test('C1: updateTournamentPickerSummary が badge + 名前 + 他に実行中件数を textContent で構築', () => {
  const body = extractFunctionBody(RENDERER, 'updateTournamentPickerSummary');
  assert.ok(body, 'updateTournamentPickerSummary 未定義');
  assert.match(body, /tournament-status-badge/, 'ライブ status badge を出していない');
  assert.match(body, /他に実行中/, '「他に実行中◯件」表示がない');
  assert.match(body, /runningOthers\s*>\s*0/, '他に実行中の件数ガードがない');
});

test('C2: 「他に実行中」件数は renderTournamentList のループで running 集計（選択中以外）', () => {
  const body = extractFunctionBody(RENDERER, 'renderTournamentList');
  assert.match(body, /runningOthers\+\+/, 'running 件数の集計がない');
  assert.match(body, /else if \(ts && ts\.status === 'running'\)/, '選択中以外の running 判定がない');
});

// ============================================================
// 委譲・行アクション本体の非破壊
// ============================================================
test('D1: 委譲 ensureTournamentListDelegation は <ul> への install-once（無変更）', () => {
  const body = extractFunctionBody(RENDERER, 'ensureTournamentListDelegation');
  assert.ok(body, 'ensureTournamentListDelegation 未定義');
  assert.match(body, /if\s*\(_tournamentListDelegationInstalled\)\s*return/, 'install-once ガードが消えた');
  assert.match(body, /el\.tournamentList\.addEventListener\('click'/, '<ul> への委譲が消えた');
});

test('D2: 行アクション本体（toggle/reset）の timerState/rebase ロジックが残存（無変更）', () => {
  const tgl = extractFunctionBody(RENDERER, 'handleTournamentListToggle');
  assert.ok(tgl, 'handleTournamentListToggle 未定義');
  assert.match(tgl, /timerPause\(\)/, 'toggle の timerPause が消えた');
  assert.match(tgl, /setTimerState/, 'toggle の rebase setTimerState が消えた');
  const rst = extractFunctionBody(RENDERER, 'handleTournamentListReset');
  assert.ok(rst, 'handleTournamentListReset 未定義');
  assert.match(rst, /timerReset\(\)/, 'reset の timerReset が消えた');
});

// ============================================================
// CSS: 折りたたみ非表示 / fixed・scale 不使用 / <dialog> flex なし
// ============================================================
test('E1: 折りたたみ時に <ul> 非表示（data-expanded=false）', () => {
  assert.match(STYLE, /\.tournament-picker\[data-expanded="false"\]\s*\.tournament-list\s*\{[^}]*display:\s*none/,
    '折りたたみ時の list 非表示ルールがない');
});

test('E2: 本 STEP 追加 CSS に position:fixed / transform:scale が無い', () => {
  for (const sel of ['\\.tournament-picker', '\\.tournament-picker__summary', '\\.tournament-picker__chevron']) {
    const block = cssBlock(sel);
    if (!block) continue;
    assert.doesNotMatch(block[0], /position:\s*fixed/, `${sel} に position:fixed が混入`);
    assert.doesNotMatch(block[0], /transform:\s*scale/, `${sel} に transform:scale が混入`);
  }
});

test('E3: .form-dialog.form-dialog--tabs（<dialog>）に display:flex が無い（c16 T31 整合）', () => {
  const block = cssBlock('\\.form-dialog\\.form-dialog--tabs');
  assert.ok(block, '.form-dialog.form-dialog--tabs ブロックがない');
  assert.doesNotMatch(block[0], /display:\s*flex/, '<dialog> 自体に display:flex が再発');
});

// ============================================================
// version 据え置き
// ============================================================
test('version: package.json は 2.5.1 据え置き（STEP4 で bump しない）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.8.0', `version が ${pkg.version}（STEP4 は 2.5.1 据え置き）`);
});

test('version: scripts.test に v257-tournament-picker-collapse.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v257-tournament-picker-collapse\.test\.js/,
    'package.json scripts.test に v257 が含まれていない');
});

// ============================================================
console.log('');
console.log(`v257-tournament-picker-collapse.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
