/**
 * v2.0.11 静的解析テスト — 自動更新真因 2 件根治
 *   真因 1（ファイル名 404）: artifactName を pokertimerplus-setup-${version}.${ext} に固定
 *   真因 2（署名検証失敗）: publisherName 削除 + verifyUpdateCodeSignature: false 追加
 *
 * 致命バグ保護 5 件 + rc12 / rc18 / rc22 / rc23 + C.1.4-fix1 + v2.0.10 観測機構 すべて完全無傷。
 *
 * 実行: node tests/v211-autoupdater-fix.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const PKG  = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1: build.win.artifactName が pokertimerplus-setup-${version}.${ext} 完全一致
// ============================================================

test('T1: build.win.artifactName が pokertimerplus-setup-${version}.${ext}', () => {
  assert.ok(PKG.build && PKG.build.win, 'package.json build.win セクションがない');
  assert.equal(PKG.build.win.artifactName, 'pokertimerplus-setup-${version}.${ext}',
    `build.win.artifactName が ${PKG.build.win.artifactName}（期待 pokertimerplus-setup-\${version}.\${ext}）`);
});

// ============================================================
// T2: build.win.verifyUpdateCodeSignature が false
// ============================================================

test('T2: build.win.verifyUpdateCodeSignature が false（未署名インストーラ許容）', () => {
  assert.equal(PKG.build.win.verifyUpdateCodeSignature, false,
    `build.win.verifyUpdateCodeSignature が ${PKG.build.win.verifyUpdateCodeSignature}（期待 false）`);
});

// ============================================================
// T3: build.win.publisherName が undefined（完全削除）
// ============================================================

test('T3: build.win.publisherName が存在しない（undefined、未署名のため削除）', () => {
  assert.equal(typeof PKG.build.win.publisherName, 'undefined',
    `build.win.publisherName が ${JSON.stringify(PKG.build.win.publisherName)}（期待 undefined、削除されているはず）`);
});

// ============================================================
// T4: package.json version が 2.0.11
// ============================================================

test('T4: package.json version が 2.0.11', () => {
  assert.equal(PKG.version, '2.0.11',
    `package.json version が ${PKG.version}（期待 2.0.11）`);
});

// ============================================================
// T5: scripts.test に v211-autoupdater-fix.test.js 登録
// ============================================================

test('T5: package.json scripts.test に v211-autoupdater-fix.test.js が含まれる', () => {
  assert.match(PKG.scripts.test, /v211-autoupdater-fix\.test\.js/,
    'package.json scripts.test に v211-autoupdater-fix.test.js が含まれていない');
});

// ============================================================
// T6: build.win.icon は維持（必須項目、削除しないこと）
// ============================================================

test('T6: build.win.icon が維持（build/icon.png）', () => {
  assert.equal(PKG.build.win.icon, 'build/icon.png',
    `build.win.icon が ${PKG.build.win.icon}（期待 build/icon.png）`);
});

// ============================================================
// T7: build.win.target が nsis 維持
// ============================================================

test('T7: build.win.target が nsis 維持', () => {
  assert.equal(PKG.build.win.target, 'nsis',
    `build.win.target が ${PKG.build.win.target}（期待 nsis）`);
});

// ============================================================
// T8: build.publish が github provider 維持（必須、app-update.yml 生成のため）
// ============================================================

test('T8: build.publish が github provider 維持（app-update.yml 生成必須）', () => {
  assert.ok(PKG.build.publish, 'build.publish セクションが削除された（app-update.yml 生成不能）');
  assert.equal(PKG.build.publish.provider, 'github', `provider が ${PKG.build.publish.provider}（期待 github）`);
  assert.equal(PKG.build.publish.owner, 'maetomo08020802-eng', 'owner が変更された');
  assert.equal(PKG.build.publish.repo, 'PokerTimerPLUS', 'repo が変更された');
});

// ============================================================
// 致命バグ保護: v2.0.10 で追加した electron-log 依存維持
// ============================================================

test('保護: dependencies.electron-log（v2.0.10 観測機構）が維持', () => {
  assert.ok(PKG.dependencies && PKG.dependencies['electron-log'],
    'electron-log が dependencies から削除された（v2.0.10 観測機構破壊）');
  assert.match(PKG.dependencies['electron-log'], /^\^5\./,
    `electron-log バージョンが ${PKG.dependencies['electron-log']}（期待 ^5.x）`);
});

test('保護: dependencies.electron-updater が維持', () => {
  assert.ok(PKG.dependencies && PKG.dependencies['electron-updater'],
    'electron-updater が dependencies から削除された');
});

// ============================================================
// 致命バグ保護: appId / productName / nsis 設定維持（既存ユーザーデータ保持のため）
// ============================================================

test('保護: appId / productName / nsis.deleteAppDataOnUninstall 維持（既存データ保持）', () => {
  assert.equal(PKG.build.appId, 'com.shitamachi.pokertimerplus',
    'appId が変更された（既存ユーザーデータが orphan 化する）');
  assert.equal(PKG.build.productName, 'PokerTimerPLUS+',
    'productName が変更された');
  assert.equal(PKG.build.nsis.deleteAppDataOnUninstall, false,
    'nsis.deleteAppDataOnUninstall が変更された（アンインストール時にデータ削除する設定になった）');
});

// ============================================================
console.log('');
console.log(`v211-autoupdater-fix.test.js: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
