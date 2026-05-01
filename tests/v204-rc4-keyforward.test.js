/**
 * v2.0.4-rc4 — キーフォワード IPC 化の静的解析テスト
 *
 * 対象修正（rc3 sendInputEvent → rc4 IPC 化）:
 *   - FORWARD_KEYS_FROM_HALL を input.code ベースに置換
 *   - createHallWindow の before-input-event で mainWindow.webContents.send('hall:forwarded-key', ...) IPC 送信
 *   - preload.js に dual.onHallForwardedKey 公開
 *   - renderer.js に dispatchClockShortcut 関数化 + IPC 受信ハンドラ
 *
 * 実行: node tests/v204-rc4-keyforward.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD  = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');

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
// T1: FORWARD_KEYS_FROM_HALL の組成（rc4 改訂）
// ============================================================
test('T1: FORWARD_KEYS_FROM_HALL に KeyR / KeyE / KeyS / KeyM / KeyT が含まれる（rc3 で無反応だった letter 系）', () => {
  const m = MAIN.match(/const\s+FORWARD_KEYS_FROM_HALL\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)/);
  assert.ok(m, 'FORWARD_KEYS_FROM_HALL 定義が見つからない');
  const items = m[1];
  assert.match(items, /['"]KeyR['"]/, 'KeyR なし');
  assert.match(items, /['"]KeyA['"]/, 'KeyA なし');
  assert.match(items, /['"]KeyE['"]/, 'KeyE なし');
  assert.match(items, /['"]KeyS['"]/, 'KeyS なし');
  assert.match(items, /['"]KeyM['"]/, 'KeyM なし');
  assert.match(items, /['"]KeyT['"]/, 'KeyT なし');
});

test('T2: FORWARD_KEYS_FROM_HALL に KeyH が含まれる（rc5 で前回判断撤回、便利機能の対称性）', () => {
  // rc4 まで「H は PC 側のみ」だったが rc5 で前原さん判断撤回 → forward 対象に追加
  const m = MAIN.match(/const\s+FORWARD_KEYS_FROM_HALL\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)/);
  assert.ok(m, 'FORWARD_KEYS_FROM_HALL 定義が見つからない');
  assert.match(m[1], /['"]KeyH['"]/,
    'KeyH が forward 対象になっていない（rc5 で追加すべき、前原さん判断撤回）');
});

test('T3: FORWARD_KEYS_FROM_HALL に F11 / F12 が含まれない（rc2 改修との整合）', () => {
  const m = MAIN.match(/const\s+FORWARD_KEYS_FROM_HALL\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)/);
  assert.ok(m, 'FORWARD_KEYS_FROM_HALL 定義が見つからない');
  assert.doesNotMatch(m[1], /['"]F11['"]/,  'F11 が forward 対象（rc2: getFocusedWindow ベースとの矛盾）');
  assert.doesNotMatch(m[1], /['"]F12['"]/,  'F12 が forward 対象（DevTools 独立性違反）');
});

// ============================================================
// T4-T5: main.js IPC 送信経路
// ============================================================
test('T4: createHallWindow の before-input-event が hall:forwarded-key IPC を送信', () => {
  const body = extractFunctionBody(MAIN, /function createHallWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createHallWindow が見つからない');
  assert.match(body, /webContents\.on\(\s*['"]before-input-event['"]/,
    "before-input-event ハンドラなし");
  assert.match(body, /mainWindow\.webContents\.send\(\s*['"]hall:forwarded-key['"]/,
    "hall:forwarded-key の IPC 送信なし");
  assert.match(body, /event\.preventDefault/,
    'preventDefault なし（hall 自身での消化を防げない）');
});

test('T5: rc3 の sendInputEvent / _toAcceleratorKey は削除されている', () => {
  // sendInputEvent はコメント以外（コードとして実際に呼ばれている箇所）が無い
  assert.doesNotMatch(MAIN, /webContents\.sendInputEvent\s*\(/,
    'webContents.sendInputEvent 呼出が残存（rc4 IPC 化で削除されるべき）');
  assert.doesNotMatch(MAIN, /function\s+_toAcceleratorKey\s*\(/,
    '_toAcceleratorKey 関数定義が残存（rc4 IPC 化で削除されるべき）');
});

// ============================================================
// T6-T7: preload.js に IPC 受信口
// ============================================================
test('T6: preload.js に dual.onHallForwardedKey が公開されている', () => {
  assert.match(PRELOAD, /onHallForwardedKey\s*:\s*\(/,
    'preload.js に onHallForwardedKey 公開なし');
});

test('T7: preload.js が ipcRenderer.on(\'hall:forwarded-key\') で listen', () => {
  assert.match(PRELOAD, /ipcRenderer\.on\(\s*['"]hall:forwarded-key['"]/,
    "ipcRenderer.on('hall:forwarded-key') の listen なし");
});

// ============================================================
// T8-T10: renderer.js 共通 dispatcher + IPC 受信
// ============================================================
test('T8: dispatchClockShortcut 関数が定義され、本体に switch (event.code) を持つ', () => {
  const body = extractFunctionBody(RENDERER, /function dispatchClockShortcut\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'dispatchClockShortcut が見つからない');
  assert.match(body, /switch\s*\(\s*event\.code\s*\)/,
    'dispatchClockShortcut に switch (event.code) がない');
});

test('T9: dispatchClockShortcut に主要ショートカット case が含まれる（リファクタの挙動完全維持）', () => {
  const body = extractFunctionBody(RENDERER, /function dispatchClockShortcut\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'dispatchClockShortcut が見つからない');
  for (const code of ['Space', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown',
                      'KeyR', 'KeyA', 'KeyE', 'KeyS', 'KeyM', 'KeyH']) {
    assert.match(body, new RegExp(`case\\s+['"]${code}['"]`),
      `dispatchClockShortcut に case '${code}' がない（rc3 まで動作した既存挙動の喪失）`);
  }
  // Ctrl+T は switch の前で処理（既存ロジック維持）
  assert.match(body, /event\.code\s*===\s*['"]KeyT['"]/, 'Ctrl+T 判定なし（マーキー編集ショートカット）');
});

test('T10: renderer.js が dual.onHallForwardedKey で IPC 受信し dispatchClockShortcut を呼ぶ', () => {
  // operator role 限定の guard + onHallForwardedKey 呼出
  assert.match(RENDERER,
    /window\.appRole\s*===\s*['"]operator['"][\s\S]*?onHallForwardedKey/,
    'renderer.js に operator 限定の onHallForwardedKey 受信なし');
  // コールバック内で dispatchClockShortcut を呼ぶ
  assert.match(RENDERER,
    /onHallForwardedKey[\s\S]*?dispatchClockShortcut\s*\(/,
    'onHallForwardedKey のコールバックで dispatchClockShortcut を呼んでいない');
});

// ============================================================
// T11: ローカル keydown ハンドラが dispatchClockShortcut を呼ぶ（refactor 検証）
// ============================================================
test('T11: window.addEventListener(\'keydown\') が dispatchClockShortcut を呼ぶ', () => {
  // keydown コールバック本体を抽出
  const m = RENDERER.match(/window\.addEventListener\(\s*['"]keydown['"][\s\S]*?\(event\)\s*=>\s*\{/);
  assert.ok(m, 'window.addEventListener("keydown") が見つからない');
  let depth = 1, i = m.index + m[0].length;
  while (i < RENDERER.length && depth > 0) {
    if (RENDERER[i] === '{') depth++;
    else if (RENDERER[i] === '}') depth--;
    i++;
  }
  const handlerBody = RENDERER.slice(m.index, i);
  assert.match(handlerBody, /dispatchClockShortcut\s*\(\s*event\s*\)/,
    'keydown ハンドラから dispatchClockShortcut(event) が呼ばれていない');
  // 入力フィールドガードはローカル側に残置（IPC 経由は target を持たない）
  assert.match(handlerBody, /target\.tagName\s*===\s*['"]INPUT['"]/,
    'keydown ハンドラから入力フィールドガードが消失（INPUT/TEXTAREA/SELECT/contentEditable）');
});

// ============================================================
// 致命バグ保護 cross-check
// ============================================================
test('致命バグ保護: dispatchClockShortcut が adjustReentry / adjustAddOn / addNewEntry / eliminatePlayer を呼ぶ', () => {
  const body = extractFunctionBody(RENDERER, /function dispatchClockShortcut\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'dispatchClockShortcut が見つからない');
  for (const fn of ['adjustReentry', 'adjustAddOn', 'addNewEntry', 'eliminatePlayer',
                    'cancelNewEntry', 'revivePlayer', 'adjustSpecialStack']) {
    assert.match(body, new RegExp(`${fn}\\s*\\(`),
      `dispatchClockShortcut から ${fn}() 呼出が消失（致命バグ保護違反）`);
  }
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
