/**
 * v2.0.10 静的解析テスト
 *   autoUpdater 経路の観測ログ機構（rollingLog + electron-log）
 *   - autoUpdater.logger に electron-log を attach
 *   - setup-enter / event-name / check-call / catch をすべて rollingLog に記録
 *   - 既存 console.log/warn と autoUpdater イベントハンドラ・ダイアログ文言は完全維持
 *   - 機能変更なし、観測手段の追加のみ
 *
 * 致命バグ保護 5 件 + rc12 / rc18 / rc22 / rc23 + C.1.4-fix1 すべて完全無傷。
 *
 * 実行: node tests/v210-autoupdater-logging.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PKG  = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1: rollingLog('autoUpdater:...') ラベル N 件以上
// ============================================================

test('T1: main.js 内に rollingLog(\'autoUpdater:\' パターンが 8 件以上存在', () => {
  const matches = MAIN.match(/rollingLog\s*\(\s*['"]autoUpdater:/g) || [];
  assert.ok(matches.length >= 8,
    `rollingLog('autoUpdater:...) が ${matches.length} 件（期待 >= 8 件）`);
});

// ============================================================
// T2: autoUpdater.logger = log で electron-log 統合
// ============================================================

test('T2: main.js 内に autoUpdater.logger = log（electron-log 統合）が存在', () => {
  assert.match(MAIN, /autoUpdater\.logger\s*=\s*log/,
    'autoUpdater.logger = log の代入がない（公式推奨パターン未実装）');
  assert.match(MAIN, /log\.transports\.file\.level\s*=\s*['"]info['"]/,
    "log.transports.file.level = 'info' 設定がない");
});

// ============================================================
// T3: require('electron-log') 経路存在
// ============================================================

test('T3: main.js 内に require(\'electron-log\') 経路が存在', () => {
  assert.match(MAIN, /require\s*\(\s*['"]electron-log['"]\s*\)/,
    "require('electron-log') が main.js に存在しない");
});

// ============================================================
// T4: 既存の autoUpdater.on(...) 3 ハンドラが破壊されていない
// ============================================================

test('T4: 既存 autoUpdater.on(error / update-available / update-downloaded) すべて維持', () => {
  assert.match(MAIN, /autoUpdater\.on\s*\(\s*['"]error['"]\s*,/,
    "autoUpdater.on('error', ...) ハンドラが削除された");
  assert.match(MAIN, /autoUpdater\.on\s*\(\s*['"]update-available['"]\s*,/,
    "autoUpdater.on('update-available', ...) ハンドラが削除された");
  assert.match(MAIN, /autoUpdater\.on\s*\(\s*['"]update-downloaded['"]\s*,/,
    "autoUpdater.on('update-downloaded', ...) ハンドラが削除された");
});

// ============================================================
// T5: 既存 console.warn/log の出力は完全維持（後方互換）
// ============================================================

test('T5: 既存 console.warn(\'[auto-updater] error:\') / console.log(\'[auto-updater] update-available:\') 完全維持', () => {
  assert.match(MAIN, /console\.warn\s*\(\s*['"]\[auto-updater\]\s+error:/,
    "console.warn('[auto-updater] error:') 出力が削除された");
  assert.match(MAIN, /console\.log\s*\(\s*['"]\[auto-updater\]\s+update-available:/,
    "console.log('[auto-updater] update-available:') 出力が削除された");
  assert.match(MAIN, /console\.log\s*\(\s*['"]\[auto-updater\]\s+update\s+check\s+skipped:/,
    "console.log('[auto-updater] update check skipped:') 出力が削除された");
  assert.match(MAIN, /console\.log\s*\(\s*['"]\[auto-updater\]\s+setup\s+skipped:/,
    "console.log('[auto-updater] setup skipped:') 出力が削除された");
});

// ============================================================
// T6: 追加 3 イベントハンドラ（checking-for-update / update-not-available / download-progress）
// ============================================================

test('T6: 追加 3 イベントハンドラ（checking-for-update / update-not-available / download-progress）登録', () => {
  assert.match(MAIN, /autoUpdater\.on\s*\(\s*['"]checking-for-update['"]\s*,/,
    "autoUpdater.on('checking-for-update', ...) ハンドラがない");
  assert.match(MAIN, /autoUpdater\.on\s*\(\s*['"]update-not-available['"]\s*,/,
    "autoUpdater.on('update-not-available', ...) ハンドラがない");
  assert.match(MAIN, /autoUpdater\.on\s*\(\s*['"]download-progress['"]\s*,/,
    "autoUpdater.on('download-progress', ...) ハンドラがない");
});

// ============================================================
// T7: ダイアログ文言・quitAndInstall ロジック完全維持（v2.0.8 保護）
// ============================================================

test('T7: ダイアログ title 維持 + v2.1.2 文言更新 + checkForUpdatesAndNotify 維持', () => {
  assert.match(MAIN, /title:\s*['"]更新の準備ができました['"]/,
    'ダイアログ title「更新の準備ができました」が変更された');
  // v2.1.2 方針 Z: 「次回起動時に自動更新」文言 + buttons は OK のみ
  assert.match(MAIN, /buttons:\s*\[\s*['"]OK['"]\s*\]/,
    'v2.1.2 ダイアログ buttons が ["OK"] になっていない');
  // v2.1.2: quitAndInstall は呼ばない（autoInstallOnAppQuit: true で代替）
  assert.match(MAIN, /autoUpdater\.checkForUpdatesAndNotify\s*\(\s*\)\s*\.catch/,
    'autoUpdater.checkForUpdatesAndNotify().catch(...) 呼出が削除された');
});

// ============================================================
// T8: package.json dependencies に electron-log 追加
// ============================================================

test('T8: package.json dependencies に electron-log が追加（^5.x）', () => {
  assert.ok(PKG.dependencies && PKG.dependencies['electron-log'],
    'package.json dependencies に electron-log が追加されていない');
  assert.match(PKG.dependencies['electron-log'], /^\^5\./,
    `electron-log バージョンが ${PKG.dependencies['electron-log']}（期待 ^5.x）`);
});

// ============================================================
// 致命バグ保護 cross-check
// ============================================================

test('保護: rollingLog 関数定義 + Ctrl+Shift+L globalShortcut + display-removed すべて維持', () => {
  assert.match(MAIN, /function\s+rollingLog\s*\(/,
    'rollingLog 関数定義が削除された（rc18 第 1 弾保護違反）');
  assert.match(MAIN, /CommandOrControl\+Shift\+L/,
    'rc22 ⑩-A Ctrl+Shift+L globalShortcut が削除された');
  assert.match(MAIN, /display-removed/,
    'rc23 display-removed ハンドラが削除された');
  assert.match(MAIN, /ipcMain\.handle\s*\(\s*['"]tournaments:setDisplaySettings['"]/,
    'C.2.7-D tournaments:setDisplaySettings ハンドラが削除された');
});

// ============================================================
// version assertion
// ============================================================

test('version: package.json は 2.1.2', () => {
  assert.equal(PKG.version, '2.1.20-rc9',
    `package.json version が ${PKG.version}（期待 2.1.18）`);
});

test('version: scripts.test に v210-autoupdater-logging.test.js が含まれる', () => {
  assert.match(PKG.scripts.test, /v210-autoupdater-logging\.test\.js/,
    'package.json scripts.test に v210-autoupdater-logging.test.js が含まれていない');
});

// ============================================================
console.log('');
console.log(`v210-autoupdater-logging.test.js: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
