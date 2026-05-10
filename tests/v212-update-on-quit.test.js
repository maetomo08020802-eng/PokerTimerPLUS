/**
 * v2.1.2 静的解析テスト — 方針 Z「次回起動時更新」自動更新モデル
 *   Fix 1: autoUpdater.autoInstallOnAppQuit = true
 *   Fix 2: update-downloaded ハンドラのダイアログを OK 1 ボタン化、quitAndInstall 削除
 *
 * 致命バグ保護 5 件への影響: すべて影響なし。
 *   通常終了パス経由のため C.1.8 / rolling log / powerSaveBlocker / beforeunload flush
 *   すべて完走（v2.1.1 の quitAndInstall(true,true) 経由のような短縮タイムアウトが発生しない）。
 *
 * 実行: node tests/v212-update-on-quit.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const PKG      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const MAIN_JS  = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1: autoUpdater.autoInstallOnAppQuit = true
// ============================================================
test('T1 (Fix 1): autoUpdater.autoInstallOnAppQuit = true（方針 Z）', () => {
  assert.ok(/autoUpdater\.autoInstallOnAppQuit\s*=\s*true/.test(MAIN_JS),
    'autoUpdater.autoInstallOnAppQuit = true 設定がない（方針 Z 違反）');
  assert.ok(!/autoUpdater\.autoInstallOnAppQuit\s*=\s*false/.test(MAIN_JS),
    '旧設定 autoUpdater.autoInstallOnAppQuit = false が残存');
});

// ============================================================
// T2: update-downloaded ハンドラ内に quitAndInstall 呼出が存在しない
// ============================================================
test('T2 (Fix 2): update-downloaded ハンドラ内に quitAndInstall 呼出なし', () => {
  const handlerStart = MAIN_JS.indexOf("autoUpdater.on('update-downloaded'");
  assert.ok(handlerStart >= 0, "autoUpdater.on('update-downloaded') ハンドラが見つからない");
  const handlerEnd = MAIN_JS.indexOf("rollingLog('autoUpdater:check-call'", handlerStart);
  const handlerBlock = MAIN_JS.slice(handlerStart, handlerEnd > 0 ? handlerEnd : handlerStart + 1500);
  assert.ok(!/autoUpdater\.quitAndInstall\s*\(/.test(handlerBlock),
    'update-downloaded ハンドラ内に quitAndInstall 呼出が残存（v2.1.2 設計違反）');
});

// ============================================================
// T3: ダイアログ文言が「2 分以上待って再起動」旨（v2.1.5 で v2.1.2 文言から進化）
// ============================================================
test('T3 (Fix 2 / v2.1.5 追従): ダイアログ文言が「2 分以上待って再起動」旨', () => {
  // v2.1.5: 「2分」「閉じて」「再起動」キーワードで検出（旧「次回起動時に自動更新」から進化）
  assert.ok(/2\s*分/.test(MAIN_JS),
    'ダイアログ message に「2分」が含まれていない');
  assert.ok(/閉じて/.test(MAIN_JS),
    'ダイアログ message に「閉じて」が含まれていない');
  assert.ok(/再起動/.test(MAIN_JS),
    'ダイアログ message に「再起動」が含まれていない');
  assert.ok(/title:\s*['"]更新の準備ができました['"]/.test(MAIN_JS),
    'ダイアログ title「更新の準備ができました」維持違反');
});

// ============================================================
// T4: ダイアログ buttons 配列が ["OK"] 1 つ構成
// ============================================================
test('T4 (Fix 2): update-downloaded ダイアログ buttons 配列が ["OK"] 1 つ構成', () => {
  // update-downloaded ハンドラの dialog.showMessageBox を抽出
  const handlerStart = MAIN_JS.indexOf("autoUpdater.on('update-downloaded'");
  assert.ok(handlerStart >= 0, "update-downloaded ハンドラが見つからない");
  const handlerEnd = MAIN_JS.indexOf("rollingLog('autoUpdater:check-call'", handlerStart);
  const handlerBlock = MAIN_JS.slice(handlerStart, handlerEnd > 0 ? handlerEnd : handlerStart + 1500);
  assert.ok(/buttons:\s*\[\s*['"]OK['"]\s*\]/.test(handlerBlock),
    'update-downloaded ハンドラ内の buttons が ["OK"] 1 つになっていない');
  // 旧 buttons 配列が残存しないこと
  assert.ok(!/buttons:\s*\[\s*['"]再起動して更新['"]\s*,\s*['"]後で['"]\s*\]/.test(handlerBlock),
    '旧 buttons ["再起動して更新", "後で"] が update-downloaded ハンドラ内に残存');
});

// ============================================================
// T5: 既存 rollingLog / electron-log 統合 / observability 維持
// ============================================================
test('T5 (保護): rollingLog 観測ログが update-downloaded で維持', () => {
  assert.ok(/rollingLog\(\s*['"]autoUpdater:update-downloaded['"]/.test(MAIN_JS),
    'rollingLog autoUpdater:update-downloaded が消失');
  assert.ok(/rollingLog\(\s*['"]autoUpdater:update-available['"]/.test(MAIN_JS),
    'rollingLog autoUpdater:update-available が消失');
  assert.ok(/autoUpdater\.logger\s*=\s*log/.test(MAIN_JS),
    'electron-log 統合 autoUpdater.logger = log が消失');
});

// ============================================================
// T6: autoUpdater イベントハンドラ 6 件すべて維持（v2.0.10 観測機構）
// ============================================================
test('T6 (保護): autoUpdater イベントハンドラ 6 件すべて維持', () => {
  const required = [
    'error',
    'update-available',
    'update-downloaded',
    'checking-for-update',
    'update-not-available',
    'download-progress'
  ];
  for (const evt of required) {
    const re = new RegExp(`autoUpdater\\.on\\s*\\(\\s*['"]${evt}['"]\\s*,`);
    assert.ok(re.test(MAIN_JS), `autoUpdater.on('${evt}', ...) ハンドラが消失`);
  }
});

// ============================================================
// T7: build.win 設定 + build.nsis.oneClick:false 維持（v2.0.11 根治設定）
// ============================================================
test('T7 (保護): build.win + build.nsis.oneClick:false 完全維持', () => {
  assert.ok(PKG.build && PKG.build.win, 'build.win 設定が消失');
  assert.equal(PKG.build.win.artifactName, 'pokertimerplus-setup-${version}.${ext}',
    'build.win.artifactName が変更されている');
  assert.equal(PKG.build.win.verifyUpdateCodeSignature, false,
    'build.win.verifyUpdateCodeSignature が変更されている');
  assert.equal(PKG.build.win.publisherName, undefined,
    'build.win.publisherName が復活している');
  assert.equal(PKG.build.nsis.oneClick, false,
    'build.nsis.oneClick が true に変わっている（初回手動 DL UX を損なうため禁止）');
});

// ============================================================
// T8: 致命バグ保護 cross-check（v2.0.15 ガード 7 件）
// ============================================================
test('T8 (保護): v2.0.15 _isSwitchingMode ガード 7 件維持', () => {
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
// T9: 致命バグ保護 cross-check（v2.0.14 beforeunload flush）
// ============================================================
test('T9 (保護): v2.0.14 beforeunload flushPendingRuntimePersist 維持', () => {
  const m = RENDERER.match(/window\.addEventListener\('beforeunload'[\s\S]{0,500}?\}\);/);
  assert.ok(m, 'beforeunload リスナが見つからない');
  assert.ok(/flushPendingRuntimePersist\s*\(\s*\)/.test(m[0]),
    'beforeunload リスナ内 flushPendingRuntimePersist() 呼出が消失');
});

// ============================================================
// T10: 致命バグ保護 cross-check（rolling log + Ctrl+Shift+L）
// ============================================================
test('T10 (保護): rollingLog 関数 + Ctrl+Shift+L 救済経路維持', () => {
  assert.ok(/function rollingLog\b/.test(MAIN_JS) || /const rollingLog\b/.test(MAIN_JS),
    'main.js から rollingLog 関数定義が消失');
  assert.ok(/CommandOrControl\+Shift\+L/.test(MAIN_JS),
    'Ctrl+Shift+L globalShortcut 登録が削除されている');
  assert.ok(/_flushRollingLog/.test(MAIN_JS),
    '_flushRollingLog 関数が消失（rolling log 永続化経路）');
});

// ============================================================
// T11: package.json version は 2.1.12
// ============================================================
test('T11: package.json version は 2.1.12', () => {
  assert.equal(PKG.version, '2.1.19',
    `package.json version が ${PKG.version}（期待 2.1.18）`);
});

test('T12: scripts.test に v212-update-on-quit.test.js が登録', () => {
  assert.ok(PKG.scripts && typeof PKG.scripts.test === 'string', 'scripts.test がない');
  assert.ok(PKG.scripts.test.includes('v212-update-on-quit.test.js'),
    'scripts.test に v212-update-on-quit.test.js が登録されていない');
});

// ============================================================
// 結果サマリ
// ============================================================
console.log(`\nv212-update-on-quit.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
