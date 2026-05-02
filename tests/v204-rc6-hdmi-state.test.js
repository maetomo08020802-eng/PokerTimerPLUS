/**
 * v2.0.4-rc6 — HDMI 切替バグ 5 件統合修正の静的解析テスト
 *
 * 対象修正:
 *   Fix 1-A: 再入ガード `_isSwitchingMode` で switchOperatorToSolo / switchSoloToOperator の同時実行を防御
 *   Fix 1-B: display-added / display-removed の debounce ガード `_displayAddedPending` / `_displayRemovedPending`
 *   Fix 1-C: createHallWindow / createOperatorWindow の防御的 close（orphan window 対策）
 *   Fix 2-A: switchOperatorToSolo は operator を close せず minimize（前原さん要望、close→新生成 race を消滅）
 *   Fix 2-B: createOperatorWindow に restore イベント + ポップアップ案内
 *   Fix 3:   toggleFullScreen は hall を優先、不在時に mainWindow（rc2 の getFocusedWindow ベース廃止）
 *   Fix 4-A: dispatchClockShortcut に case 'Escape' 追加（hall 全画面解除を IPC で main に通知）
 *   Fix 4-B: preload.js に dual.requestExitFullScreen 公開
 *   Fix 4-C: main.js に ipcMain.on('dual:request-exit-fullscreen') ハンドラ
 *   Fix 5-M: KeyM 押下時に operator なら window.api.dual.broadcastMuteState で hall に同期
 *   Fix 5-H: KeyH 押下時に operator なら broadcastBottomBarState で hall に同期
 *
 * 致命バグ保護 5 件への影響評価（特に C.1.7 AudioContext resume）も cross-check で担保。
 *
 * 実行: node tests/v204-rc6-hdmi-state.test.js
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
// Fix 1-A: 再入ガード
// ============================================================
test('Fix 1-A: モジュール先頭で _isSwitchingMode フラグが宣言される', () => {
  assert.match(MAIN, /let\s+_isSwitchingMode\s*=\s*false/,
    '_isSwitchingMode フラグ宣言なし（再入ガード未実装）');
});

test('Fix 1-A: switchOperatorToSolo が _isSwitchingMode で再入ガード', () => {
  const body = extractFunctionBody(MAIN, /async function switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo が見つからない');
  assert.match(body, /if\s*\(\s*_isSwitchingMode\s*\)\s*return/,
    'switchOperatorToSolo に _isSwitchingMode 早期 return ガードなし');
  assert.match(body, /_isSwitchingMode\s*=\s*true/,
    'switchOperatorToSolo で _isSwitchingMode = true 設定なし');
  assert.match(body, /_isSwitchingMode\s*=\s*false/,
    'switchOperatorToSolo の finally で _isSwitchingMode = false 解除なし');
});

test('Fix 1-A: switchSoloToOperator が _isSwitchingMode で再入ガード + orphan hallWindow close', () => {
  const body = extractFunctionBody(MAIN, /async function switchSoloToOperator\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'switchSoloToOperator が見つからない');
  assert.match(body, /if\s*\(\s*_isSwitchingMode\s*\)\s*return/,
    'switchSoloToOperator に _isSwitchingMode 早期 return ガードなし');
  // orphan hallWindow を close する経路
  assert.match(body, /hallWindow\s*&&\s*!hallWindow\.isDestroyed\(\)[\s\S]*?hallWindow\.close/,
    'switchSoloToOperator で orphan hallWindow の防御的 close なし');
});

// ============================================================
// Fix 1-B: display イベント debounce
// ============================================================
test('Fix 1-B: _displayAddedPending / _displayRemovedPending フラグが宣言される', () => {
  assert.match(MAIN, /let\s+_displayAddedPending\s*=\s*false/,
    '_displayAddedPending フラグ宣言なし');
  assert.match(MAIN, /let\s+_displayRemovedPending\s*=\s*false/,
    '_displayRemovedPending フラグ宣言なし');
});

test('Fix 1-B: display-added ハンドラが _displayAddedPending で debounce', () => {
  // screen.on('display-added', ...) コールバック内に pending チェックがある
  const m = MAIN.match(/screen\.on\(\s*['"]display-added['"][\s\S]*?\(\)\s*=>\s*\{[\s\S]*?\}\s*\)/);
  assert.ok(m, 'display-added ハンドラ抽出失敗');
  assert.match(m[0], /_displayAddedPending/,
    'display-added ハンドラに _displayAddedPending debounce なし');
});

test('Fix 1-B: display-removed ハンドラが _displayRemovedPending で debounce', () => {
  const m = MAIN.match(/screen\.on\(\s*['"]display-removed['"][\s\S]*?\}\s*\)/);
  assert.ok(m, 'display-removed ハンドラ抽出失敗');
  assert.match(m[0], /_displayRemovedPending/,
    'display-removed ハンドラに _displayRemovedPending debounce なし');
});

// ============================================================
// Fix 1-C: 防御的 close
// ============================================================
test('Fix 1-C: createHallWindow が既存 hallWindow の防御的 close を実行', () => {
  const body = extractFunctionBody(MAIN, /function createHallWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createHallWindow が見つからない');
  // 関数冒頭で hallWindow が生存中なら close する経路
  assert.match(body, /if\s*\(\s*hallWindow\s*&&\s*!hallWindow\.isDestroyed\(\)\s*\)[\s\S]*?hallWindow\.close/,
    'createHallWindow に既存 hallWindow の防御的 close なし');
});

test('Fix 1-C: createOperatorWindow が既存 mainWindow の防御的 close を実行', () => {
  const body = extractFunctionBody(MAIN, /function createOperatorWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createOperatorWindow が見つからない');
  assert.match(body, /if\s*\(\s*mainWindow\s*&&\s*!mainWindow\.isDestroyed\(\)\s*\)[\s\S]*?mainWindow\.close/,
    'createOperatorWindow に既存 mainWindow の防御的 close なし');
});

// ============================================================
// Fix 2: minimize + 復元時ポップアップ
// ============================================================
test('Fix 2-A (rc9 追従): switchOperatorToSolo は mainWindow.show を呼び mainWindow.close / minimize を呼ばない', () => {
  // v2.0.4-rc9 Fix 2-A: minimize → show + focus に変更（IPC 遅延起因の表示消失を根治）。
  //   close は引き続き禁止（race 防止）、hall 側だけ close する設計は維持。
  const body = extractFunctionBody(MAIN, /async function switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo が見つからない');
  assert.match(body, /mainWindow\.show\s*\(\s*\)/,
    'switchOperatorToSolo が mainWindow.show を呼んでいない（rc9 で show 化必須）');
  assert.doesNotMatch(body, /mainWindow\.minimize\s*\(\s*\)/,
    'switchOperatorToSolo に mainWindow.minimize 残存（rc9 で撤去必須）');
  assert.doesNotMatch(body, /mainWindow\.close\s*\(\s*\)/,
    'switchOperatorToSolo が mainWindow.close を呼んでいる（rc6 以降禁止）');
  // hall 側は close する
  assert.match(body, /hallWindow\.close/,
    'switchOperatorToSolo で hallWindow.close を呼んでいない（hall 側は閉じる必要あり）');
});

test('Fix 2-C (rc9 追従): switchOperatorToSolo が _showRestoreNoticeOnce フラグを立てない（撤去済）', () => {
  // v2.0.4-rc9 Fix 2-C: rc6 で導入した restore 時ポップアップ案内（_showRestoreNoticeOnce）は
  //   show 自動復元に伴い不要になり撤去。
  const body = extractFunctionBody(MAIN, /async function switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body, 'switchOperatorToSolo が見つからない');
  assert.doesNotMatch(body, /_showRestoreNoticeOnce\s*=\s*true/,
    'switchOperatorToSolo に _showRestoreNoticeOnce 残存（rc9 で撤去必須）');
});

test('Fix 2-C (rc9 追従): createOperatorWindow から restore ポップアップ案内が撤去されている', () => {
  // v2.0.4-rc9 Fix 2-C: 旧「AC ウィンドウについて」ポップアップ案内は撤去（rc9 では不要）
  const body = extractFunctionBody(MAIN, /function createOperatorWindow\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'createOperatorWindow が見つからない');
  // 旧ポップアップ文言は出てこないこと
  assert.doesNotMatch(body, /AC\s*ウィンドウについて/,
    'createOperatorWindow に旧ポップアップタイトル「AC ウィンドウについて」が残存');
  assert.doesNotMatch(body, /restore[\s\S]{0,500}showMessageBox/,
    'createOperatorWindow に restore→showMessageBox 経路が残存（rc9 で撤去必須）');
});

// ============================================================
// Fix 3: F11 hall 優先
// ============================================================
test('Fix 3: toggleFullScreen が hall 優先 / mainWindow fallback', () => {
  const body = extractFunctionBody(MAIN, /function toggleFullScreen\s*\(\s*\)\s*\{/);
  assert.ok(body, 'toggleFullScreen が見つからない');
  // hallWindow 優先の三項演算
  assert.match(body, /hallWindow\s*&&\s*!hallWindow\.isDestroyed\(\)\s*\)\s*\?\s*hallWindow\s*:\s*mainWindow/,
    'toggleFullScreen が hall 優先 / mainWindow fallback の三項演算になっていない');
  // rc2 の getFocusedWindow ベースは削除されている
  assert.doesNotMatch(body, /BrowserWindow\.getFocusedWindow/,
    'toggleFullScreen に getFocusedWindow が残存（rc6 で削除予定）');
});

// ============================================================
// Fix 4: ESC ハンドラ
// ============================================================
test('Fix 4-A: dispatchClockShortcut に case \'Escape\' が追加され requestExitFullScreen を呼ぶ', () => {
  const body = extractFunctionBody(RENDERER, /function dispatchClockShortcut\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'dispatchClockShortcut が見つからない');
  assert.match(body, /case\s+['"]Escape['"]/,
    "dispatchClockShortcut に case 'Escape' なし");
  // requestExitFullScreen IPC 呼出
  assert.match(body, /requestExitFullScreen/,
    'dispatchClockShortcut の Escape ケースに requestExitFullScreen 呼出なし');
});

test('Fix 4-B: preload.js に dual.requestExitFullScreen 公開', () => {
  assert.match(PRELOAD, /requestExitFullScreen\s*:\s*\(\s*\)\s*=>\s*ipcRenderer\.send\(\s*['"]dual:request-exit-fullscreen['"]/,
    'preload.js に requestExitFullScreen の IPC 送信定義なし');
});

test('Fix 4-C: main.js に ipcMain.on(\'dual:request-exit-fullscreen\') ハンドラ', () => {
  assert.match(MAIN, /ipcMain\.on\(\s*['"]dual:request-exit-fullscreen['"]/,
    "main.js に ipcMain.on('dual:request-exit-fullscreen') ハンドラなし");
  // hall が fullscreen の時のみ setFullScreen(false)
  assert.match(MAIN, /dual:request-exit-fullscreen[\s\S]{0,300}hallWindow[\s\S]{0,200}setFullScreen\(\s*false\s*\)/,
    'request-exit-fullscreen ハンドラで hall.setFullScreen(false) を呼ぶ経路なし');
});

// ============================================================
// Fix 5: M / H 双方向同期
// ============================================================
test('Fix 5-M: KeyM ケースで operator なら broadcastMuteState を呼ぶ', () => {
  const body = extractFunctionBody(RENDERER, /function dispatchClockShortcut\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'dispatchClockShortcut が見つからない');
  // case 'KeyM' のブロックで appRole === 'operator' なら broadcastMuteState を呼ぶ
  assert.match(body, /case\s+['"]KeyM['"][\s\S]*?appRole\s*===\s*['"]operator['"][\s\S]*?broadcastMuteState/,
    "case 'KeyM' で operator 限定の broadcastMuteState 呼出なし");
});

test('Fix 5-M: preload.js に broadcastMuteState / onMuteStateChanged 公開', () => {
  assert.match(PRELOAD, /broadcastMuteState\s*:\s*\(/,
    'preload.js に broadcastMuteState 送信なし');
  assert.match(PRELOAD, /onMuteStateChanged\s*:\s*\(/,
    'preload.js に onMuteStateChanged 受信なし');
});

test('Fix 5-M: main.js に dual:broadcast-mute-state ハンドラ + hall への中継', () => {
  assert.match(MAIN, /ipcMain\.on\(\s*['"]dual:broadcast-mute-state['"]/,
    "main.js に ipcMain.on('dual:broadcast-mute-state') なし");
  assert.match(MAIN, /broadcast-mute-state[\s\S]{0,300}hallWindow[\s\S]{0,200}send\(\s*['"]dual:mute-state-changed['"]/,
    'main.js で hall に dual:mute-state-changed を中継する経路なし');
});

test('Fix 5-M: hall ロール時に onMuteStateChanged で受信して反映', () => {
  // hall ブランチ内で onMuteStateChanged を登録
  assert.match(RENDERER, /onMuteStateChanged[\s\S]{0,500}audioToggleMute/,
    'hall 側で onMuteStateChanged 受信 → audioToggleMute 経路なし');
});

test('Fix 5-H: KeyH ケースで operator なら broadcastBottomBarState を呼ぶ', () => {
  const body = extractFunctionBody(RENDERER, /function dispatchClockShortcut\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'dispatchClockShortcut が見つからない');
  assert.match(body, /case\s+['"]KeyH['"][\s\S]*?appRole\s*===\s*['"]operator['"][\s\S]*?broadcastBottomBarState/,
    "case 'KeyH' で operator 限定の broadcastBottomBarState 呼出なし");
});

test('Fix 5-H: preload.js + main.js に bottombar 同期 IPC 経路', () => {
  assert.match(PRELOAD, /broadcastBottomBarState\s*:\s*\(/,
    'preload.js に broadcastBottomBarState 送信なし');
  assert.match(PRELOAD, /onBottomBarStateChanged\s*:\s*\(/,
    'preload.js に onBottomBarStateChanged 受信なし');
  assert.match(MAIN, /ipcMain\.on\(\s*['"]dual:broadcast-bottombar-state['"]/,
    "main.js に ipcMain.on('dual:broadcast-bottombar-state') なし");
  assert.match(MAIN, /broadcast-bottombar-state[\s\S]{0,300}hallWindow[\s\S]{0,200}send\(\s*['"]dual:bottombar-state-changed['"]/,
    'main.js で hall に dual:bottombar-state-changed を中継する経路なし');
});

// ============================================================
// 致命バグ保護 5 件 cross-check（特に C.1.7 AudioContext resume）
// ============================================================
test('致命バグ保護 C.1.7: KeyM ケースが ensureAudioReady().then(...) ラップを維持', () => {
  const body = extractFunctionBody(RENDERER, /function dispatchClockShortcut\s*\([^)]*\)\s*\{/);
  assert.ok(body, 'dispatchClockShortcut が見つからない');
  // case 'KeyM' のブロックを取り出す
  const km = body.match(/case\s+['"]KeyM['"][\s\S]*?break\s*;/);
  assert.ok(km, "case 'KeyM' ブロック抽出失敗");
  // ensureAudioReady().then(...) で audioToggleMute を包んでいる（C.1.7 不変条件）
  assert.match(km[0], /ensureAudioReady\s*\(\s*\)\s*\.then\s*\([\s\S]*?audioToggleMute/,
    'case KeyM で ensureAudioReady().then(...) ラップが消失（C.1.7 違反）');
});

test('致命バグ保護: hall 側 onMuteStateChanged も ensureAudioReady ラップ済', () => {
  // hall ブランチの onMuteStateChanged コールバックも ensureAudioReady().then を経由する
  assert.match(RENDERER, /onMuteStateChanged[\s\S]{0,500}ensureAudioReady\s*\(\s*\)\s*\.then\s*\(/,
    'hall 側 onMuteStateChanged で ensureAudioReady ラップなし（C.1.7 違反）');
});

test('致命バグ保護: schedulePersistRuntime 6 箇所以上維持（C.1.8）', () => {
  const callCount = (RENDERER.match(/schedulePersistRuntime\s*\(\s*\)/g) || []).length;
  assert.ok(callCount >= 6,
    `schedulePersistRuntime 呼出が ${callCount} 箇所（6 以上必要、C.1.8 不変条件）`);
});

test('致命バグ保護: resetBlindProgressOnly が tournamentRuntime に触れない（C.2.7-A）', () => {
  const body = extractFunctionBody(RENDERER, /function resetBlindProgressOnly\s*\(\s*\)\s*\{/);
  assert.ok(body, 'resetBlindProgressOnly が見つからない');
  assert.doesNotMatch(body, /tournamentRuntime\.\w+\s*=[^=]/,
    'resetBlindProgressOnly が tournamentRuntime を変更（C.2.7-A 違反）');
});

// ============================================================
// operator-solo モード（v1.3.0 互換）への影響なし確認
// ============================================================
test('operator-solo 互換: createOperatorWindow(_, true) 経路は従来通り動作', () => {
  // createMainWindow 内で operator-solo を生成する経路が維持されている
  assert.match(MAIN, /createOperatorWindow\([^)]*,\s*true\s*\)/,
    'createOperatorWindow(_, true)（operator-solo 起動経路）が消失');
});

test('operator-solo 互換: 単画面 fallback (hallWindow 不在) で toggleFullScreen が mainWindow を toggle', () => {
  const body = extractFunctionBody(MAIN, /function toggleFullScreen\s*\(\s*\)\s*\{/);
  assert.ok(body, 'toggleFullScreen が見つからない');
  // 三項の else（fallback）に mainWindow がある
  assert.match(body, /:\s*mainWindow/,
    'toggleFullScreen の hallWindow 不在 fallback で mainWindow を使っていない（v1.3.0 互換違反）');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
