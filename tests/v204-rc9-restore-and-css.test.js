/**
 * v2.0.4-rc9 — 遅延対策 + minimize 撤去 + 防御保険 CSS + フォーカスバナー + 表記言い換え の静的解析テスト
 *
 * 対象修正:
 *   Fix 1-A: createHallWindow opts に paintWhenInitiallyHidden + show 明示化（focusable:false 副作用緩和）
 *   Fix 1-B: tournaments:setTimerState ハンドラ冒頭に _isSwitchingMode ガード追加
 *   Fix 2-A: switchOperatorToSolo の mainWindow.minimize() → mainWindow.show() + focus() 化
 *   Fix 2-B: style.css に [data-role="operator-solo"] .clock { display: grid !important } 防御保険追加
 *   Fix 2-C: _showRestoreNoticeOnce 関連コード（フラグ + restore リスナー + ポップアップ案内）撤去
 *   Fix 3-A/B/C: 手元 PC のフォーカス可視化バナー DOM + CSS + JS 追加
 *   Fix 4-A/B: ユーザー向け文言「AC」→「手元 PC」、「ホール」→「会場モニター」言い換え
 *
 * 致命バグ保護 5 件への影響評価 + operator-solo 互換維持の cross-check + version 同期確認も担保。
 *
 * 実行: node tests/v204-rc9-restore-and-css.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD  = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const STYLE    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');
const SPECS    = fs.readFileSync(path.join(ROOT, 'docs', 'specs.md'), 'utf8');

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
// Fix 1-A: createHallWindow opts 拡張
// ============================================================
test('Fix 1-A: createHallWindow opts に show: true 明示化', () => {
  const body = extractFunctionBody(MAIN, /function createHallWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createHallWindow が見つからない');
  assert.match(body, /show:\s*true/, 'createHallWindow opts に show: true がない');
});

test('Fix 1-A: createHallWindow webPreferences に paintWhenInitiallyHidden: true', () => {
  const body = extractFunctionBody(MAIN, /function createHallWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createHallWindow が見つからない');
  assert.match(body, /paintWhenInitiallyHidden:\s*true/,
    'createHallWindow に paintWhenInitiallyHidden: true がない');
});

test('Fix 1-A 維持: focusable: false は引き続き設定（rc8 維持）', () => {
  const body = extractFunctionBody(MAIN, /function createHallWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createHallWindow が見つからない');
  assert.match(body, /focusable:\s*false/,
    'createHallWindow から focusable: false が消失（rc8 動作破壊）');
});

test('Fix 1-A 維持: backgroundThrottling: false は buildWebPreferences で設定済', () => {
  // backgroundThrottling は createHallWindow に重複指定不要、buildWebPreferences で集中管理
  assert.match(MAIN, /function buildWebPreferences[\s\S]{0,200}?backgroundThrottling:\s*false/,
    'buildWebPreferences に backgroundThrottling: false がない');
});

// ============================================================
// Fix 1-B: tournaments:setTimerState ハンドラ冒頭に _isSwitchingMode ガード
// ============================================================
test('Fix 1-B: tournaments:setTimerState ハンドラに _isSwitchingMode 早期 return ガード', () => {
  // ハンドラ本体を抽出して、冒頭付近に _isSwitchingMode return があるか
  const m = MAIN.match(/ipcMain\.handle\(\s*['"]tournaments:setTimerState['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, 'tournaments:setTimerState ハンドラが見つからない');
  assert.match(m[0], /if\s*\(\s*_isSwitchingMode\s*\)\s*return/,
    'tournaments:setTimerState ハンドラ冒頭に _isSwitchingMode ガードがない');
});

// ============================================================
// Fix 2-A: switchOperatorToSolo の minimize → show + focus 化
// ============================================================
test('Fix 2-A: switchOperatorToSolo は mainWindow.show() を呼ぶ', () => {
  const body = extractFunctionBody(MAIN, /async function switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo が見つからない');
  assert.match(body, /mainWindow\.show\s*\(\s*\)/,
    'switchOperatorToSolo が mainWindow.show を呼んでいない（rc9 で必須）');
});

test('Fix 2-A: switchOperatorToSolo は mainWindow.focus() を呼ぶ', () => {
  const body = extractFunctionBody(MAIN, /async function switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo が見つからない');
  assert.match(body, /mainWindow\.focus\s*\(\s*\)/,
    'switchOperatorToSolo が mainWindow.focus を呼んでいない（rc9 で必須）');
});

test('Fix 2-A: switchOperatorToSolo に mainWindow.minimize は残っていない', () => {
  const body = extractFunctionBody(MAIN, /async function switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo が見つからない');
  assert.doesNotMatch(body, /mainWindow\.minimize\s*\(\s*\)/,
    'switchOperatorToSolo に mainWindow.minimize 残存（rc9 で撤去必須）');
});

test('Fix 2-A: switchOperatorToSolo は依然として mainWindow.close を呼ばない（race 防止維持）', () => {
  const body = extractFunctionBody(MAIN, /async function switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo が見つからない');
  assert.doesNotMatch(body, /mainWindow\.close\s*\(\s*\)/,
    'switchOperatorToSolo に mainWindow.close 混入（rc6 以降禁止）');
});

test('Fix 2-A 維持: switchOperatorToSolo 末尾の dual:role-changed operator-solo 送信が維持', () => {
  const body = extractFunctionBody(MAIN, /async function switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo が見つからない');
  assert.match(body, /dual:role-changed['"]\s*,\s*['"]operator-solo/,
    'switchOperatorToSolo 末尾の dual:role-changed operator-solo 送信が消失（rc7 動作破壊）');
});

// ============================================================
// Fix 2-B: 防御保険 CSS
// ============================================================
test('Fix 2-B: style.css に [data-role="operator-solo"] .clock { display: grid !important } がある', () => {
  assert.match(STYLE,
    /\[data-role="operator-solo"\]\s*\.clock\s*\{[\s\S]{0,80}?display:\s*grid\s*!important/,
    'style.css に operator-solo .clock の grid 表示保証ルールがない');
});

// ============================================================
// Fix 2-C: _showRestoreNoticeOnce 撤去
// ============================================================
test('Fix 2-C: main.js から _showRestoreNoticeOnce フラグ + restore ポップアップ関連コードが撤去', () => {
  // フラグ自体の代入も登場しないこと
  assert.doesNotMatch(MAIN, /_showRestoreNoticeOnce\s*=\s*true/,
    'main.js に _showRestoreNoticeOnce = true 残存（rc9 で撤去必須）');
  assert.doesNotMatch(MAIN, /_showRestoreNoticeOnce\s*=\s*false/,
    'main.js に _showRestoreNoticeOnce = false 残存（rc9 で撤去必須）');
});

test('Fix 2-C: 旧ポップアップ文言「AC ウィンドウについて」が main.js から撤去', () => {
  assert.doesNotMatch(MAIN, /AC\s*ウィンドウについて/,
    'main.js に旧ポップアップタイトル「AC ウィンドウについて」残存（rc9 で撤去必須）');
});

// ============================================================
// Fix 3: フォーカス可視化バナー
// ============================================================
test('Fix 3-A: index.html に operator-focus-banner 要素が追加', () => {
  assert.match(HTML,
    /<div\s+class="operator-focus-banner[\s\S]{0,80}?id="js-operator-focus-banner"[\s\S]{0,40}?hidden\s*>/,
    'index.html に <div class="operator-focus-banner" ... hidden> がない');
});

test('Fix 3-A: フォーカスバナーに icon と text の子要素がある', () => {
  assert.match(HTML, /id="js-operator-focus-banner-icon"/,
    'フォーカスバナーに id="js-operator-focus-banner-icon" がない');
  assert.match(HTML, /id="js-operator-focus-banner-text"/,
    'フォーカスバナーに id="js-operator-focus-banner-text" がない');
});

test('Fix 3-B: style.css に [data-role="operator"] .operator-focus-banner の表示ルールがある', () => {
  assert.match(STYLE,
    /\[data-role="operator"\]\s*\.operator-focus-banner\s*\{[\s\S]{0,200}?display:\s*flex\s*!important/,
    'style.css に operator role でのフォーカスバナー表示ルールがない');
});

test('Fix 3-B: style.css に operator-solo / hall でのフォーカスバナー非表示ルールがある', () => {
  assert.match(STYLE,
    /\[data-role="operator-solo"\]\s*\.operator-focus-banner[\s\S]{0,80}?\[data-role="hall"\]\s*\.operator-focus-banner\s*\{[\s\S]{0,40}?display:\s*none\s*!important/,
    'style.css に operator-solo / hall のフォーカスバナー非表示ルールがない');
});

test('Fix 3-B: is-focused / is-blurred の状態クラス CSS がある', () => {
  assert.match(STYLE, /\.operator-focus-banner\.is-focused\s*\{/,
    'style.css に .operator-focus-banner.is-focused がない');
  assert.match(STYLE, /\.operator-focus-banner\.is-blurred\s*\{/,
    'style.css に .operator-focus-banner.is-blurred がない');
});

test('Fix 3-C: renderer.js に updateFocusBanner 関数定義がある', () => {
  assert.match(RENDERER, /function\s+updateFocusBanner\s*\(\s*\)\s*\{/,
    'renderer.js に updateFocusBanner 関数定義がない');
});

test('Fix 3-C: updateFocusBanner は document.hasFocus() で状態判定', () => {
  const body = extractFunctionBody(RENDERER, /function\s+updateFocusBanner\s*\(\s*\)\s*\{/);
  assert.ok(body, 'updateFocusBanner 本体が抽出できない');
  assert.match(body, /document\.hasFocus\s*\(\s*\)/,
    'updateFocusBanner で document.hasFocus が使われていない');
});

test('Fix 3-C: window に focus / blur リスナー登録', () => {
  assert.match(RENDERER, /window\.addEventListener\(\s*['"]focus['"]\s*,\s*updateFocusBanner/,
    'window に focus イベントリスナー（updateFocusBanner）が登録されていない');
  assert.match(RENDERER, /window\.addEventListener\(\s*['"]blur['"]\s*,\s*updateFocusBanner/,
    'window に blur イベントリスナー（updateFocusBanner）が登録されていない');
});

// rc21 第 2 弾追従: onRoleChanged ハンドラに計測ラベル（インライン object literal 含む）追加に伴い、
//   非貪欲な `\}\s*\)` 早期マッチ問題を解消するため balanced brace 抽出 (extractFunctionBody) に切替。
test('Fix 3-C: onRoleChanged ハンドラ末尾で updateFocusBanner を呼ぶ', () => {
  const handler = extractFunctionBody(RENDERER, /onRoleChanged\?\.\(\s*\(newRole\)\s*=>\s*\{/);
  assert.ok(handler, 'onRoleChanged ハンドラが見つからない');
  assert.match(handler, /updateFocusBanner\s*\(\s*\)/,
    'onRoleChanged ハンドラ内で updateFocusBanner が呼ばれていない');
});

// ============================================================
// Fix 4: 表記言い換え（v2.0.4-rc10 で括弧書き削除、簡略化された）
// ============================================================
test('Fix 4-A: index.html の H 行は rc15 で完全削除（rc10 簡略化を経て rc15 で行ごと削除）', () => {
  assert.doesNotMatch(HTML, /<kbd>H<\/kbd>/,
    'index.html に H 行が残存（rc15 で削除予定）');
});

test('Fix 4-A: docs/specs.md §7 H 行は rc15 で完全削除', () => {
  assert.doesNotMatch(SPECS, /\|\s*H\s*\|\s*手元\s*PC/,
    'docs/specs.md §7 に H 行が残存（rc15 で削除予定）');
});

// ============================================================
// rc6 動作維持: hall 側だけ close（operator は保持）
// ============================================================
test('rc6 動作維持: switchOperatorToSolo は hallWindow.close を呼ぶ', () => {
  const body = extractFunctionBody(MAIN, /async function switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo が見つからない');
  assert.match(body, /hallWindow\.close/,
    'switchOperatorToSolo で hallWindow.close 呼出なし（hall 側は閉じる必要あり）');
});

test('rc6 動作維持: _isSwitchingMode 再入ガードが switchOperatorToSolo に維持', () => {
  const body = extractFunctionBody(MAIN, /async function switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo が見つからない');
  assert.match(body, /if\s*\(\s*_isSwitchingMode\s*\)\s*return/,
    'switchOperatorToSolo に _isSwitchingMode 再入ガードがない');
  assert.match(body, /_isSwitchingMode\s*=\s*true/,
    'switchOperatorToSolo で _isSwitchingMode = true 設定なし');
});

// ============================================================
// 致命バグ保護 5 件 cross-check（rc9 で影響なしを担保）
// ============================================================
test('致命バグ保護: resetBlindProgressOnly 関数が renderer.js に存在', () => {
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'resetBlindProgressOnly 関数が消失（C.2.7-A 致命バグ保護違反）');
});

test('致命バグ保護: tournaments:setDisplaySettings ハンドラから timerState destructure 除外維持', () => {
  // setDisplaySettings ハンドラ内で timerState を destructure していないことを担保
  const m = MAIN.match(/ipcMain\.handle\(\s*['"]tournaments:setDisplaySettings['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, 'tournaments:setDisplaySettings ハンドラが見つからない');
  assert.doesNotMatch(m[0], /\{\s*[^}]*\btimerState\b[^}]*\}\s*=\s*payload/,
    'tournaments:setDisplaySettings の payload destructure に timerState 残存（C.2.7-D Fix 3 違反）');
});

test('致命バグ保護: ensureEditorEditableState 関数が renderer.js に存在', () => {
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'ensureEditorEditableState 関数が消失（C.1-A2 致命バグ保護違反）');
});

test('致命バグ保護: audio.js _play で AudioContext suspend resume 経路維持', () => {
  // audio.js を直接読むのではなく、関数が suspend resume を含むかをファイル内 grep
  const AUDIO = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');
  assert.match(AUDIO, /audioContext\.state\s*===\s*['"]suspended['"]/,
    'audio.js から AudioContext suspend 検出が消失（C.1.7 致命バグ保護違反）');
  assert.match(AUDIO, /audioContext\.resume\s*\(\s*\)/,
    'audio.js から audioContext.resume 呼出が消失（C.1.7 致命バグ保護違反）');
});

test('致命バグ保護: schedulePersistRuntime 呼出が renderer.js に複数残存（C.1.8）', () => {
  const matches = RENDERER.match(/schedulePersistRuntime\s*\(/g) || [];
  assert.ok(matches.length >= 6,
    `schedulePersistRuntime 呼出回数 ${matches.length}（期待 >= 6、C.1.8 致命バグ保護）`);
});

// ============================================================
// operator-solo 互換維持
// ============================================================
test('operator-solo 互換: createOperatorWindow(_, true) 経路が維持（v1.3.0 単画面起動）', () => {
  assert.match(MAIN, /createOperatorWindow\s*\([^)]*,\s*true\s*\)/,
    'createOperatorWindow(_, true) 経路が消失（v1.3.0 互換破壊）');
});

test('operator-solo 互換: rc8 で追加した [data-role="operator-solo"] 用 hidden ルールが維持', () => {
  assert.match(STYLE,
    /\[data-role="operator-solo"\]\s*\.operator-pane[\s\S]{0,100}?display:\s*none\s*!important/,
    'style.css に operator-solo .operator-pane 非表示ルールが消失');
});

// ============================================================
// version 同期確認（rc9）
// ============================================================
test('version: package.json は 2.0.5', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.5',
    `package.json version が ${pkg.version}（期待 2.0.5）`);
});

test('version: scripts.test に v204-rc9-restore-and-css.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v204-rc9-restore-and-css\.test\.js/,
    'package.json scripts.test に v204-rc9-restore-and-css.test.js がない');
});

// ============================================================
// 集計
// ============================================================
console.log('');
console.log(`Summary: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
