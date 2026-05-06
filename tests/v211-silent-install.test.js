/**
 * v2.1.1 → v2.1.2 静的解析テスト — 自動更新サイレントインストール対応
 *   v2.1.1: autoUpdater.quitAndInstall(true, true) 引数追加
 *   v2.1.2: 方針 Z 採用、autoInstallOnAppQuit: true 化 + ダイアログ簡素化
 *           （quitAndInstall 呼出削除、UX「次回起動時更新」に変更）
 *
 * 致命バグ保護 5 件への影響: すべて影響なし（autoUpdater 経路のみ修正）。
 *
 * 実行: node tests/v211-silent-install.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const PKG  = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1 (v2.1.2 方針 Z): autoUpdater.quitAndInstall は update-downloaded ハンドラ内で呼ばない
// ============================================================
test('T1 (v2.1.2): update-downloaded ハンドラ内に quitAndInstall 呼出なし', () => {
  const handlerStart = MAIN_JS.indexOf("autoUpdater.on('update-downloaded'");
  assert.ok(handlerStart >= 0, "autoUpdater.on('update-downloaded') ハンドラが見つからない");
  const handlerEnd = MAIN_JS.indexOf("rollingLog('autoUpdater:check-call'", handlerStart);
  const handlerBlock = MAIN_JS.slice(handlerStart, handlerEnd > 0 ? handlerEnd : handlerStart + 1500);
  assert.ok(!/autoUpdater\.quitAndInstall\s*\(/.test(handlerBlock),
    'v2.1.2 違反: update-downloaded ハンドラ内に quitAndInstall 呼出が残存（autoInstallOnAppQuit:true で代替されるべき）');
});

// ============================================================
// T2 (v2.1.5): ダイアログ文言が「2 分以上待って再起動」 + buttons は OK のみ
//   v2.1.2 の「次回起動時自動更新」から v2.1.5 で文言改善
// ============================================================
test('T2 (v2.1.5): ダイアログ title 維持 + buttons は OK 1 つ + 「2 分待って再起動」文言', () => {
  assert.ok(/title:\s*['"]更新の準備ができました['"]/.test(MAIN_JS),
    'title: 「更新の準備ができました」 が維持されていない');
  assert.ok(/buttons:\s*\[\s*['"]OK['"]\s*\]/.test(MAIN_JS),
    'v2.1.2 ダイアログ buttons が ["OK"] になっていない');
  // v2.1.5: 「2 分以上待って再起動」文言（旧「次回起動時自動更新」から進化）
  assert.ok(/2\s*分/.test(MAIN_JS),
    'v2.1.5 ダイアログ文言「2 分以上待って再起動」の「2分」が反映されていない');
  assert.ok(/閉じて[^`]*再起動/.test(MAIN_JS),
    'v2.1.5 ダイアログ文言の「閉じて...再起動」が反映されていない');
});

// ============================================================
// T3 (保護): rollingLog 観測ログ + console.log 維持（v2.0.10 機構）
// ============================================================
test('T3 (保護): rollingLog 観測ログ + console.warn / console.log 維持', () => {
  assert.ok(/rollingLog\(\s*['"]autoUpdater:update-downloaded['"]/.test(MAIN_JS),
    'rollingLog autoUpdater:update-downloaded が消失');
  assert.ok(/rollingLog\(\s*['"]autoUpdater:error['"]/.test(MAIN_JS),
    'rollingLog autoUpdater:error が消失');
  assert.ok(/rollingLog\(\s*['"]autoUpdater:update-available['"]/.test(MAIN_JS),
    'rollingLog autoUpdater:update-available が消失');
  assert.ok(/console\.warn\(\s*['"]\[auto-updater\] error:['"]/.test(MAIN_JS),
    'console.warn [auto-updater] error: が消失');
  assert.ok(/console\.log\(\s*['"]\[auto-updater\] update-available:['"]/.test(MAIN_JS),
    'console.log [auto-updater] update-available: が消失');
});

// ============================================================
// T4 (保護): build.win 設定 + build.nsis 設定が破壊されていない（v2.0.11 根治設定）
// ============================================================
test('T4 (保護): build.win 設定 (artifactName / verifyUpdateCodeSignature) 維持', () => {
  assert.ok(PKG.build && PKG.build.win, 'build.win 設定が消失');
  assert.equal(PKG.build.win.artifactName, 'pokertimerplus-setup-${version}.${ext}',
    'build.win.artifactName が変更されている');
  assert.equal(PKG.build.win.verifyUpdateCodeSignature, false,
    'build.win.verifyUpdateCodeSignature が変更されている');
});

test('T4-2 (保護): build.nsis 設定 (oneClick: false) 維持', () => {
  assert.ok(PKG.build.nsis, 'build.nsis 設定が消失');
  assert.equal(PKG.build.nsis.oneClick, false,
    'build.nsis.oneClick が true に変わっている（初回インストール体験を損なうため禁止）');
  assert.equal(PKG.build.nsis.allowToChangeInstallationDirectory, true,
    'build.nsis.allowToChangeInstallationDirectory が変更されている');
  assert.equal(PKG.build.nsis.deleteAppDataOnUninstall, false,
    'build.nsis.deleteAppDataOnUninstall が変更されている（既存データ保持の保護）');
});

// ============================================================
// T5: package.json version が 2.1.5
// ============================================================
test('T5: package.json version が 2.1.5', () => {
  assert.equal(PKG.version, '2.1.5', `version が ${PKG.version}（期待 2.1.5）`);
});

test('T5-2: scripts.test に v211-silent-install.test.js が登録', () => {
  assert.ok(PKG.scripts && typeof PKG.scripts.test === 'string', 'scripts.test がない');
  assert.ok(PKG.scripts.test.includes('v211-silent-install.test.js'),
    'scripts.test に v211-silent-install.test.js が登録されていない');
});

// ============================================================
// 致命バグ保護 cross-check
// ============================================================
test('v2.1.2 保護: autoInstallOnAppQuit: true（次回起動時自動更新）', () => {
  assert.ok(/autoUpdater\.autoInstallOnAppQuit\s*=\s*true/.test(MAIN_JS),
    'autoUpdater.autoInstallOnAppQuit = true が消失（v2.1.2 方針 Z）');
});

test('保護: electron-log 統合（v2.0.10 + v2.0.15 ローテ）維持', () => {
  assert.ok(/autoUpdater\.logger\s*=\s*log/.test(MAIN_JS),
    'autoUpdater.logger = log が消失');
  assert.ok(/log\.transports\.file\.maxSize/.test(MAIN_JS),
    'electron-log の maxSize 設定（v2.0.15）が消失');
});

test('保護: v2.0.15 _isSwitchingMode ガード 7 件維持', () => {
  const requiredChannels = [
    'tournaments:setActive', 'tournaments:setTimerState',
    'tournaments:save', 'tournaments:setRuntime',
    'tournaments:setMarqueeSettings', 'tournaments:setDisplaySettings',
    'tournament:set'
  ];
  for (const ch of requiredChannels) {
    const re = new RegExp(`ipcMain\\.handle\\('${ch}'[\\s\\S]{0,1500}?if\\s*\\(\\s*_isSwitchingMode\\s*\\)\\s*return`);
    assert.ok(re.test(MAIN_JS),
      `${ch} の _isSwitchingMode ガードが破壊されている`);
  }
});

// ============================================================
// 結果サマリ
// ============================================================
console.log(`\n----\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
