/**
 * v2.0.0 STEP 2 — 2 画面間の状態同期（最小実装）静的解析テスト
 *
 * 検証対象:
 *   - main.js の _dualStateCache / _broadcastDualState / _publishDualState 定義
 *   - main.js の dual:state-sync-init ハンドラ登録（dual:operator-action は v2.0.2 で削除）
 *   - main.js の主要 IPC ハンドラ末尾に _publishDualState 呼出が追加されている
 *   - preload.js の window.api.dual.* （subscribeStateSync / fetchInitialState、v2.0.2 で notifyOperatorAction 削除）
 *   - dual-sync.js の initDualSyncForHall エクスポート + role ガード + イベント駆動購読
 *   - renderer.js の role 3 分岐（hall / operator / operator-solo）
 *   - 致命バグ保護 C.2.7-D（timerState destructure 除外）の payload 構造に変更がない
 *
 * 実行: node tests/v2-dual-sync.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT      = path.join(__dirname, '..');
const MAIN      = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD   = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const DUAL_SYNC = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');
const RENDERER  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ============================================================
// T1: main.js に _dualStateCache + _broadcastDualState + _publishDualState が定義されている
// ============================================================
test('T1: main.js に _dualStateCache / _broadcastDualState / _publishDualState 定義', () => {
  assert.match(MAIN, /const\s+_dualStateCache\s*=\s*\{/, '_dualStateCache 定数定義なし');
  assert.match(MAIN, /timerState:\s*null/, '_dualStateCache.timerState フィールドなし');
  assert.match(MAIN, /displaySettings:\s*null/, '_dualStateCache.displaySettings フィールドなし');
  assert.match(MAIN, /tournamentRuntime:\s*null/, '_dualStateCache.tournamentRuntime フィールドなし');
  assert.match(MAIN, /function\s+_broadcastDualState\s*\(/, '_broadcastDualState 関数定義なし');
  assert.match(MAIN, /function\s+_publishDualState\s*\(/, '_publishDualState 関数定義なし');
  // hall window 不在時は no-op（operator-solo 後方互換の根拠）
  assert.match(MAIN, /if\s*\(\s*!hallWindow\s*\|\|\s*hallWindow\.isDestroyed\(\)\s*\)\s*return/, 'hall 不在時の no-op ガードなし');
});

// ============================================================
// T2: main.js に dual:state-sync-init ハンドラが登録されている
// ============================================================
test('T2: main.js に dual:state-sync-init ハンドラ登録', () => {
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]dual:state-sync-init['"]/, 'dual:state-sync-init ハンドラ登録なし');
  // 初期同期 hander は cache snapshot を返す
  assert.match(MAIN, /\.\.\._dualStateCache/, 'dual:state-sync-init で _dualStateCache 展開なし');
});

// ============================================================
// T3: v2.0.2 cleanup — dual:operator-action ハンドラ + _DUAL_ACTION_ROUTE が削除されている
//     （元々 validate して payloadShape を返すだけのデッドコード）
// ============================================================
test('T3: dual:operator-action ハンドラ + _DUAL_ACTION_ROUTE が削除されている（v2.0.2 cleanup）', () => {
  assert.doesNotMatch(MAIN, /ipcMain\.handle\(\s*['"]dual:operator-action['"]/,
    'dual:operator-action ハンドラが残存（v2.0.2 で撤去予定）');
  assert.doesNotMatch(MAIN, /const\s+_DUAL_ACTION_ROUTE\s*=/,
    '_DUAL_ACTION_ROUTE 定義が残存（v2.0.2 で撤去予定）');
});

// ============================================================
// T4: 主要 IPC ハンドラ末尾に _publishDualState 呼出が追加されている
// ============================================================
test('T4: tournaments:setTimerState / setRuntime / setDisplaySettings / setMarqueeSettings に publish 呼出', () => {
  // setTimerState: timerState を publish
  assert.match(MAIN, /tournaments:setTimerState[\s\S]*?_publishDualState\(\s*['"]timerState['"]/,
    'tournaments:setTimerState 末尾に _publishDualState("timerState") なし');
  // setRuntime: tournamentRuntime を publish
  assert.match(MAIN, /tournaments:setRuntime[\s\S]*?_publishDualState\(\s*['"]tournamentRuntime['"]/,
    'tournaments:setRuntime 末尾に _publishDualState("tournamentRuntime") なし');
  // setDisplaySettings: displaySettings を publish
  assert.match(MAIN, /tournaments:setDisplaySettings[\s\S]*?_publishDualState\(\s*['"]displaySettings['"]/,
    'tournaments:setDisplaySettings 末尾に _publishDualState("displaySettings") なし');
  // setMarqueeSettings: marqueeSettings を publish
  assert.match(MAIN, /tournaments:setMarqueeSettings[\s\S]*?_publishDualState\(\s*['"]marqueeSettings['"]/,
    'tournaments:setMarqueeSettings 末尾に _publishDualState("marqueeSettings") なし');
});

// ============================================================
// T5: preload.js に window.api.dual.* が公開されている（notifyOperatorAction は v2.0.2 で削除）
// ============================================================
test('T5: preload.js に dual.subscribeStateSync / fetchInitialState（notifyOperatorAction は撤去）', () => {
  assert.match(PRELOAD, /dual:\s*\{/, 'preload.js に dual: { ... } グループなし');
  assert.match(PRELOAD, /subscribeStateSync:\s*\(/, 'subscribeStateSync 公開なし');
  assert.match(PRELOAD, /fetchInitialState:\s*\(/, 'fetchInitialState 公開なし');
  // v2.0.2 cleanup: notifyOperatorAction は撤去済（dual:operator-action がデッドコード）
  assert.doesNotMatch(PRELOAD, /notifyOperatorAction:\s*\(/,
    'notifyOperatorAction が残存（v2.0.2 で撤去予定）');
  // ipcRenderer.on で dual:state-sync を listen（イベント駆動、ポーリング禁止）
  assert.match(PRELOAD, /ipcRenderer\.on\(\s*['"]dual:state-sync['"]/, 'dual:state-sync を ipcRenderer.on で listen していない');
  assert.match(PRELOAD, /ipcRenderer\.invoke\(\s*['"]dual:state-sync-init['"]/, 'dual:state-sync-init invoke なし');
});

// ============================================================
// T6: dual-sync.js に initDualSyncForHall がエクスポートされ、role ガードがある
// ============================================================
test('T6: dual-sync.js: initDualSyncForHall export + role==="hall" ガード + ポーリングなし', () => {
  assert.match(DUAL_SYNC, /export\s+async\s+function\s+initDualSyncForHall\s*\(/, 'initDualSyncForHall export なし');
  // role 安全側ガード（hall 以外で動かない）
  assert.match(DUAL_SYNC, /window\.appRole\s*!==\s*['"]hall['"]/, 'window.appRole !== "hall" ガードなし');
  // 初期同期: fetchInitialState を 1 回だけ呼ぶ
  assert.match(DUAL_SYNC, /dual\.fetchInitialState\s*\(\s*\)/, 'fetchInitialState 呼出なし');
  // 差分購読: subscribeStateSync を呼ぶ
  assert.match(DUAL_SYNC, /dual\.subscribeStateSync\s*\(/, 'subscribeStateSync 呼出なし');
  // ポーリング禁止の確認: setInterval / setTimeout の繰り返し呼出がない
  assert.doesNotMatch(DUAL_SYNC, /setInterval\s*\(/, 'dual-sync.js に setInterval（ポーリング）が存在する');
});

// ============================================================
// T7: renderer.js が role === 'hall' / 'operator' / 'operator-solo' の 3 分岐を持つ
// ============================================================
test('T7: renderer.js に role 3 分岐 + initDualSyncForHall import', () => {
  // import — v2.0.1 stabilization: registerDualDiffHandler 等の追加 import に対応するため正規表現を緩和
  //   旧: /\{\s*initDualSyncForHall\s*\}/  （完全一致のみマッチ）
  //   新: /\{[^}]*initDualSyncForHall[^}]*\}/ （複数 import 可）
  assert.match(RENDERER, /import\s+\{[^}]*initDualSyncForHall[^}]*\}\s+from\s+['"]\.\/dual-sync\.js['"]/,
    'initDualSyncForHall の import なし');
  // 3 分岐のうち 'hall' / 'operator' / 'operator-solo' すべてが文字列リテラルとして登場
  assert.match(RENDERER, /['"]hall['"]/, "'hall' リテラルなし");
  assert.match(RENDERER, /['"]operator['"]/, "'operator' リテラルなし");
  assert.match(RENDERER, /['"]operator-solo['"]/, "'operator-solo' リテラルなし");
  // hall 経路で initDualSyncForHall が呼ばれる
  assert.match(RENDERER, /initDualSyncForHall\s*\(/, 'renderer.js から initDualSyncForHall が呼ばれていない');
});

// ============================================================
// T8: 致命バグ保護 C.2.7-D（timerState destructure 除外）の payload 構造が維持されている
// ============================================================
test('T8: tournaments:setDisplaySettings は { id, displaySettings } のまま、timerState を含まない', () => {
  // setDisplaySettings の payload destructure 行に timerState が混入していないこと
  const m = MAIN.match(/ipcMain\.handle\(\s*['"]tournaments:setDisplaySettings['"][\s\S]*?const\s*\{\s*([^}]*)\s*\}\s*=\s*payload/);
  assert.ok(m, 'tournaments:setDisplaySettings の payload destructure 行が見つからない');
  const destructured = m[1];
  assert.doesNotMatch(destructured, /timerState/,
    'tournaments:setDisplaySettings の payload destructure に timerState が混入している（C.2.7-D Fix 3 違反）');
  assert.match(destructured, /id/, 'id destructure なし');
  assert.match(destructured, /displaySettings/, 'displaySettings destructure なし');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
