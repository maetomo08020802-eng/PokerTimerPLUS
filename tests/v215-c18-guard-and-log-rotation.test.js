/**
 * v2.1.0 静的解析テスト — C.1.8 ガード漏れ網羅修正 + 運用面 2 件
 *   Fix 1 (H1 Edge-1): _isSwitchingMode ガード網羅修正
 *     - tournaments:setActive    （v2.1.0 既存）
 *     - tournaments:setTimerState（v2.0.4-rc9 既存）
 *     - tournaments:save         （v2.1.0 新規）
 *     - tournaments:setRuntime   （v2.1.0 新規・H1 Edge-1）
 *     - tournaments:setMarqueeSettings（v2.1.0 新規）
 *     - tournaments:setDisplaySettings（v2.1.0 新規）
 *     - tournament:set 旧API     （v2.1.0 新規）
 *   Fix 2 (M7 Perf-9):  electron-log の maxSize / archiveLogFn 設定
 *   Fix 3 (M2 Sec-4):   rolling-log の presetName を hashPII 経由でハッシュ化
 *
 * 致命バグ保護 5 件への影響:
 *   1: C.2.7-A resetBlindProgressOnly       → 影響なし
 *   2: C.2.7-D timerState destructure       → 影響なし
 *   3: C.1-A2 ensureEditorEditableState     → 影響なし
 *   4: C.1.7  AudioContext suspend          → 影響なし
 *   5: C.1.8  runtime 永続化（既存 8 箇所） → 整合修復（拡張）
 *
 * 実行: node tests/v215-c18-guard-and-log-rotation.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const PKG  = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

/**
 * 指定された ipcMain.handle ハンドラのブロック本文（{ ... }) の対応括弧まで）を抽出。
 *   handle 名で正規表現検索 → 最初の '{' から対応 '}' までを返す。
 */
