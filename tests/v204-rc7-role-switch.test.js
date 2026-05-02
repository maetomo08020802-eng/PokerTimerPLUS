/**
 * v2.0.4-rc7 — 表示踏襲問題解消（renderer 内 role 動的切替）+ Ctrl+E 補完 + H 仕様明確化の静的解析テスト
 *
 * 対象修正:
 *   Fix 1-A: main.js switchOperatorToSolo 末尾で 'dual:role-changed' 'operator-solo' 送信
 *   Fix 1-A: main.js switchSoloToOperator 末尾で 'dual:role-changed' 'operator' 送信
 *   Fix 1-B: preload.js dual.onRoleChanged 公開
 *   Fix 1-C: renderer.js 受信ハンドラで window.appRole + documentElement[data-role] を更新
 *   Fix 2-A: index.html operator-pane に「特別スタック」項目（#op-pane-special-stack）追加
 *   Fix 2-B: renderer.js updateOperatorPane で specialStackEl 更新ロジック追加
 *   Fix 3-A: index.html H 操作一覧の文言を「AC 側のボトムバー切替（ホール側は元から非表示）」に明確化
 *   Fix 3-B: docs/specs.md §7 に H 行追加
 *
 * 致命バグ保護 5 件への影響評価 + operator-solo 互換維持の cross-check も担保。
 *
 * 実行: node tests/v204-rc7-role-switch.test.js
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
// Fix 1-A: main.js switch* 関数末尾で role 変更 IPC 送信
// ============================================================
test('Fix 1-A: switchOperatorToSolo 末尾で dual:role-changed の operator-solo を送信', () => {
  const body = extractFunctionBody(MAIN, /async function switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo が見つからない');
  // mainWindow.webContents.send('dual:role-changed', 'operator-solo')
  assert.match(body, /mainWindow\.webContents\.send\(\s*['"]dual:role-changed['"]\s*,\s*['"]operator-solo['"]\s*\)/,
    'switchOperatorToSolo 末尾で dual:role-changed operator-solo 送信なし');
  // v2.0.4-rc9 Fix 2-A 追従: minimize 廃止、show + focus に変更（前原さん観察「枠だけ残る」を根治）
  assert.match(body, /show\(\)/, 'rc9 show() 動作が消失');
});

test('Fix 1-A: switchSoloToOperator 末尾で dual:role-changed の operator を送信', () => {
  const body = extractFunctionBody(MAIN, /async function switchSoloToOperator\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'switchSoloToOperator が見つからない');
  assert.match(body, /mainWindow\.webContents\.send\(\s*['"]dual:role-changed['"]\s*,\s*['"]operator['"]\s*\)/,
    'switchSoloToOperator 末尾で dual:role-changed operator 送信なし');
});

// ============================================================
// Fix 1-B: preload.js dual.onRoleChanged 公開
// ============================================================
test('Fix 1-B: preload.js dual グループに onRoleChanged が公開される', () => {
  assert.match(PRELOAD, /onRoleChanged\s*:\s*\(\s*callback\s*\)\s*=>/,
    'preload.js dual.onRoleChanged 公開なし');
  // ipcRenderer.on('dual:role-changed', ...) で受信
  assert.match(PRELOAD, /ipcRenderer\.on\(\s*['"]dual:role-changed['"]/,
    'preload.js で dual:role-changed の購読なし');
});

test('Fix 1-B: onRoleChanged は callback 型ガードで安全に登録', () => {
  // typeof callback !== 'function' の早期 return
  const m = PRELOAD.match(/onRoleChanged[\s\S]{0,400}?\}/);
  assert.ok(m, 'onRoleChanged 定義ブロックが抽出できない');
  assert.match(m[0], /typeof\s+callback\s*!==\s*['"]function['"]/,
    'onRoleChanged で callback 型ガードなし');
});

// ============================================================
// Fix 1-C: renderer.js 受信ハンドラ + role 動的切替
// ============================================================
test('Fix 1-C: renderer.js で onRoleChanged ハンドラを登録', () => {
  assert.match(RENDERER, /window\.api\?\.dual\?\.onRoleChanged\?\.\(/,
    'renderer.js で window.api.dual.onRoleChanged 登録なし');
});

test('Fix 1-C: ハンドラ内で window.appRole + documentElement[data-role] を更新', () => {
  // onRoleChanged コールバック内に setAttribute('data-role', newRole) と window.appRole = newRole
  const m = RENDERER.match(/onRoleChanged\?\.\(\s*\(newRole\)\s*=>\s*\{[\s\S]*?\}\s*\)/);
  assert.ok(m, 'onRoleChanged コールバック本体が抽出できない');
  assert.match(m[0], /window\.appRole\s*=\s*newRole/,
    'onRoleChanged で window.appRole = newRole なし');
  assert.match(m[0], /setAttribute\(\s*['"]data-role['"]\s*,\s*newRole\s*\)/,
    'onRoleChanged で documentElement.setAttribute(data-role, newRole) なし');
});

test('Fix 1-C: ハンドラで操作対象 role を operator / operator-solo に限定（hall は無視）', () => {
  const m = RENDERER.match(/onRoleChanged\?\.\(\s*\(newRole\)\s*=>\s*\{[\s\S]*?\}\s*\)/);
  assert.ok(m, 'onRoleChanged コールバック本体が抽出できない');
  // 'operator' / 'operator-solo' のホワイトリスト
  assert.match(m[0], /['"]operator['"]/,
    'onRoleChanged で operator のホワイトリストなし');
  assert.match(m[0], /['"]operator-solo['"]/,
    'onRoleChanged で operator-solo のホワイトリストなし');
});

test('Fix 1-C: ハンドラ登録ブロック自体が hall を除外（hall は purely consumer）', () => {
  // if (typeof window !== 'undefined' && window.appRole !== 'hall') ブロック
  assert.match(RENDERER, /window\.appRole\s*!==\s*['"]hall['"][\s\S]{0,500}?onRoleChanged/,
    'onRoleChanged 登録ブロックで hall 除外ガードなし');
});

test('Fix 1-C: role 切替後に updateMuteIndicator を呼ぶ（即時反映）', () => {
  const m = RENDERER.match(/onRoleChanged\?\.\(\s*\(newRole\)\s*=>\s*\{[\s\S]*?\}\s*\)/);
  assert.ok(m, 'onRoleChanged コールバック本体が抽出できない');
  assert.match(m[0], /updateMuteIndicator/,
    'onRoleChanged で updateMuteIndicator 呼出なし（即時反映欠落）');
});

// ============================================================
// Fix 2-A: index.html operator-pane に「特別スタック」項目追加
// ============================================================
test('Fix 2-A: index.html operator-pane に op-pane-special-stack 要素が存在', () => {
  assert.match(HTML, /<dt>特別スタック<\/dt>\s*<dd id="op-pane-special-stack">/,
    'index.html に <dt>特別スタック</dt><dd id="op-pane-special-stack"> なし');
});

test('Fix 2-A: 特別スタック項目はリエントリー / アドオン直後に配置', () => {
  // 「リエントリー / アドオン」の dd 直後に「特別スタック」が並んでいること
  assert.match(
    HTML,
    /op-pane-reentry-addon[\s\S]{0,80}?<dt>特別スタック<\/dt>\s*<dd id="op-pane-special-stack"/,
    'op-pane-special-stack が op-pane-reentry-addon の直後に配置されていない'
  );
});

// ============================================================
// Fix 2-B: renderer.js updateOperatorPane で specialStackEl 更新
// ============================================================
test('Fix 2-B: updateOperatorPane 内で op-pane-special-stack を取得して更新', () => {
  const body = extractFunctionBody(RENDERER, /function updateOperatorPane\s*\(\s*state\s*\)\s*\{/);
  assert.ok(body, 'updateOperatorPane が見つからない');
  assert.match(body, /getElementById\(\s*['"]op-pane-special-stack['"]\s*\)/,
    'updateOperatorPane で op-pane-special-stack の取得なし');
  // tournamentState.specialStack を参照
  assert.match(body, /specialStack/,
    'updateOperatorPane で specialStack 参照なし');
  // appliedCount を参照
  assert.match(body, /appliedCount/,
    'updateOperatorPane で appliedCount 参照なし');
});

// ============================================================
// Fix 3-A: index.html の H 操作一覧文言
// ============================================================
test('Fix 3-A: index.html の H 行は rc15 で完全削除（H 文言検証は不在確認に統一）', () => {
  // rc7 で明確化 → rc10 で簡略化 → rc15 で完全削除（前原さん要望、機能本体は無変更で維持）。
  // H 行が一切残っていないことを担保。
  assert.doesNotMatch(HTML, /<kbd>H<\/kbd>/,
    'index.html に H 行が残存（rc15 で削除予定）');
});

// ============================================================
// Fix 3-B: docs/specs.md §7 に H 行追加
// ============================================================
test('Fix 3-B: docs/specs.md §7 H 行は rc15 で完全削除', () => {
  // rc15 で H 行は完全削除、specs.md からも消える
  assert.doesNotMatch(SPECS, /\|\s*H\s*\|\s*手元\s*PC/,
    'docs/specs.md に H ショートカット行が残存（rc15 で削除予定）');
});

// ============================================================
// 致命バグ保護 5 件 cross-check（rc7 修正による影響なし確認）
// ============================================================
test('致命バグ保護 C.1.7: ensureAudioReady ラップが KeyM ケース内で維持', () => {
  // dispatchClockShortcut の KeyM ケースで ensureAudioReady().then(...) ラップ
  assert.match(RENDERER, /case\s+['"]KeyM['"][\s\S]*?ensureAudioReady\(\)\.then/,
    'KeyM の ensureAudioReady ラップが消失（C.1.7 違反）');
});

test('致命バグ保護 C.1.7: hall onMuteStateChanged が ensureAudioReady ラップ維持', () => {
  // rc6 で確立した hall ブランチの onMuteStateChanged 内 ensureAudioReady().then(...)
  assert.match(RENDERER, /onMuteStateChanged\?\.\([\s\S]{0,200}?ensureAudioReady\(\)\.then/,
    'hall onMuteStateChanged で ensureAudioReady ラップが消失（C.1.7 違反）');
});

test('致命バグ保護 C.2.7-A: resetBlindProgressOnly が引き続き存在', () => {
  assert.match(RENDERER, /function\s+resetBlindProgressOnly/,
    'resetBlindProgressOnly が消失（C.2.7-A 致命バグ修正の保護違反）');
});

test('致命バグ保護 C.1-A2: ensureEditorEditableState が引き続き存在', () => {
  assert.match(RENDERER, /function\s+ensureEditorEditableState/,
    'ensureEditorEditableState が消失（C.1-A2 致命バグ修正の保護違反）');
});

test('致命バグ保護 C.1.8: schedulePersistRuntime が複数箇所で呼ばれている', () => {
  const matches = RENDERER.match(/schedulePersistRuntime\(\)/g) || [];
  assert.ok(matches.length >= 6,
    `schedulePersistRuntime 呼出が ${matches.length} 件（期待 >= 6、C.1.8 違反疑い）`);
});

// ============================================================
// operator-solo モード（v1.3.0 互換）への影響評価
// ============================================================
test('operator-solo 互換: createOperatorWindow(_, true) 起動経路は不変', () => {
  // 最初から HDMI なし起動の operator-solo 経路は IPC 受信ハンドラと無関係
  assert.match(MAIN, /createOperatorWindow\([^)]*,\s*true\s*\)/,
    'createOperatorWindow(_, true)（operator-solo 起動経路）が消失');
});

test('operator-solo 互換: hall ブランチでは onRoleChanged を登録しない（受信不要）', () => {
  // hall ブランチ内に onRoleChanged 呼出が無いこと
  // hall は別ウィンドウで close されるため role 切替は無関係
  // ハンドラ登録ブロックが appRole !== 'hall' でガードされていることが Fix 1-C 既存テストで担保済
  // ここでは hall 専用 registerDualDiffHandler ブロック内に onRoleChanged が混入していないことを確認
  const hallBranch = RENDERER.match(/__appRole\s*===\s*['"]hall['"][\s\S]*?\}\s*else\s*if\s*\(\s*__appRole\s*===\s*['"]operator['"]/);
  if (hallBranch) {
    assert.doesNotMatch(hallBranch[0], /onRoleChanged\?\.\(/,
      'hall ブランチに onRoleChanged 登録が混入（hall は無関係）');
  }
});

test('operator-solo 互換: 最初から operator-solo 起動時は IPC が来ないため副作用ゼロ', () => {
  // switch* 関数は HDMI 切替時のみ呼ばれる → 最初から HDMI なし起動では発火しない
  // switchOperatorToSolo / switchSoloToOperator が screen.on('display-removed') / display-added からのみ呼ばれることを確認
  assert.match(MAIN, /screen\.on\(\s*['"]display-removed['"][\s\S]*?switchOperatorToSolo/,
    'switchOperatorToSolo が display-removed 経由でない（呼出経路が変わった疑い）');
  assert.match(MAIN, /screen\.on\(\s*['"]display-added['"][\s\S]*?switchSoloToOperator/,
    'switchSoloToOperator が display-added 経由でない（呼出経路が変わった疑い）');
});

// ============================================================
// rc6 動作維持（HDMI 切替の前原さん要望は不変）
// ============================================================
test('rc9 改修: switchOperatorToSolo は show + focus（minimize 撤去、close せず）', () => {
  // v2.0.4-rc9 Fix 2-A: minimize → show + focus（自動前面表示）。close ぬきは rc6 から維持。
  const body = extractFunctionBody(MAIN, /async function switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo が見つからない');
  assert.match(body, /mainWindow\.show\(\)/, 'rc9 show() 動作が消失');
  assert.doesNotMatch(body, /mainWindow\.minimize\(\)/, 'minimize が残存（rc9 で撤去必須）');
  assert.doesNotMatch(body, /mainWindow\.close\(\)/, 'mainWindow.close が混入（close→新生成方式に逆戻り）');
});

test('rc9 改修: _showRestoreNoticeOnce フラグセットが撤去されている', () => {
  // v2.0.4-rc9 Fix 2-C: rc6 で導入した restore 時ポップアップ案内（_showRestoreNoticeOnce）は撤去。
  const body = extractFunctionBody(MAIN, /async function switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo が見つからない');
  assert.doesNotMatch(body, /_showRestoreNoticeOnce\s*=\s*true/,
    '_showRestoreNoticeOnce が残存（rc9 で撤去必須）');
});

// ============================================================
// version 同期確認（rc7）
// ============================================================
test('version: package.json は最新 rc（rc8 以降）に追従', () => {
  // このテストは rc7 で導入された rc 段階追従用。本テスト自体は最新 rc 値に追従更新する。
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.4-rc17',
    `package.json version が ${pkg.version}（期待 2.0.4-rc17）`);
});

test('version: scripts.test に v204-rc7-role-switch.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v204-rc7-role-switch\.test\.js/,
    'package.json scripts.test に v204-rc7-role-switch.test.js なし');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
