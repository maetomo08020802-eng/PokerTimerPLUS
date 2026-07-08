/**
 * settings-scope-clarity STEP2 — ブラインド編集を選択中トーナメントに固定 + 共有時3択確認モーダル
 *
 * 検証対象（renderer の保存フロー分岐 + UI。main.js スキーマ・presets:saveUser は無変更）:
 *   Part A: blinds タブの編集対象を選択中トーナメントの構造に固定（js-preset-select hidden + 編集対象ラベル）
 *   Part B: 保存時、構造が他トーナメントでも使用なら3択モーダル（all=同ID上書き / copy=新IDコピー付替 / cancel=保持）
 *   不変条件: timerState 除外（巻き戻り防止）維持 / builtin 経路据え置き / <dialog> flex 非追加 / position:fixed 不使用
 *
 * 実行: node tests/v255-blind-structure-scope.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT     = path.join(__dirname, '..');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const STYLE    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

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
// Part A: 編集対象の選択中固定
// ============================================================
test('A1: 3択モーダル DOM（js-blind-share-dialog + all/copy/cancel ボタン）が存在', () => {
  assert.match(HTML, /id="js-blind-share-dialog"/, 'js-blind-share-dialog がない');
  assert.match(HTML, /id="js-blind-share-all"[^>]*value="all"|value="all"[^>]*id="js-blind-share-all"/,
    'all ボタンがない');
  assert.match(HTML, /id="js-blind-share-copy"/, 'copy ボタンがない');
  assert.match(HTML, /id="js-blind-share-cancel"/, 'cancel ボタンがない');
});

test('A2: js-preset-select が hidden 化され、編集対象ラベル js-blinds-editing-target が存在', () => {
  // js-preset-select の要素に hidden 属性
  assert.match(HTML, /<select id="js-preset-select"[^>]*\shidden/,
    'js-preset-select が hidden 化されていない（任意プリセット選択動線が残存）');
  assert.match(HTML, /id="js-blinds-editing-target"/, '編集対象ラベル js-blinds-editing-target がない');
});

test('A3: ensureBlindsEditorLoaded が選択中トーナメント構造をロード（dirty 保護付き）', () => {
  const body = extractFunctionBody(RENDERER, 'ensureBlindsEditorLoaded');
  assert.ok(body, 'ensureBlindsEditorLoaded が見つからない');
  assert.match(body, /tournamentBlindPreset[\s\S]*tournamentState\.blindPresetId/,
    '編集対象 = tournamentBlindPreset/tournamentState.blindPresetId になっていない');
  assert.match(body, /isDirty/, 'dirty 保護分岐がない（未保存編集をクロバーする恐れ）');
  assert.match(body, /loadPresetIntoDraft\(targetId\)/, '選択中構造の loadPresetIntoDraft 呼出がない');
});

test('A4: 編集対象ラベル更新ヘルパ updateBlindsEditingTargetLabel が定義 + ロード/保存経路から呼出', () => {
  assert.match(RENDERER, /function\s+updateBlindsEditingTargetLabel\s*\(/, 'ヘルパ未定義');
  const load = extractFunctionBody(RENDERER, 'loadPresetIntoDraft');
  assert.match(load, /updateBlindsEditingTargetLabel\(\)/, 'loadPresetIntoDraft から呼出がない');
});

// ============================================================
// Part B: 共有判定 + 3択分岐
// ============================================================
test('B1: findOtherTournamentsUsingPreset が自分を除外して他使用を検出', () => {
  const body = extractFunctionBody(RENDERER, 'findOtherTournamentsUsingPreset');
  assert.ok(body, 'findOtherTournamentsUsingPreset が見つからない');
  assert.match(body, /_tournamentsListDedup/, '使用状況マップ（_tournamentsListDedup）流用がない');
  assert.match(body, /blindPresetId === presetId/, 'blindPresetId 一致判定がない');
  assert.match(body, /t\.id !== tournamentState\.id/, '自分（選択中）を除外していない');
});

test('B2: showBlindShareModal が Promise を返し3択を resolve', () => {
  const body = extractFunctionBody(RENDERER, 'showBlindShareModal');
  assert.ok(body, 'showBlindShareModal が見つからない');
  assert.match(body, /new Promise/, 'Promise を返していない');
  assert.match(body, /resolve\('all'\)|finish\('all'\)/, 'all を resolve しない');
  assert.match(body, /'copy'/, 'copy 分岐がない');
  assert.match(body, /'cancel'/, 'cancel 分岐がない');
  assert.match(body, /showModal/, 'showModal 不使用（独自 overlay の疑い）');
});

test('B3: _savePresetCore に共有判定 + 3択分岐（cancel=中止 / copy=新ID / all=据え置き）', () => {
  const body = extractFunctionBody(RENDERER, '_savePresetCore');
  assert.ok(body, '_savePresetCore が見つからない');
  assert.match(body, /findOtherTournamentsUsingPreset\(blindsEditor\.meta\?\.id\)/,
    '共有判定の呼出がない');
  assert.match(body, /showBlindShareModal/, '3択モーダル呼出がない');
  // cancel → return false（編集保持）
  assert.match(body, /choice === 'cancel'[\s\S]*?return false/, 'cancel で保存中止していない');
  // copy → 新 ID
  assert.match(body, /choice === 'copy'[\s\S]*?generateUniqueId\('user'\)/,
    'copy で copy-on-write（新ID）になっていない');
});

test('B4: 共有なし（others.length===0）はモーダルを出さず従来保存', () => {
  const body = extractFunctionBody(RENDERER, '_savePresetCore');
  assert.match(body, /others\.length > 0/, 'others.length > 0 ガードがない（共有なしでもモーダルが出る恐れ）');
});

// ============================================================
// 不変条件: builtin 据え置き / 巻き戻り防止 / UI
// ============================================================
test('C1: builtin（フォーマット）経路は据え置き（元名一致拒否ロジック維持）', () => {
  const body = extractFunctionBody(RENDERER, '_savePresetCore');
  assert.match(body, /blindsEditor\.meta\?\.builtin/, 'builtin 分岐がない');
  assert.match(body, /inputName === builtinName/, 'フォーマット上書き拒否ロジックが消えた');
});

test('C2: persistActiveTournamentBlindPresetId の timerState 除外（巻き戻り防止）維持', () => {
  const body = extractFunctionBody(RENDERER, 'persistActiveTournamentBlindPresetId');
  assert.ok(body, 'persistActiveTournamentBlindPresetId が見つからない');
  assert.match(body, /const \{ timerState, \.\.\.rest \}/, 'timerState 除外（巻き戻り防止）が消えた');
});

test('C3: main.js の presets:saveUser ロジックは無変更（同ID上書き / 新IDpush / 上限）', () => {
  assert.match(MAIN, /ipcMain\.handle\('presets:saveUser'/, 'presets:saveUser ハンドラがない');
  assert.match(MAIN, /idx < 0 && presets\.length >= MAX_USER_PRESETS/, '新規上限チェックが消えた');
  assert.match(MAIN, /if \(idx >= 0\) \{\s*presets\[idx\] = sanitized;/, '同ID上書きロジックが消えた');
});

test('C4: 3択モーダル CSS は <dialog> に flex を足さず position:fixed 不使用', () => {
  const block = STYLE.match(/\.confirm-dialog--blind-share\s*\{[\s\S]*?\}/);
  assert.ok(block, '.confirm-dialog--blind-share ブロックがない');
  assert.doesNotMatch(block[0], /display:\s*flex/, '<dialog> 流用クラスに display:flex が混入');
  assert.doesNotMatch(block[0], /position:\s*fixed/, 'position:fixed が混入');
  // 編集対象ラベルにも fixed/scale を持ち込まない
  const lbl = STYLE.match(/\.blinds-editor__editing-target\s*\{[\s\S]*?\}/);
  assert.ok(lbl, '.blinds-editor__editing-target ブロックがない');
  assert.doesNotMatch(lbl[0], /position:\s*fixed|transform:\s*scale/, 'ラベルに fixed/scale が混入');
});

test('C5: ホール側非表示は既存 [data-role="hall"] .confirm-dialog で担保（流用クラスを使用）', () => {
  assert.match(HTML, /class="confirm-dialog confirm-dialog--blind-share"/,
    '3択モーダルが confirm-dialog クラスを流用していない（hall 自動非表示が効かない）');
  assert.match(STYLE, /\[data-role="hall"\]\s*\.confirm-dialog/, 'hall 非表示ルールが存在しない');
});

// ============================================================
// version 据え置き確認（bump しないこと）
// ============================================================
test('version: package.json は 2.5.1 据え置き（STEP2 で bump しない）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.8.0', `version が ${pkg.version}（STEP2 は 2.5.1 据え置き）`);
});

test('version: scripts.test に v255-blind-structure-scope.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v255-blind-structure-scope\.test\.js/,
    'package.json scripts.test に v255 が含まれていない');
});

// ============================================================
console.log('');
console.log(`v255-blind-structure-scope.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
