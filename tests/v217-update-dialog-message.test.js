/**
 * v2.1.5 静的解析テスト — 自動更新ダイアログ文言改善（regression 防止）
 *
 *   Fix 1: update-downloaded ハンドラの dialog message 文言を「2 分待ち再起動」案内に変更
 *
 * 背景: v2.1.2 配布運用で「閉じてすぐ再起動」が頻発、NSIS installer 処理（30〜60 秒）完了前に
 *   新プロセスが起動して installer 失敗。明示的に待機時間を案内する文言へ変更。
 *
 * 致命バグ保護 5 件すべて完全無傷（autoUpdater 経路の文言変更のみ）。
 *
 * 実行: node tests/v217-update-dialog-message.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT    = path.join(__dirname, '..');
const PKG     = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// update-downloaded ハンドラの message 部分を抽出するヘルパ
// ============================================================
function extractUpdateDownloadedHandlerBlock() {
  const start = MAIN_JS.indexOf("autoUpdater.on('update-downloaded'");
  if (start < 0) throw new Error("autoUpdater.on('update-downloaded') ハンドラが見つからない");
  const end = MAIN_JS.indexOf("rollingLog('autoUpdater:check-call'", start);
  return MAIN_JS.slice(start, end > 0 ? end : start + 2000);
}

// ============================================================
// T1 (Fix 1): message に「2分」「閉じて」「再起動」が含まれる
// ============================================================
test('T1 (Fix 1): dialog message に「2分」「閉じて」「再起動」が含まれる', () => {
  const block = extractUpdateDownloadedHandlerBlock();
  // message プロパティ部分のみ抽出（template literal 含む）
  const messageMatch = block.match(/message:\s*`[^`]*`/);
  assert.ok(messageMatch, 'update-downloaded ハンドラ内に message プロパティが見つからない');
  const messageStr = messageMatch[0];

  assert.ok(/2\s*分/.test(messageStr),
    `message に「2分」が含まれていない: ${messageStr.slice(0, 200)}`);
  assert.ok(/閉じて/.test(messageStr),
    `message に「閉じて」が含まれていない: ${messageStr.slice(0, 200)}`);
  assert.ok(/再起動/.test(messageStr),
    `message に「再起動」が含まれていない: ${messageStr.slice(0, 200)}`);
});

// ============================================================
// T2 (Fix 1): 旧文言「次回起動時」が message に含まれていない
// ============================================================
test('T2 (Fix 1): 旧文言「次回起動時」が dialog message に含まれていない', () => {
  const block = extractUpdateDownloadedHandlerBlock();
  const messageMatch = block.match(/message:\s*`[^`]*`/);
  assert.ok(messageMatch, 'update-downloaded ハンドラ内に message プロパティが見つからない');
  const messageStr = messageMatch[0];

  // v2.1.2 の旧文言「次回 PokerTimerPLUS+ を起動した時に自動的に更新」が残存していないこと
  assert.ok(!/次回\s*PokerTimerPLUS\+?\s*を起動した時/.test(messageStr),
    `v2.1.2 の旧文言「次回...起動した時」が message に残存: ${messageStr.slice(0, 200)}`);
  assert.ok(!/次回起動時に自動的に更新/.test(messageStr),
    `v2.1.2 の旧文言「次回起動時に自動的に更新」が message に残存: ${messageStr.slice(0, 200)}`);
});

// ============================================================
// T3 (保護): title は「更新の準備ができました」のまま
// ============================================================
test('T3 (保護): dialog title が「更新の準備ができました」維持', () => {
  const block = extractUpdateDownloadedHandlerBlock();
  assert.ok(/title:\s*['"]更新の準備ができました['"]/.test(block),
    'ダイアログ title「更新の準備ができました」が変更されている');
});

// ============================================================
// T4 (保護): buttons は ["OK"] 1 つのまま
// ============================================================
test('T4 (保護): dialog buttons が ["OK"] 1 つのまま', () => {
  const block = extractUpdateDownloadedHandlerBlock();
  assert.ok(/buttons:\s*\[\s*['"]OK['"]\s*\]/.test(block),
    'ダイアログ buttons が ["OK"] でなくなっている');
});

// ============================================================
// T5 (保護): autoInstallOnAppQuit: true 維持（v2.1.2 方針 Z）
// ============================================================
test('T5 (保護): autoInstallOnAppQuit = true 維持（v2.1.2 方針 Z）', () => {
  assert.ok(/autoUpdater\.autoInstallOnAppQuit\s*=\s*true/.test(MAIN_JS),
    'autoInstallOnAppQuit = true が消失（v2.1.2 方針 Z 違反）');
});

// ============================================================
// T6 (保護): update-downloaded ハンドラ内に quitAndInstall 呼出なし
// ============================================================
test('T6 (保護): update-downloaded ハンドラ内に quitAndInstall 呼出なし', () => {
  const block = extractUpdateDownloadedHandlerBlock();
  assert.ok(!/autoUpdater\.quitAndInstall\s*\(/.test(block),
    'update-downloaded ハンドラ内に quitAndInstall 呼出が残存');
});

// ============================================================
// T7 (保護): 補足説明（installer 処理時間の言及）が含まれる
// ============================================================
test('T7 (Fix 1): message に installer 処理時間の補足説明が含まれる', () => {
  const block = extractUpdateDownloadedHandlerBlock();
  const messageMatch = block.match(/message:\s*`[^`]*`/);
  assert.ok(messageMatch, 'message プロパティが見つからない');
  const messageStr = messageMatch[0];

  // 「installer の処理に時間がかかる」または同等の補足説明
  assert.ok(/installer/.test(messageStr) && /時間/.test(messageStr),
    `message に installer 処理時間の補足説明がない: ${messageStr.slice(0, 300)}`);
});

// ============================================================
// T8: package.json version は 2.1.12
// ============================================================
test('T8: package.json version は 2.1.12', () => {
  assert.equal(PKG.version, '2.6.5',
    `package.json version が ${PKG.version}（期待 2.1.18）`);
});

test('T9: scripts.test に v217-update-dialog-message.test.js が登録', () => {
  assert.ok(PKG.scripts && typeof PKG.scripts.test === 'string', 'scripts.test がない');
  assert.ok(PKG.scripts.test.includes('v217-update-dialog-message.test.js'),
    'scripts.test に v217-update-dialog-message.test.js が登録されていない');
});

// ============================================================
// 結果サマリ
// ============================================================
console.log(`\nv217-update-dialog-message.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
