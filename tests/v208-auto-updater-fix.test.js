/**
 * v2.0.8 静的解析テスト
 *   STEP 1: 自動更新機能の真因修正（hasPublishConfig 削除）
 *     - 真因: electron-builder は asar 内 package.json から build フィールドを削除するため、
 *       pkg.build.publish 参照は常に undefined → hasPublishConfig は常に false で
 *       autoUpdater が一度も起動していなかった（v2.0.4〜v2.0.7 全バージョンで自動更新不能）
 *     - 修正: hasPublishConfig 関連コードを完全削除し、起動条件を `app.isPackaged` のみに変更
 *     - autoUpdater イベントハンドラ（error / update-available / update-downloaded）+
 *       checkForUpdatesAndNotify + dialog.showMessageBox + quitAndInstall ロジックは完全維持
 *
 * 致命バグ保護 5 件 + rc12 / rc18 / rc22 / rc23 + C.1.4-fix1 PIP ボタン位置 すべて完全無傷。
 *
 * 実行: node tests/v208-auto-updater-fix.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1: hasPublishConfig 変数定義が完全削除されている
// ============================================================

test('T1: main.js から hasPublishConfig 変数定義が完全削除（grep 0 件）', () => {
  // const hasPublishConfig = ... の定義パターンが存在しないこと
  assert.doesNotMatch(MAIN, /const\s+hasPublishConfig\s*=/,
    'main.js に const hasPublishConfig 変数定義が残存');
  // 念のためリテラル名 hasPublishConfig 自体が main.js に存在しない（コメント含む）
  assert.equal((MAIN.match(/hasPublishConfig/g) || []).length, 0,
    `main.js 全体に hasPublishConfig の出現が ${(MAIN.match(/hasPublishConfig/g) || []).length} 件残存（期待 0 件、コメント含む）`);
});

// ============================================================
// T2: autoUpdater 起動条件が app.isPackaged のみ
// ============================================================

test('T2: autoUpdater 起動条件が `if (!isDev && autoUpdater && app.isPackaged) {` の形に変更', () => {
  assert.match(MAIN, /if\s*\(\s*!isDev\s*&&\s*autoUpdater\s*&&\s*app\.isPackaged\s*\)\s*\{/,
    'autoUpdater 起動条件が `if (!isDev && autoUpdater && app.isPackaged) {` の形になっていない');
});

// ============================================================
// T3: 警告ブロックが削除されている（disabled: build.publish not configured 文字列が残存しない）
// ============================================================

test('T3: 「disabled: build.publish not configured」警告ログが main.js から完全削除', () => {
  assert.doesNotMatch(MAIN, /disabled:\s*build\.publish\s+not\s+configured/,
    'main.js に "disabled: build.publish not configured" 警告ログが残存（else if ブロック未削除）');
  // 「planned for future GitHub release」も完全削除
  assert.doesNotMatch(MAIN, /planned\s+for\s+future\s+GitHub\s+release/,
    'main.js に "planned for future GitHub release" メッセージが残存（else if ブロック未削除）');
});

// ============================================================
// T4: autoUpdater イベントハンドラ 3 件が維持されている
// ============================================================

test('T4: autoUpdater.on(error / update-available / update-downloaded) 3 件すべて維持', () => {
  assert.match(MAIN, /autoUpdater\.on\s*\(\s*['"]error['"]\s*,/,
    "autoUpdater.on('error', ...) ハンドラが削除された");
  assert.match(MAIN, /autoUpdater\.on\s*\(\s*['"]update-available['"]\s*,/,
    "autoUpdater.on('update-available', ...) ハンドラが削除された");
  assert.match(MAIN, /autoUpdater\.on\s*\(\s*['"]update-downloaded['"]\s*,/,
    "autoUpdater.on('update-downloaded', ...) ハンドラが削除された");
  // 設定値も維持
  assert.match(MAIN, /autoUpdater\.autoDownload\s*=\s*true/,
    'autoUpdater.autoDownload = true 設定が削除された');
  assert.match(MAIN, /autoUpdater\.autoInstallOnAppQuit\s*=\s*false/,
    'autoUpdater.autoInstallOnAppQuit = false 設定が削除された');
});

// ============================================================
// T5: autoUpdater.checkForUpdatesAndNotify() 呼出が維持されている
// ============================================================

test('T5: autoUpdater.checkForUpdatesAndNotify() 呼出 + .catch ハンドラ維持', () => {
  assert.match(MAIN, /autoUpdater\.checkForUpdatesAndNotify\s*\(\s*\)\s*\.catch/,
    'autoUpdater.checkForUpdatesAndNotify().catch(...) 呼出が削除された');
});

// ============================================================
// T6: dialog.showMessageBox + quitAndInstall が update-downloaded 内で維持
// ============================================================

test('T6: update-downloaded ハンドラ内に dialog.showMessageBox + quitAndInstall 維持', () => {
  // dialog.showMessageBox が呼ばれている
  assert.match(MAIN, /await\s+dialog\.showMessageBox\s*\(/,
    'await dialog.showMessageBox(...) 呼出が削除された');
  // ダイアログ文言（変更禁止）
  assert.match(MAIN, /title:\s*['"]更新の準備ができました['"]/,
    'ダイアログ title「更新の準備ができました」が変更された（NEXT_CC_PROMPT §1.3 違反）');
  assert.match(MAIN, /buttons:\s*\[\s*['"]再起動して更新['"]\s*,\s*['"]後で['"]\s*\]/,
    'ダイアログ buttons「再起動して更新」「後で」が変更された');
  // quitAndInstall 呼出
  assert.match(MAIN, /autoUpdater\.quitAndInstall\s*\(\s*\)/,
    'autoUpdater.quitAndInstall() 呼出が削除された');
});

// ============================================================
// 致命バグ保護 cross-check（main.js の他経路）
// ============================================================

test('保護: main.js の rolling log / Ctrl+Shift+L / display-removed 経路に影響なし', () => {
  // rc18 ring buffer
  assert.match(MAIN, /_flushRollingLog/,
    'rc18 _flushRollingLog 関数が main.js から消失');
  // rc22 ⑩-A: Ctrl+Shift+L globalShortcut
  assert.match(MAIN, /CommandOrControl\+Shift\+L/,
    'rc22 ⑩-A Ctrl+Shift+L globalShortcut が削除された');
  // rc23 display-removed 無条件 solo 経路
  assert.match(MAIN, /display-removed/,
    'rc23 display-removed ハンドラが削除された');
  // C.2.7-D: tournaments:setDisplaySettings ハンドラ
  assert.match(MAIN, /ipcMain\.handle\s*\(\s*['"]tournaments:setDisplaySettings['"]/,
    'C.2.7-D tournaments:setDisplaySettings ハンドラが削除された');
});

// ============================================================
// version assertion
// ============================================================

test('version: package.json は 2.0.10', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.10',
    `package.json version が ${pkg.version}（期待 2.0.10）`);
});

test('version: scripts.test に v208-auto-updater-fix.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v208-auto-updater-fix\.test\.js/,
    'package.json scripts.test に v208-auto-updater-fix.test.js が含まれていない');
});

// ============================================================
console.log('');
console.log(`v208-auto-updater-fix.test.js: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
