/**
 * v2.0.0 STEP 5 — HDMI 抜き差し追従 + AudioContext 再初期化対応 静的解析テスト
 *
 * 検証対象:
 *   - main.js に setupDisplayChangeListeners + display-added / display-removed 購読
 *   - display-removed: hallWindow.close + switchOperatorToSolo
 *   - display-added: displays.length < 2 早期 return + chooseHallDisplayInteractive 再呼出
 *   - switchOperatorToSolo / switchSoloToOperator がウィンドウ再生成方式（reload なし）
 *   - renderer.js の operator-solo 経路に ensureAudioReady 明示呼出
 *   - ポーリング不使用（setInterval で displays 監視なし）
 *   - _broadcastDualState の hall 不在 no-op ガードが維持されている
 *
 * 実行: node tests/v2-display-change.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT     = path.join(__dirname, '..');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

function extractFunctionBody(source, name, isAsync = false) {
  const prefix = isAsync ? 'async\\s+' : '';
  const re = new RegExp(`(?:${prefix})?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = source.match(re);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(start + 1, i); }
  }
  return null;
}

// ============================================================
// T1: setupDisplayChangeListeners が定義され、display-added / display-removed 両方を購読
// ============================================================
test('T1: setupDisplayChangeListeners + screen.on display-added/removed 両方', () => {
  assert.match(MAIN, /function\s+setupDisplayChangeListeners\s*\(/, 'setupDisplayChangeListeners 関数定義なし');
  const body = extractFunctionBody(MAIN, 'setupDisplayChangeListeners');
  assert.ok(body, 'setupDisplayChangeListeners 関数本体抽出失敗');
  assert.match(body, /screen\.on\(\s*['"]display-removed['"]/, 'screen.on("display-removed") なし');
  assert.match(body, /screen\.on\(\s*['"]display-added['"]/, 'screen.on("display-added") なし');
  // app.whenReady 内で setupDisplayChangeListeners を呼ぶ
  assert.match(MAIN, /setupDisplayChangeListeners\s*\(\s*\)/, 'setupDisplayChangeListeners 呼出なし');
});

// ============================================================
// T2: display-removed ハンドラで hallWindow.close + switchOperatorToSolo
// ============================================================
test('T2: display-removed ハンドラで hallWindow close + switchOperatorToSolo', () => {
  const body = extractFunctionBody(MAIN, 'setupDisplayChangeListeners');
  assert.ok(body, 'setupDisplayChangeListeners 抽出失敗');
  // display-removed ハンドラ部分を抽出
  const removedMatch = body.match(/screen\.on\(\s*['"]display-removed['"][\s\S]*?(?=screen\.on\(\s*['"]display-added['"]|$)/);
  assert.ok(removedMatch, 'display-removed ハンドラブロックが見つからない');
  const removed = removedMatch[0];
  assert.match(removed, /hallWindow\.close\s*\(\s*\)/, 'display-removed で hallWindow.close なし');
  assert.match(removed, /switchOperatorToSolo\s*\(/, 'display-removed で switchOperatorToSolo 呼出なし');
});

// ============================================================
// T3: display-added ハンドラで displays.length < 2 早期 return + chooseHallDisplayInteractive
// ============================================================
test('T3: display-added: displays.length < 2 で return, chooseHallDisplayInteractive 再呼出', () => {
  const body = extractFunctionBody(MAIN, 'setupDisplayChangeListeners');
  assert.ok(body, 'setupDisplayChangeListeners 抽出失敗');
  const addedMatch = body.match(/screen\.on\(\s*['"]display-added['"][\s\S]*$/);
  assert.ok(addedMatch, 'display-added ハンドラブロックが見つからない');
  const added = addedMatch[0];
  assert.match(added, /displays\.length\s*<\s*2[\s\S]*?return/, 'displays.length < 2 の早期 return なし');
  assert.match(added, /chooseHallDisplayInteractive\s*\(/, 'chooseHallDisplayInteractive 再呼出なし');
  assert.match(added, /switchSoloToOperator\s*\(/, 'switchSoloToOperator 呼出なし');
});

// ============================================================
// T4: switchOperatorToSolo / switchSoloToOperator がウィンドウ再生成方式（reload 不使用）
// ============================================================
test('T4: switchOperatorToSolo は show + focus / switchSoloToOperator は close→再生成（rc9 改修）', () => {
  // v2.0.4-rc9 Fix 2-A: switchOperatorToSolo は minimize → show + focus に変更（自動前面表示、IPC 遅延起因の表示消失を根治）
  //   close せず保持する設計は rc6 から維持（race ゼロ）。_showRestoreNoticeOnce は rc9 Fix 2-C で撤去。
  const solo = extractFunctionBody(MAIN, 'switchOperatorToSolo', true);
  assert.ok(solo, 'switchOperatorToSolo 関数本体抽出失敗');
  assert.match(solo, /mainWindow\.show\s*\(\s*\)/, 'switchOperatorToSolo で mainWindow.show なし（rc9 で show 化必須）');
  assert.doesNotMatch(solo, /mainWindow\.minimize\s*\(\s*\)/, 'switchOperatorToSolo に mainWindow.minimize 残存（rc9 で撤去必須）');
  assert.doesNotMatch(solo, /_showRestoreNoticeOnce\s*=\s*true/, 'switchOperatorToSolo に _showRestoreNoticeOnce フラグ残存（rc9 で撤去必須）');
  assert.doesNotMatch(solo, /webContents\.reload\s*\(/, 'switchOperatorToSolo に reload 使用（再生成方式違反）');

  // switchSoloToOperator は依然 close→再生成（role='operator-solo' → 'operator' 変更が必要）
  const dual = extractFunctionBody(MAIN, 'switchSoloToOperator', true);
  assert.ok(dual, 'switchSoloToOperator 関数本体抽出失敗');
  assert.match(dual, /mainWindow\.close\s*\(\s*\)/, 'switchSoloToOperator で mainWindow.close なし');
  assert.match(dual, /createOperatorWindow\([^)]*,\s*false\s*\)/, 'createOperatorWindow(_, false) 再生成なし');
  assert.match(dual, /createHallWindow\s*\(/, 'createHallWindow 呼出なし');
  assert.doesNotMatch(dual, /webContents\.reload\s*\(/, 'switchSoloToOperator に reload 使用（再生成方式違反）');
});

// ============================================================
// T6: renderer.js の operator-solo 経路に ensureAudioReady 明示呼出（HDMI 抜き直後の音欠落対策）
// ============================================================
test('T6: renderer.js operator-solo 経路で ensureAudioReady を明示呼出', () => {
  // operator-solo 分岐の else ブロックに ensureAudioReady() が存在
  // 簡易検出: __appRole === 'operator-solo' or その else 分岐内の initialize() の近傍に ensureAudioReady
  // operator-solo は文字列リテラルとして登場、その後 ensureAudioReady() を含むこと
  const operatorSoloSection = RENDERER.match(/['"]operator-solo['"][\s\S]*?\}\s*$/);
  // operator-solo 後の領域で ensureAudioReady 呼出があること（else 分岐相当）
  // より正確に: __appRole 分岐の else 部分を抽出
  const branchMatch = RENDERER.match(/__appRole\s*===\s*['"]operator['"][\s\S]*?\}\s*else\s*\{([\s\S]*?)\}\s*$/m);
  assert.ok(branchMatch, '__appRole 3 分岐の else (operator-solo) ブロックが抽出できない');
  const elseBlock = branchMatch[1];
  assert.match(elseBlock, /initialize\s*\(\s*\)/, 'operator-solo の else 分岐に initialize() なし');
  assert.match(elseBlock, /ensureAudioReady\s*\(\s*\)/, 'operator-solo の else 分岐に ensureAudioReady() 明示呼出なし');
});

// ============================================================
// T7: ポーリング不使用（setInterval で displays を定期取得するコードがない）
// ============================================================
test('T7: setInterval で displays をポーリングしていない（イベント駆動のみ）', () => {
  // setInterval の中で screen.getAllDisplays / hallWindow / mainWindow を扱うパターンがないこと
  // シンプルに: setupDisplayChangeListeners 関数内に setInterval が存在しないこと
  const body = extractFunctionBody(MAIN, 'setupDisplayChangeListeners');
  assert.ok(body, 'setupDisplayChangeListeners 抽出失敗');
  assert.doesNotMatch(body, /setInterval\s*\(/, 'setupDisplayChangeListeners 内に setInterval（ポーリング違反）');
});

// ============================================================
// T8: _broadcastDualState の hall 不在 no-op ガードが維持されている（STEP 2 実装を破壊していない）
// ============================================================
test('T8: _broadcastDualState の hall 不在 no-op ガード維持', () => {
  const body = extractFunctionBody(MAIN, '_broadcastDualState');
  assert.ok(body, '_broadcastDualState 関数本体抽出失敗');
  // hall window 不在 / destroyed なら早期 return
  assert.match(body, /!hallWindow\s*\|\|\s*hallWindow\.isDestroyed\(\)/, 'hall 不在 no-op ガードが消えている');
  assert.match(body, /return/, '早期 return なし');
});

// ============================================================
console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
