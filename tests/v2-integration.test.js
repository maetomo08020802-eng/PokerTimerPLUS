/**
 * v2.0.0 STEP 6 — 統合テスト（STEP 0〜5 の組み合わせ動作の静的解析）
 *
 * 検証対象（cross-step）:
 *   - 起動シーケンス全体（whenReady → displays 取得 → picker → window 生成 → display-change 購読）
 *   - IPC ハンドラ群の共存（STEP 2/4/5 すべて）
 *   - additionalArguments で role 4 種類すべての設定パスが存在
 *   - renderer.js 起動部に dual-sync import + notifyOperatorActionIfNeeded + ensureAudioReady
 *   - hallWindow 不在時の broadcast 安全性
 *   - chooseHallDisplayInteractive キャンセル → operator-solo 単画面起動
 *   - HDMI 抜き → operator-solo 切替時に ensureAudioReady 経路
 *   - 致命バグ保護 5 件すべての関数本体が renderer.js / main.js / audio.js に維持
 *
 * 実行: node tests/v2-integration.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT     = path.join(__dirname, '..');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD  = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const AUDIO    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');
const DUAL_SYNC = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1: 起動シーケンス全体フロー（main.js）
// ============================================================
test('T1: 起動シーケンスの全要素が main.js に揃う', () => {
  // app.whenReady → registerIpcHandlers → createMainWindow → registerShortcuts → setupDisplayChangeListeners
  assert.match(MAIN, /app\.whenReady\(\)\.then\(\s*async\s*\(\s*\)\s*=>/, 'app.whenReady().then(async ...) なし');
  assert.match(MAIN, /screen\.getAllDisplays\s*\(/, 'screen.getAllDisplays 呼出なし');
  assert.match(MAIN, /chooseHallDisplayInteractive\s*\(/, 'chooseHallDisplayInteractive 呼出なし');
  assert.match(MAIN, /createOperatorWindow\s*\(/, 'createOperatorWindow 呼出なし');
  assert.match(MAIN, /createHallWindow\s*\(/, 'createHallWindow 呼出なし');
  assert.match(MAIN, /setupDisplayChangeListeners\s*\(\s*\)/, 'setupDisplayChangeListeners 呼出なし');
});

// ============================================================
// T2: 全 IPC ハンドラ共存（STEP 2/4/5）
// ============================================================
test('T2: STEP 2/4/5 の IPC ハンドラ群がすべて main.js に共存', () => {
  // STEP 2
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]dual:state-sync-init['"]/, 'dual:state-sync-init なし');
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]dual:operator-action['"]/, 'dual:operator-action なし');
  // STEP 4
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]display-picker:fetch['"]/, 'display-picker:fetch なし');
  assert.match(MAIN, /ipcMain\.on\(\s*['"]dual:select-hall-monitor['"]/, 'dual:select-hall-monitor なし');
  // STEP 5
  assert.match(MAIN, /screen\.on\(\s*['"]display-removed['"]/, 'screen.on display-removed なし');
  assert.match(MAIN, /screen\.on\(\s*['"]display-added['"]/, 'screen.on display-added なし');
});

// ============================================================
// T3: additionalArguments role 4 種類すべて
// ============================================================
test('T3: additionalArguments で role 4 種類（operator / hall / operator-solo / picker）', () => {
  // operator / operator-solo: createOperatorWindow 内で isSolo 三項演算
  assert.match(MAIN, /isSolo\s*\?\s*['"]operator-solo['"]\s*:\s*['"]operator['"]/, 'operator/operator-solo の三項分岐なし');
  // hall: createHallWindow 内
  assert.match(MAIN, /buildWebPreferences\(\s*['"]hall['"]\s*\)/, 'hall role なし');
  // picker: chooseHallDisplayInteractive 内
  assert.match(MAIN, /['"]--role=picker['"]/, '--role=picker なし');
  // preload.js 側で 4 種類すべてを抽出する経路（共通の正規表現）
  assert.match(PRELOAD, /--role=/, 'preload で --role= 抽出なし');
});

// ============================================================
// T4: renderer.js 起動部の統合（STEP 2/3/5）
// ============================================================
test('T4: renderer.js に dual-sync import + notifyOperatorActionIfNeeded + ensureAudioReady', () => {
  // STEP 2: dual-sync import
  assert.match(RENDERER, /import\s+\{\s*initDualSyncForHall\s*\}\s+from\s+['"]\.\/dual-sync\.js['"]/,
    'initDualSyncForHall import なし');
  // STEP 3: notifyOperatorActionIfNeeded ヘルパー
  assert.match(RENDERER, /function\s+notifyOperatorActionIfNeeded\s*\(/, 'notifyOperatorActionIfNeeded なし');
  // STEP 5: operator-solo 経路で ensureAudioReady（C.1.7 の明示呼出強化）
  // __appRole 分岐の else ブロック（operator-solo）に initialize() + ensureAudioReady()
  const elseMatch = RENDERER.match(/__appRole\s*===\s*['"]operator['"][\s\S]*?\}\s*else\s*\{([\s\S]*?)\}\s*$/m);
  assert.ok(elseMatch, '__appRole 分岐の else (operator-solo) ブロック抽出失敗');
  assert.match(elseMatch[1], /initialize\s*\(\s*\)/, 'else 分岐に initialize() なし');
  assert.match(elseMatch[1], /ensureAudioReady\s*\(\s*\)/, 'else 分岐に ensureAudioReady() なし');
});

// ============================================================
// T5: hallWindow 不在時の _broadcastDualState 安全性
// ============================================================
test('T5: _broadcastDualState は hall 不在 / destroyed で no-op return（_publishDualState から呼ばれる安全性）', () => {
  // _broadcastDualState の早期 return ガード
  assert.match(MAIN, /function\s+_broadcastDualState\s*\([\s\S]*?if\s*\(\s*!hallWindow\s*\|\|\s*hallWindow\.isDestroyed\(\)\s*\)\s*return/,
    '_broadcastDualState の hall 不在 no-op ガードなし');
  // _publishDualState は _broadcastDualState を経由（直接 send は使わず broadcast 関数を介する）
  assert.match(MAIN, /function\s+_publishDualState\s*\([\s\S]*?_broadcastDualState\s*\(/,
    '_publishDualState が _broadcastDualState を経由していない');
});

// ============================================================
// T6: chooseHallDisplayInteractive キャンセル → operator-solo 起動の連携（STEP 4 + STEP 5）
// ============================================================
test('T6: createMainWindow が hallId == null で createOperatorWindow(_, true) 単画面起動', () => {
  // createMainWindow async 化 + キャンセル時の operator-solo 経路
  // 引数に screen.getPrimaryDisplay() を含むので [\s\S]*? で lazy 全文字マッチ
  const re = /async\s+function\s+createMainWindow\s*\([\s\S]*?hallId\s*==\s*null[\s\S]*?createOperatorWindow\([\s\S]*?,\s*true\s*\)/;
  assert.match(MAIN, re, 'createMainWindow に hallId == null → operator-solo 経路なし');
  // chooseHallDisplayInteractive 内のキャンセル経路（closed → resolve(null)）
  assert.match(MAIN, /pickerWin\.on\(\s*['"]closed['"][\s\S]*?resolve\(\s*null\s*\)/,
    'picker closed イベントで resolve(null) なし');
});

// ============================================================
// T7: HDMI 抜き → operator-solo 切替 → ensureAudioReady 経路（STEP 5 + C.1.7）
// ============================================================
test('T7: switchOperatorToSolo → createOperatorWindow(_, true) → operator-solo renderer で ensureAudioReady', () => {
  // switchOperatorToSolo が createOperatorWindow(_, true) を呼ぶ
  assert.match(MAIN, /async\s+function\s+switchOperatorToSolo\s*\([\s\S]*?createOperatorWindow\([^)]*,\s*true\s*\)/,
    'switchOperatorToSolo が createOperatorWindow(_, true) を呼んでいない');
  // operator-solo renderer 起動時に ensureAudioReady（T4 と重複するが連携経路として再確認）
  assert.match(RENDERER, /ensureAudioReady\s*\(\s*\)/, 'renderer.js に ensureAudioReady 呼出なし');
  // C.1.7 の audio.js 側 _play 内 resume が維持
  assert.match(AUDIO, /audioContext\.state\s*===\s*['"]suspended['"][\s\S]*?resume/,
    'audio.js の _play 内 suspend resume が消失');
});

// ============================================================
// T8: 致命バグ保護 5 件すべての関数本体・呼出経路が維持（cross-step 静的検査）
// ============================================================
test('T8: 致命バグ保護 5 件すべて維持（resetBlindProgressOnly / timerState destructure / ensureEditorEditableState / AudioContext resume / runtime 永続化）', () => {
  // C.2.7-A: resetBlindProgressOnly
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/, 'resetBlindProgressOnly 関数なし');
  // C.2.7-D: timerState destructure 除外（setDisplaySettings の payload に timerState が混入していない）
  const destructureMatch = MAIN.match(/ipcMain\.handle\(\s*['"]tournaments:setDisplaySettings['"][\s\S]*?const\s*\{\s*([^}]*)\s*\}\s*=\s*payload/);
  assert.ok(destructureMatch, 'tournaments:setDisplaySettings の destructure 抽出失敗');
  assert.doesNotMatch(destructureMatch[1], /timerState/, 'setDisplaySettings の destructure に timerState 混入（C.2.7-D 違反）');
  // C.1-A2: ensureEditorEditableState
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/, 'ensureEditorEditableState 関数なし');
  // C.1.7: AudioContext resume in _play
  assert.match(AUDIO, /audioContext\.state\s*===\s*['"]suspended['"]/, 'AudioContext suspend チェックなし');
  // C.1.8: runtime 永続化（schedulePersistRuntime が renderer.js に存在 + 8 箇所程度の呼出）
  assert.match(RENDERER, /function\s+schedulePersistRuntime\s*\(/, 'schedulePersistRuntime 関数なし');
  const callCount = (RENDERER.match(/schedulePersistRuntime\s*\(\s*\)/g) || []).length;
  assert.ok(callCount >= 6, `schedulePersistRuntime 呼出が ${callCount} 箇所、6 以上必要（C.1.8 永続化フック）`);
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
