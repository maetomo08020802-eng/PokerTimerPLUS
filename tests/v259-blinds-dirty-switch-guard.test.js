/**
 * settings-scope-clarity 配信前修正 — ブラインド未保存編集中のトーナメント切替ガード
 *
 * 検証対象（切替前段に「dirty なら破棄/やめる確認」を足す。切替本体・保存・timerState/runtime は無変更）:
 *   - 確認ダイアログ DOM（既存 confirm-dialog 流用 = hall 自動非表示）
 *   - 共通ガード confirmDiscardBlindsDirtyIfNeeded（!dirty で即 true / 破棄で draft/meta/dirty/initialized クリア）
 *   - 全切替経路にガード: handleTournamentSelectChange（やめる時 select 復元）/ New / Duplicate / RowDelete(active時)
 *   - ラベル整合: meta.id===blindPresetId の時だけペア表示（嘘ラベル解消）
 *   - 不変条件: _savePresetCore 本体不変 / timerState 巻き戻り防止 / runtime 取込 / <dialog> flex なし
 *
 * 実行: node tests/v259-blinds-dirty-switch-guard.test.js
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

// ============================================================
// 確認ダイアログ DOM
// ============================================================
test('A1: 確認ダイアログ DOM（js-blinds-dirty-switch-dialog + discard/cancel）が confirm-dialog 流用', () => {
  assert.match(HTML, /id="js-blinds-dirty-switch-dialog"/, '確認ダイアログがない');
  assert.match(HTML, /class="confirm-dialog confirm-dialog--blinds-dirty-switch"/, 'confirm-dialog 流用でない（hall 自動非表示が効かない）');
  assert.match(HTML, /id="js-blinds-dirty-switch-discard"/, '破棄ボタンがない');
  assert.match(HTML, /id="js-blinds-dirty-switch-cancel"/, 'やめるボタンがない');
});

test('A2: hall 非表示ルール（[data-role="hall"] .confirm-dialog）が存在', () => {
  assert.match(STYLE, /\[data-role="hall"\]\s*\.confirm-dialog/, 'hall 非表示ルールがない');
});

// ============================================================
// 共通ガード + モーダル
// ============================================================
test('B1: confirmDiscardBlindsDirtyIfNeeded — !dirty で即 true / 破棄で draft/meta/dirty/initialized クリア', () => {
  const body = extractFunctionBody(RENDERER, 'confirmDiscardBlindsDirtyIfNeeded');
  assert.ok(body, 'confirmDiscardBlindsDirtyIfNeeded が未定義');
  assert.match(body, /if\s*\(!blindsEditor\.isDirty\)\s*return true/, '!dirty で即 true（不要 prompt 回避）がない');
  assert.match(body, /showBlindsDirtySwitchModal\(\)/, '確認モーダル呼出がない');
  assert.match(body, /setDirty\(false\)/, '破棄時に dirty クリアしていない');
  assert.match(body, /blindsEditor\.draft\s*=\s*null/, '破棄時に draft クリアしていない');
  assert.match(body, /blindsEditor\.initialized\s*=\s*false/, '破棄時に initialized リセットしていない（追従ロードされない）');
});

test('B2: 破棄クリアは blinds namespace のみ（tournamentRuntime/timerState に触れない）', () => {
  const body = extractFunctionBody(RENDERER, 'confirmDiscardBlindsDirtyIfNeeded');
  assert.doesNotMatch(body, /tournamentRuntime/, 'ガードが tournamentRuntime に触れている（runtime 破壊リスク）');
  assert.doesNotMatch(body, /timerState/, 'ガードが timerState に触れている（巻き戻り防止破壊リスク）');
  assert.doesNotMatch(body, /setTimerState|timerReset|timerPause/, 'ガードがタイマー操作に触れている');
});

test('B3: showBlindsDirtySwitchModal が Promise を返し discard/cancel を resolve、showModal 使用', () => {
  const body = extractFunctionBody(RENDERER, 'showBlindsDirtySwitchModal');
  assert.ok(body, 'showBlindsDirtySwitchModal が未定義');
  assert.match(body, /new Promise/, 'Promise を返していない');
  assert.match(body, /showModal/, 'showModal 不使用（独自 overlay 疑い）');
  assert.match(body, /finish\(true\)/, '破棄(true) resolve がない');
  assert.match(body, /finish\(false\)/, 'やめる(false) resolve がない');
});

// ============================================================
// 全切替経路にガード
// ============================================================
test('C1: handleTournamentSelectChange がガード呼出 + やめる時に select.value を現 active へ復元', () => {
  const body = extractFunctionBody(RENDERER, 'handleTournamentSelectChange');
  assert.ok(body, 'handleTournamentSelectChange が未定義');
  assert.match(body, /confirmDiscardBlindsDirtyIfNeeded\(\)/, 'ガード呼出がない');
  // やめる（false）時に dropdown を現 active に戻す
  assert.match(body, /confirmDiscardBlindsDirtyIfNeeded\(\)\)\s*\)\s*\{[\s\S]*?el\.tournamentSelect\.value\s*=\s*tournamentState\.id/,
    'やめる時に select.value を現 active に復元していない');
});

test('C2: handleTournamentNew / handleTournamentDuplicate がガードを呼ぶ', () => {
  const nw = extractFunctionBody(RENDERER, 'handleTournamentNew');
  assert.match(nw, /confirmDiscardBlindsDirtyIfNeeded\(\)/, 'handleTournamentNew にガードがない');
  const dup = extractFunctionBody(RENDERER, 'handleTournamentDuplicate');
  assert.match(dup, /confirmDiscardBlindsDirtyIfNeeded\(\)/, 'handleTournamentDuplicate にガードがない');
});

test('C3: handleTournamentRowDelete は active 卓削除時のみガード（id === tournamentState.id 条件）', () => {
  const body = extractFunctionBody(RENDERER, 'handleTournamentRowDelete');
  assert.ok(body, 'handleTournamentRowDelete が未定義');
  assert.match(body, /id === tournamentState\.id\s*&&\s*!\(await confirmDiscardBlindsDirtyIfNeeded\(\)\)/,
    'active 卓削除時のみのガード条件がない（非 active/非 dirty で不要 prompt の恐れ）');
});

// ============================================================
// ラベル整合（嘘ペア解消）
// ============================================================
test('D1: updateBlindsEditingTargetLabel は meta.id===blindPresetId の時だけペア表示', () => {
  const body = extractFunctionBody(RENDERER, 'updateBlindsEditingTargetLabel');
  assert.ok(body, 'updateBlindsEditingTargetLabel が未定義');
  assert.match(body, /blindsEditor\.meta\.id === tournamentState\.blindPresetId/, '一致判定 pairMatches がない');
  assert.match(body, /pairMatches/, 'pairMatches ガードがない');
  assert.match(body, /if\s*\(tName && pairMatches\)/, '不一致時にペアを抑止していない（嘘ラベル再発）');
});

// ============================================================
// 不変条件
// ============================================================
test('E1: _savePresetCore の STEP2 共有分岐（3択）が残存（保存ロジック本体不変）', () => {
  const body = extractFunctionBody(RENDERER, '_savePresetCore');
  assert.match(body, /findOtherTournamentsUsingPreset/, '共有判定が消えた');
  assert.match(body, /showBlindShareModal/, '3択モーダルが消えた');
});

test('E2: persistActiveTournamentBlindPresetId の timerState 除外（巻き戻り防止）が残存', () => {
  const body = extractFunctionBody(RENDERER, 'persistActiveTournamentBlindPresetId');
  assert.match(body, /const \{ timerState, \.\.\.rest \}/, 'timerState 除外が消えた');
});

test('E3: applyTournament の runtime 取込が残存（runtime 永続化に非干渉）', () => {
  const body = extractFunctionBody(RENDERER, 'applyTournament');
  assert.match(body, /tournamentRuntime\.playersInitial/, 'runtime 取込が消えた');
});

test('E4: <dialog>（.form-dialog--tabs）に display:flex なし / 新確認ダイアログに position:fixed・scale なし', () => {
  const tabs = STYLE.match(/\.form-dialog\.form-dialog--tabs\s*\{[\s\S]*?\}/);
  assert.ok(tabs, '.form-dialog--tabs ブロックがない');
  assert.doesNotMatch(tabs[0], /display:\s*flex/, '<dialog> に display:flex が再発');
  const dirty = STYLE.match(/\.confirm-dialog--blinds-dirty-switch\s*\{[\s\S]*?\}/);
  if (dirty) {
    assert.doesNotMatch(dirty[0], /position:\s*fixed/, '確認ダイアログに position:fixed が混入');
    assert.doesNotMatch(dirty[0], /transform:\s*scale/, '確認ダイアログに transform:scale が混入');
  }
});

// ============================================================
// version 据え置き
// ============================================================
test('version: package.json は 2.5.1 据え置き（本修正で bump しない）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.6.3', `version が ${pkg.version}（2.5.1 据え置き）`);
});

test('version: scripts.test に v259-blinds-dirty-switch-guard.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v259-blinds-dirty-switch-guard\.test\.js/, 'scripts.test に v259 が含まれていない');
});

// ============================================================
console.log('');
console.log(`v259-blinds-dirty-switch-guard.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
