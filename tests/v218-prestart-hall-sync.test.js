/**
 * v2.1.6 静的解析テスト — PRE_START 2 画面同期根治（案 2: 専用 broadcast kind 'preStartState'）
 *
 *   Fix 1: main.js 新 broadcast kind 'preStartState' 追加 + IPC handler 'dual:publish-pre-start-state'
 *   Fix 2: src/preload.js dual.publishPreStartState API 公開
 *   Fix 3: src/renderer/timer.js handlers 拡張（onPreStartStart / onPreStartCancel / onPreStartAdjust）
 *          + PRE_START 経路 5 箇所で handler 発火
 *   Fix 4: src/renderer/renderer.js operator broadcast（rAF tick の 1 秒間引き）+ hall receiver +
 *          スライドショー連動 + 致命バグ保護（致命 5 件すべて維持）
 *   Fix 5: B5 audit — kind === 'marqueeSettings' で value 内フィールド null guard
 *
 * 真因: v2.0.3 Fix L で PRE_START → 'idle' 化（renderer.js:1271）+ VALID_TIMER_STATUS（main.js:414）
 *       で 'PRE_START' 欠落 → hall は status='idle' で受信 → applyTimerStateToTimer の早期 return →
 *       カウントダウン駆動なし。専用 kind broadcast で session state を別経路で配信して根治。
 *
 * 致命バグ保護 5 件すべて完全無傷（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）。
 *
 * 実行: node tests/v218-prestart-hall-sync.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const PKG      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const MAIN_JS  = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD  = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const TIMER_JS = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'timer.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1 (Fix 1): main.js _dualStateCache に preStartState フィールドが定義されている
// ============================================================
test('T1 (Fix 1): main.js _dualStateCache に preStartState: null フィールド', () => {
  const m = MAIN_JS.match(/const\s+_dualStateCache\s*=\s*\{[\s\S]*?\};/);
  assert.ok(m, '_dualStateCache 定数定義が見つからない');
  const body = m[0];
  assert.ok(/preStartState:\s*null/.test(body),
    '_dualStateCache に preStartState: null フィールドが追加されていない');
});

// ============================================================
// T2 (Fix 1): main.js に IPC handler 'dual:publish-pre-start-state' が登録されている
// ============================================================
test('T2 (Fix 1): main.js に ipcMain.on("dual:publish-pre-start-state") 登録', () => {
  assert.ok(/ipcMain\.on\s*\(\s*['"]dual:publish-pre-start-state['"]/.test(MAIN_JS),
    'ipcMain.on("dual:publish-pre-start-state") ハンドラが見つからない');
  // ハンドラブロック内で _publishDualState('preStartState', ...) を呼んでいる
  const handlerStart = MAIN_JS.indexOf("ipcMain.on('dual:publish-pre-start-state'");
  assert.ok(handlerStart >= 0, 'IPC handler 開始位置が見つからない');
  const handlerBlock = MAIN_JS.slice(handlerStart, handlerStart + 1500);
  assert.ok(/_publishDualState\(\s*['"]preStartState['"]/.test(handlerBlock),
    'IPC handler 内で _publishDualState("preStartState", ...) を呼んでいない');
  // payload sanitize（Number.isFinite + 非負ガード）
  assert.ok(/Number\.isFinite\(payload\.totalMs\)/.test(handlerBlock),
    'IPC handler に payload.totalMs の Number.isFinite ガードがない');
});

// ============================================================
// T3 (Fix 1): VALID_TIMER_STATUS は変更されていない（v2.0.3 Fix L 設計維持）
// ============================================================
test('T3 (Fix 1 保護): VALID_TIMER_STATUS は idle/running/paused/finished のまま', () => {
  // PRE_START を VALID_TIMER_STATUS に追加していないこと（永続化対象外、設計維持）
  const m = MAIN_JS.match(/VALID_TIMER_STATUS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'VALID_TIMER_STATUS が見つからない');
  const arr = m[1];
  assert.ok(/['"]idle['"]/.test(arr), 'VALID_TIMER_STATUS に idle が含まれない');
  assert.ok(/['"]running['"]/.test(arr), 'VALID_TIMER_STATUS に running が含まれない');
  assert.ok(/['"]paused['"]/.test(arr), 'VALID_TIMER_STATUS に paused が含まれない');
  assert.ok(/['"]finished['"]/.test(arr), 'VALID_TIMER_STATUS に finished が含まれない');
  assert.ok(!/['"]PRE_START['"]/i.test(arr) && !/['"]preStart['"]/i.test(arr),
    'VALID_TIMER_STATUS に PRE_START 系が追加されている（v2.0.3 Fix L 設計違反）');
});

// ============================================================
// T4 (Fix 2): preload.js に dual.publishPreStartState API が公開
// ============================================================
test('T4 (Fix 2): preload.js dual.publishPreStartState 公開', () => {
  assert.ok(/publishPreStartState:\s*\(payload\)\s*=>\s*ipcRenderer\.send\s*\(\s*['"]dual:publish-pre-start-state['"]/.test(PRELOAD),
    'preload.js dual.publishPreStartState API が見つからない');
});

// ============================================================
// T5 (Fix 3): timer.js handlers に onPreStartStart / onPreStartCancel / onPreStartAdjust
// ============================================================
test('T5 (Fix 3): timer.js handlers に v2.1.6 新 handler 3 つ追加', () => {
  // handlers オブジェクト定義に 3 つの新 handler が含まれる
  assert.ok(/onPreStartStart:\s*\(\)\s*=>\s*\{\s*\}/.test(TIMER_JS),
    'handlers.onPreStartStart の初期化が見つからない');
  assert.ok(/onPreStartCancel:\s*\(\)\s*=>\s*\{\s*\}/.test(TIMER_JS),
    'handlers.onPreStartCancel の初期化が見つからない');
  assert.ok(/onPreStartAdjust:\s*\(\)\s*=>\s*\{\s*\}/.test(TIMER_JS),
    'handlers.onPreStartAdjust の初期化が見つからない');
  // setHandlers の destructuring 引数に 3 つの新 handler 名が含まれる
  const setHandlersM = TIMER_JS.match(/export function setHandlers\(\{[^}]*\}/);
  assert.ok(setHandlersM, 'setHandlers 関数定義が見つからない');
  assert.ok(/onPreStartStart/.test(setHandlersM[0]),
    'setHandlers 引数に onPreStartStart がない');
  assert.ok(/onPreStartCancel/.test(setHandlersM[0]),
    'setHandlers 引数に onPreStartCancel がない');
  assert.ok(/onPreStartAdjust/.test(setHandlersM[0]),
    'setHandlers 引数に onPreStartAdjust がない');
});

// ============================================================
// T6 (Fix 3): timer.js startPreStart / cancelPreStart / advancePreStartBy / preStartTick で handler 発火
// ============================================================
test('T6 (Fix 3): timer.js PRE_START 経路で新 handler 発火（5 箇所）', () => {
  // startPreStart 内で onPreStartStart 発火
  const startPreStartIdx = TIMER_JS.indexOf('export function startPreStart');
  assert.ok(startPreStartIdx >= 0, 'startPreStart 関数が見つからない');
  const startPreStartBody = TIMER_JS.slice(startPreStartIdx, startPreStartIdx + 1500);
  assert.ok(/handlers\.onPreStartStart\(/.test(startPreStartBody),
    'startPreStart 内で handlers.onPreStartStart 発火がない');

  // cancelPreStart 内で onPreStartCancel 発火
  const cancelIdx = TIMER_JS.indexOf('export function cancelPreStart');
  assert.ok(cancelIdx >= 0, 'cancelPreStart 関数が見つからない');
  const cancelBody = TIMER_JS.slice(cancelIdx, cancelIdx + 500);
  assert.ok(/handlers\.onPreStartCancel\(/.test(cancelBody),
    'cancelPreStart 内で handlers.onPreStartCancel 発火がない');

  // reset 内で wasPreStart 経由で onPreStartCancel 発火
  const resetIdx = TIMER_JS.indexOf('export function reset()');
  assert.ok(resetIdx >= 0, 'reset 関数が見つからない');
  const resetBody = TIMER_JS.slice(resetIdx, resetIdx + 1500);
  assert.ok(/wasPreStart/.test(resetBody),
    'reset 内に wasPreStart フラグ（v2.1.6 PRE_START 中の reset 検出）がない');
  assert.ok(/handlers\.onPreStartCancel\(/.test(resetBody),
    'reset 内で handlers.onPreStartCancel 発火がない');

  // advancePreStartBy 内で onPreStartAdjust 発火
  const advIdx = TIMER_JS.indexOf('function advancePreStartBy');
  assert.ok(advIdx >= 0, 'advancePreStartBy 関数が見つからない');
  const advBody = TIMER_JS.slice(advIdx, advIdx + 1500);
  assert.ok(/handlers\.onPreStartAdjust\(/.test(advBody),
    'advancePreStartBy 内で handlers.onPreStartAdjust 発火がない');

  // preStartTick 自動遷移時に onPreStartCancel 発火（PRE_START → RUNNING）
  const tickIdx = TIMER_JS.indexOf('function preStartTick');
  assert.ok(tickIdx >= 0, 'preStartTick 関数が見つからない');
  const tickBody = TIMER_JS.slice(tickIdx, tickIdx + 1000);
  assert.ok(/handlers\.onPreStartCancel\(/.test(tickBody),
    'preStartTick 自動遷移時に handlers.onPreStartCancel 発火がない');
});

// ============================================================
// T7 (Fix 4): renderer.js operator 側 publishPreStartIfOperator + 1 秒間引き
// ============================================================
test('T7 (Fix 4): renderer.js operator broadcast ヘルパ + 1 秒間引き', () => {
  assert.ok(/function publishPreStartIfOperator\(/.test(RENDERER),
    'publishPreStartIfOperator ヘルパ関数が見つからない');
  // hall ロール時は no-op（broadcast は operator のみ）
  const helperIdx = RENDERER.indexOf('function publishPreStartIfOperator(');
  const helperBody = RENDERER.slice(helperIdx, helperIdx + 500);
  assert.ok(/window\.appRole\s*===\s*['"]hall['"]/.test(helperBody),
    'publishPreStartIfOperator に hall role ガードがない');
  assert.ok(/window\.api\?\.dual\?\.publishPreStartState/.test(helperBody),
    'publishPreStartIfOperator が window.api.dual.publishPreStartState を参照していない');

  // setHandlers 内に rAF tick の 1 秒間引きロジック
  assert.ok(/_preStartTickLastSentAt/.test(RENDERER),
    '_preStartTickLastSentAt（rAF tick 間引き計測）が定義されていない');
  // 1000ms 閾値での間引き
  assert.ok(/now\s*-\s*_preStartTickLastSentAt\s*>=\s*1000/.test(RENDERER),
    'rAF tick の 1 秒（1000ms）間引きが実装されていない');
});

// ============================================================
// T8 (Fix 4): renderer.js setHandlers に onPreStartStart / onPreStartCancel / onPreStartAdjust 登録
// ============================================================
test('T8 (Fix 4): renderer.js setHandlers に v2.1.6 新 handler 登録', () => {
  // setHandlers 呼出ブロックを抽出
  const setHIdx = RENDERER.indexOf('setHandlers({');
  assert.ok(setHIdx >= 0, 'setHandlers({...}) 呼出が見つからない');
  const setHBody = RENDERER.slice(setHIdx, setHIdx + 4000);
  assert.ok(/onPreStartStart:\s*\(/.test(setHBody),
    'setHandlers 呼出に onPreStartStart が登録されていない');
  assert.ok(/onPreStartCancel:\s*\(/.test(setHBody),
    'setHandlers 呼出に onPreStartCancel が登録されていない');
  assert.ok(/onPreStartAdjust:\s*\(/.test(setHBody),
    'setHandlers 呼出に onPreStartAdjust が登録されていない');
});

// ============================================================
// T9 (Fix 4): renderer.js hall 側 receiver + applyHallPreStartState 関数
// ============================================================
test('T9 (Fix 4): renderer.js hall receiver + applyHallPreStartState 関数', () => {
  // hall 受信ハンドラ内に kind === 'preStartState' 分岐
  assert.ok(/kind\s*===\s*['"]preStartState['"]/.test(RENDERER),
    'hall 受信ハンドラに kind === "preStartState" 分岐がない');
  // applyHallPreStartState 関数
  assert.ok(/function applyHallPreStartState\(/.test(RENDERER),
    'applyHallPreStartState 関数が見つからない');
  // hallPreStartState ローカル状態
  assert.ok(/const hallPreStartState\s*=\s*\{/.test(RENDERER),
    'hallPreStartState ローカル状態が見つからない');
  // hall rAF カウントダウン関数
  assert.ok(/function renderHallPreStartTick\(/.test(RENDERER),
    'renderHallPreStartTick rAF 関数が見つからない');
});

// ============================================================
// T10 (Fix 4): スライドショー活性化条件に PRE_START broadcast 連動
// ============================================================
test('T10 (Fix 4): isSlideshowEligibleStatus に hallPreStartState 連動', () => {
  const fnIdx = RENDERER.indexOf('function isSlideshowEligibleStatus');
  assert.ok(fnIdx >= 0, 'isSlideshowEligibleStatus 関数が見つからない');
  const fnEnd = RENDERER.indexOf('\n}', fnIdx);
  const body = RENDERER.slice(fnIdx, fnEnd + 2);
  assert.ok(/hallPreStartState\.isActive/.test(body),
    'isSlideshowEligibleStatus に hallPreStartState.isActive 連動がない');
  // hall role ガード（operator 側で hallPreStartState を見ても false のまま）
  assert.ok(/window\.appRole\s*===\s*['"]hall['"]/.test(body),
    'isSlideshowEligibleStatus に hall role ガードがない');
});

// ============================================================
// T11 (Fix 5 / B5 audit): kind === 'marqueeSettings' で value 内フィールド null guard
// ============================================================
test('T11 (Fix 5): hall 受信 marqueeSettings に value 内フィールド null guard', () => {
  // 該当分岐ブロックを抽出
  const blockIdx = RENDERER.indexOf("if (kind === 'marqueeSettings'");
  assert.ok(blockIdx >= 0, '"if (kind === marqueeSettings" 分岐が見つからない');
  const block = RENDERER.slice(blockIdx, blockIdx + 1000);
  // typeof value === 'object' チェック
  assert.ok(/typeof\s+value\s*===\s*['"]object['"]/.test(block),
    'marqueeSettings 分岐に typeof value === "object" ガードがない');
  // sanitized: enabled/text/speed の型 fall-back
  assert.ok(/sanitized/.test(block) || /enabled:\s*!!value/.test(block),
    'marqueeSettings の value 内フィールド sanitize がない');
});

// ============================================================
// T12 (保護): 致命バグ保護 5 件すべて維持
// ============================================================
test('T12 (保護): 致命バグ保護 5 件すべて維持', () => {
  // C.2.7-A resetBlindProgressOnly
  assert.ok(/function\s+resetBlindProgressOnly\s*\(/.test(RENDERER),
    'C.2.7-A resetBlindProgressOnly 関数定義が消失');
  // C.2.7-D timerState destructure 除外
  assert.ok(/tournaments:setDisplaySettings/.test(MAIN_JS),
    'C.2.7-D tournaments:setDisplaySettings ハンドラが消失');
  // C.1-A2 ensureEditorEditableState
  assert.ok(/function\s+ensureEditorEditableState\s*\(/.test(RENDERER),
    'C.1-A2 ensureEditorEditableState 関数定義が消失');
  // C.1.7 AudioContext resume（audio.js）
  const audio = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');
  assert.ok(/audioContext\.state\s*===\s*['"]suspended['"]/.test(audio),
    'C.1.7 AudioContext suspend 検出が audio.js から消失');
  // C.1.8 schedulePersistRuntime 8 箇所以上
  const calls = (RENDERER.match(/schedulePersistRuntime\s*\(\s*\)/g) || []).length;
  assert.ok(calls >= 8, `C.1.8 schedulePersistRuntime 呼出が ${calls} 件（期待 8 以上）`);
});

// ============================================================
// T13: package.json version + scripts.test 登録
// ============================================================
test('T13: package.json version 2.1.12 + scripts.test に v218 登録', () => {
  assert.equal(PKG.version, '2.1.18-rc2', `version が ${PKG.version}（期待 2.1.18-rc2）`);
  assert.ok(PKG.scripts.test.includes('v218-prestart-hall-sync.test.js'),
    'scripts.test に v218-prestart-hall-sync.test.js が登録されていない');
});

// ============================================================
// 結果サマリ
// ============================================================
console.log(`\nv218-prestart-hall-sync.test.js: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
