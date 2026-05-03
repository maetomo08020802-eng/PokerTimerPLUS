/**
 * v2.0.4-rc3 — operator window close 保護 + hall キーフォワードの静的解析テスト
 *
 * 対象修正:
 *   - createOperatorWindow に close ハンドラ追加（dialog.showMessageBoxSync で確認 → app.quit）
 *   - switchOperatorToSolo / switchSoloToOperator / confirmQuit が _suppressCloseConfirm bypass を設定
 *   - createHallWindow に before-input-event ハンドラ追加（操作系キーを mainWindow に sendInputEvent）
 *   - FORWARD_KEYS_FROM_HALL に基本操作キーが含まれ F11 / F12 は除外されている
 *
 * 実行: node tests/v204-window-protection.test.js
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
// B-1: operator window close 保護
// ============================================================
test('B-1: createOperatorWindow に close ハンドラ + showMessageBoxSync 確認ダイアログ', () => {
  const body = extractFunctionBody(MAIN, /function createOperatorWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createOperatorWindow が見つからない');
  // win.on('close', ...) が登録されている
  assert.match(body, /win\.on\(\s*['"]close['"]/,
    "createOperatorWindow に win.on('close', ...) ハンドラなし");
  // dialog.showMessageBoxSync を使った確認ダイアログ
  assert.match(body, /dialog\.showMessageBoxSync/,
    'close ハンドラに dialog.showMessageBoxSync 呼出なし');
  // _suppressCloseConfirm フラグでバイパス可能
  assert.match(body, /_suppressCloseConfirm/,
    'close ハンドラに _suppressCloseConfirm bypass フラグなし');
  // OK 選択時の app.quit
  assert.match(body, /app\.quit\(\s*\)/,
    'close 確認 OK で app.quit を呼ぶ経路がない');
});

test('B-1 cross-check (rc9 追従): switchOperatorToSolo は close せず show（rc9 改修、_suppressCloseConfirm 不要）', () => {
  // v2.0.4-rc9 Fix 2-A: switchOperatorToSolo は minimize → show + focus に変更（IPC 遅延起因の表示消失を根治）。
  //   _suppressCloseConfirm bypass は引き続き不要（hall 側のみ close、operator は close しない）。
  const body = extractFunctionBody(MAIN, /async function switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo が見つからない');
  // show + focus していることを確認（rc9）
  assert.match(body, /mainWindow\.show\s*\(\s*\)/,
    'switchOperatorToSolo が mainWindow.show を呼ばない（rc9 で show 化必須）');
  // minimize は撤去済
  assert.doesNotMatch(body, /mainWindow\.minimize\s*\(\s*\)/,
    'switchOperatorToSolo に mainWindow.minimize 残存（rc9 で撤去必須）');
  // mainWindow.close は呼ばない（race 防止、rc6 から維持）
  assert.doesNotMatch(body, /mainWindow\.close\s*\(\s*\)/,
    'switchOperatorToSolo が mainWindow.close を呼んでいる（rc6 以降禁止）');
});

test('B-1 cross-check: switchSoloToOperator が _suppressCloseConfirm bypass を設定', () => {
  const body = extractFunctionBody(MAIN, /async function switchSoloToOperator\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'switchSoloToOperator が見つからない');
  assert.match(body, /mainWindow\._suppressCloseConfirm\s*=\s*true/,
    'switchSoloToOperator が close 前に _suppressCloseConfirm を設定していない');
});

test('B-1 cross-check: confirmQuit が app.quit 前に _suppressCloseConfirm を設定（二重ダイアログ防止）', () => {
  const body = extractFunctionBody(MAIN, /async function confirmQuit\s*\(\s*\)\s*\{/);
  assert.ok(body, 'confirmQuit が見つからない');
  assert.match(body, /_suppressCloseConfirm\s*=\s*true[\s\S]*?app\.quit/,
    'confirmQuit が _suppressCloseConfirm 設定 → app.quit の順で動作していない');
});

// ============================================================
// B-2: hall window のキーフォワード
// ============================================================
test('B-2: createHallWindow に before-input-event ハンドラ + IPC 送信（rc4 で sendInputEvent → IPC 化）', () => {
  const body = extractFunctionBody(MAIN, /function createHallWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createHallWindow が見つからない');
  assert.match(body, /webContents\.on\(\s*['"]before-input-event['"]/,
    "createHallWindow に webContents.on('before-input-event') ハンドラなし");
  assert.match(body, /webContents\.send\(\s*['"]hall:forwarded-key['"]/,
    "createHallWindow の before-input-event で 'hall:forwarded-key' IPC 送信なし（rc4 IPC 化）");
  assert.match(body, /event\.preventDefault/,
    'before-input-event で preventDefault を呼んでいない（hall 自身での消化を防げない）');
});

test('B-2: FORWARD_KEYS_FROM_HALL は空 Set（rc8 案 X、前原さん要望「会場モニターで操作完全無効」）', () => {
  // rc8 で前原さん要望採用 → FORWARD_KEYS_FROM_HALL を空 Set に変更（最小変更、IPC 経路は dead code）。
  // rc4-rc7 で含まれていた Space / Enter / Escape / Arrow×4 / KeyR/A/E/S/M/T/H は全廃止。
  // hall window はさらに focusable: false が追加され、フォーカス自体が取れない多重防御。
  const m = MAIN.match(/const\s+FORWARD_KEYS_FROM_HALL\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)/);
  assert.ok(m, 'FORWARD_KEYS_FROM_HALL 定義が見つからない');
  const items = m[1];
  for (const code of ['Space', 'Enter', 'Escape',
                      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
                      'KeyR', 'KeyA', 'KeyE', 'KeyS', 'KeyM', 'KeyT', 'KeyH']) {
    assert.doesNotMatch(items, new RegExp(`['"]${code}['"]`),
      `FORWARD_KEYS_FROM_HALL に ${code} が残存（rc8 で空 Set 化されるべき）`);
  }
});

test('B-2: FORWARD_KEYS_FROM_HALL に F11 / F12 が含まれていない（rc2 改修との整合）', () => {
  const m = MAIN.match(/const\s+FORWARD_KEYS_FROM_HALL\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)/);
  assert.ok(m, 'FORWARD_KEYS_FROM_HALL 定義が見つからない');
  const items = m[1];
  assert.doesNotMatch(items, /['"]F11['"]/,
    'F11 を forward すると rc2 の getFocusedWindow ベース改修と矛盾する（hall focused 時は hall を toggle すべき）');
  assert.doesNotMatch(items, /['"]F12['"]/,
    'F12 (DevTools) はウィンドウごとに独立すべきで forward しない');
});

test('B-2: _toAcceleratorKey ヘルパは rc4 で削除（IPC 化により不要）', () => {
  // rc3 では sendInputEvent の keyCode フォーマット変換に使っていたが、
  // rc4 では IPC で input.code を直接送るため、ヘルパは削除されている。
  assert.doesNotMatch(MAIN, /function\s+_toAcceleratorKey\s*\(/,
    '_toAcceleratorKey が残存（rc4 で削除されるべき、IPC 化により不要）');
});

// ============================================================
// 既存挙動保護
// ============================================================
test('既存挙動保護: F11 globalShortcut は維持（rc2 改修）', () => {
  assert.match(MAIN,
    /globalShortcut\.register\(\s*['"]F11['"]\s*,\s*toggleFullScreen\s*\)/,
    'F11 → toggleFullScreen の globalShortcut 登録が消失（rc2 互換違反）');
});

test('既存挙動保護: createHallWindow の fullscreen: true / ready-to-show が維持（rc2 改修）', () => {
  const body = extractFunctionBody(MAIN, /function createHallWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createHallWindow が見つからない');
  assert.match(body, /fullscreen:\s*true/,
    'createHallWindow の opts.fullscreen=true が消失（rc2 互換違反）');
  assert.match(body, /once\(\s*['"]ready-to-show['"]/,
    "createHallWindow の win.once('ready-to-show', ...) 保険が消失（rc2 互換違反）");
});

// ============================================================
// 致命バグ保護 5 件 cross-check
// ============================================================
test('致命バグ保護 cross-check: createOperatorWindow の race 防止 closed ハンドラ維持', () => {
  const body = extractFunctionBody(MAIN, /function createOperatorWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createOperatorWindow が見つからない');
  assert.match(body, /const\s+win\s*=\s*new\s+BrowserWindow/,
    'createOperatorWindow が const win = new BrowserWindow パターンを使っていない（v2.0.1 race 違反）');
  assert.match(body, /if\s*\(\s*mainWindow\s*===\s*win\s*\)/,
    'createOperatorWindow の closed で「mainWindow === win」race ガード消失（v2.0.1 違反）');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