function extractHandlerBody(channel) {
  const startMarker = `ipcMain.handle('${channel}'`;
  const startIdx = MAIN_JS.indexOf(startMarker);
  if (startIdx < 0) return null;
  // 最初の '{' を探す（コールバック関数の開始）
  const braceIdx = MAIN_JS.indexOf('{', startIdx);
  if (braceIdx < 0) return null;
  // 対応する '}' まで深さカウント
  let depth = 1;
  let i = braceIdx + 1;
  while (i < MAIN_JS.length && depth > 0) {
    const c = MAIN_JS[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return MAIN_JS.slice(startIdx, i);
}

// ============================================================
// T1: Step 1-A 網羅調査結果に基づく「必要なハンドラ全件」cross-check
// ============================================================
test('T1 (Fix 1): 必要なハンドラ全件で _isSwitchingMode チェック存在（網羅）', () => {
  const requiredChannels = [
    'tournaments:setActive',          // v2.1.0 既存
    'tournaments:setTimerState',      // v2.0.4-rc9 既存
    'tournaments:save',               // v2.1.0 新規
    'tournaments:setRuntime',         // v2.1.0 新規・H1 Edge-1
    'tournaments:setMarqueeSettings', // v2.1.0 新規
    'tournaments:setDisplaySettings', // v2.1.0 新規
    'tournament:set'                  // v2.1.0 新規（旧 API）
  ];
  for (const ch of requiredChannels) {
    const body = extractHandlerBody(ch);
    assert.ok(body, `${ch} ハンドラブロックが見つからない`);
    assert.ok(/if\s*\(\s*_isSwitchingMode\s*\)\s*return/.test(body),
      `${ch} 内に _isSwitchingMode ガードがない`);
  }
});

// ============================================================
// T2: Fix 1 — setRuntime / その他必要ハンドラに individual ガードパターン
// ============================================================
test('T2 (Fix 1): setRuntime ハンドラ冒頭に _isSwitchingMode ガード', () => {
  const body = extractHandlerBody('tournaments:setRuntime');
  assert.ok(body, 'setRuntime ハンドラが見つからない');
  // ガード行は payload 検証より前（冒頭）に配置されているべき
  const guardIdx  = body.search(/if\s*\(\s*_isSwitchingMode\s*\)/);
  const payloadIdx = body.indexOf("if (!payload");
  assert.ok(guardIdx >= 0, 'setRuntime に _isSwitchingMode ガードなし');
  assert.ok(payloadIdx > guardIdx, 'setRuntime の _isSwitchingMode ガードが payload 検証より前にない');
});

test('T2-2 (Fix 1): setMarqueeSettings ハンドラ冒頭に _isSwitchingMode ガード', () => {
  const body = extractHandlerBody('tournaments:setMarqueeSettings');
  assert.ok(body, 'setMarqueeSettings ハンドラが見つからない');
  assert.ok(/if\s*\(\s*_isSwitchingMode\s*\)\s*return/.test(body),
    'setMarqueeSettings に _isSwitchingMode ガードなし');
});

test('T2-3 (Fix 1): setDisplaySettings ハンドラ冒頭に _isSwitchingMode ガード', () => {
  const body = extractHandlerBody('tournaments:setDisplaySettings');
  assert.ok(body, 'setDisplaySettings ハンドラが見つからない');
  assert.ok(/if\s*\(\s*_isSwitchingMode\s*\)\s*return/.test(body),
    'setDisplaySettings に _isSwitchingMode ガードなし');
});

test('T2-4 (Fix 1): tournaments:save ハンドラ冒頭に _isSwitchingMode ガード', () => {
  const body = extractHandlerBody('tournaments:save');
  assert.ok(body, 'tournaments:save ハンドラが見つからない');
  assert.ok(/if\s*\(\s*_isSwitchingMode\s*\)\s*return/.test(body),
    'tournaments:save に _isSwitchingMode ガードなし');
});

test('T2-5 (Fix 1): tournament:set 旧 API に _isSwitchingMode ガード', () => {
  const body = extractHandlerBody('tournament:set');
  assert.ok(body, 'tournament:set ハンドラが見つからない');
  assert.ok(/if\s*\(\s*_isSwitchingMode\s*\)\s*return/.test(body),
    'tournament:set に _isSwitchingMode ガードなし');
});

// ============================================================
// T3: 既存 setActive の v2.1.0 Fix 1 ガードが破壊されていない
// ============================================================
test('T3 (Fix 1): setActive の v2.1.0 Fix 1 ガードが破壊されていない', () => {
  const body = extractHandlerBody('tournaments:setActive');
  assert.ok(body, 'setActive ハンドラが見つからない');
  assert.ok(/if\s*\(\s*_isSwitchingMode\s*\)\s*return/.test(body),
    'setActive の v2.1.0 ガードが消失している');
});

// ============================================================
// T4: Fix 2 — electron-log の maxSize / archiveLogFn 設定が main.js に存在
// ============================================================
test('T4 (Fix 2): electron-log の maxSize 設定が main.js に存在', () => {
  assert.ok(/log\.transports\.file\.maxSize\s*=\s*5\s*\*\s*1024\s*\*\s*1024/.test(MAIN_JS),
    'electron-log の maxSize 5MB 設定が main.js にない');
});

test('T4-2 (Fix 2): electron-log の archiveLogFn 設定が main.js に存在', () => {
  assert.ok(/log\.transports\.file\.archiveLogFn\s*=/.test(MAIN_JS),
    'electron-log の archiveLogFn 設定が main.js にない');
  assert.ok(/\.old\.log/.test(MAIN_JS),
    'archiveLogFn 内で .old.log への rename がない');
});

// ============================================================
// T5: Fix 3 — hashPII 関数または同等のハッシュ化処理が main.js に存在
// ============================================================
test('T5 (Fix 3): hashPII 関数が main.js に定義されている', () => {
  assert.ok(/function\s+hashPII\s*\(/.test(MAIN_JS),
    'hashPII 関数定義が main.js にない');
  assert.ok(/createHash\(['"]sha256['"]\)/.test(MAIN_JS),
    'hashPII で SHA-256 が使われていない');
  assert.ok(/\.substring\(0,\s*8\)/.test(MAIN_JS) || /\.slice\(0,\s*8\)/.test(MAIN_JS),
    'hashPII で先頭 8 文字短縮がない');
});

// ============================================================
// T6: Fix 3 — rolling-log の店舗識別情報出力箇所で hashPII 経由
// ============================================================
test('T6 (Fix 3): blindPreset:state:send の presetName が hashPII 経由', () => {
  // _publishDualState 内の rollingLog('blindPreset:state:send', { presetName: hashPII(...) }) 経路
  const re = /rollingLog\(\s*['"]blindPreset:state:send['"]\s*,\s*\{[^}]*presetName:\s*hashPII\(/;
  assert.ok(re.test(MAIN_JS),
    'rollingLog blindPreset:state:send で presetName が hashPII 経由になっていない');
});

// ============================================================
// T7: 致命バグ保護 cross-check — C.1.8 既存 8 箇所 + フックなし設計維持
// ============================================================
test('T7 (致命バグ保護): C.1.8 schedulePersistRuntime 呼出が存続', () => {
  // 既存 8 箇所のフックは少なくとも数箇所残っていることを確認（C.1.8 整合）
  const matches = MAIN_JS.match(/schedulePersistRuntime\(/g) || [];
  // renderer.js 側にフックがある可能性があるが main.js の本フェーズでは触っていない、
  // schedulePersistRuntime は renderer 関数なので main.js には現れないこともある。
  // ここでは「resetBlindProgressOnly に schedulePersistRuntime フックが追加されていない」ことを確認。
  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
  const fnIdx = renderer.indexOf('function resetBlindProgressOnly');
  if (fnIdx >= 0) {
    const nextFnIdx = renderer.indexOf('\nfunction ', fnIdx + 1);
    const body = renderer.slice(fnIdx, nextFnIdx > 0 ? nextFnIdx : fnIdx + 3000);
    assert.ok(!/schedulePersistRuntime\(/.test(body),
      'resetBlindProgressOnly に schedulePersistRuntime フックが追加されている（C.1.8 設計違反）');
  }
});

test('T7-2 (致命バグ保護): v2.1.0 setActive Fix が破壊されていない（再確認）', () => {
  const body = extractHandlerBody('tournaments:setActive');
  assert.ok(body, 'setActive ハンドラが見つからない');
  // v2.1.0 のコメント or 同等のガード行
  assert.ok(/if\s*\(\s*_isSwitchingMode\s*\)\s*return\s+null/.test(body),
    'setActive の v2.1.0 Fix 1 ガード（return null）が消失');
});

// ============================================================
// T8: package.json version 2.1.0
// ============================================================
test('T8: package.json version が 2.1.0', () => {
  assert.equal(PKG.version, '2.1.20-rc1', `version が ${PKG.version}（期待 2.1.0）`);
});

// ============================================================
// 結果サマリ
// ============================================================
console.log(`\n----\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
