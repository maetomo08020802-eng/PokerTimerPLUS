/**
 * v2.0.4-rc18 第 1 弾 — in-memory ring buffer 化 + 観測ラベル 4 個追加 の静的解析テスト
 *
 * 対象修正:
 *   タスク 3: ログ機構刷新（in-memory ring buffer 化）
 *             - fire-and-forget appendFile を廃止 → buffer push + 30s 定期 flush + writeFile 全体上書き
 *             - I/O 順序乱れによる ts と書込順序の不一致を根絶（rc17 計測精度問題への構造的解決）
 *             - 上限 5,000 件、超過時 shift() で古いエントリ削除
 *             - flush タイミング: 30s 定期 / app:before-quit / logs:openFolder ハンドラ先頭
 *
 *   タスク 4: 観測ラベル 4 個追加（配布版常時記録）
 *             #1 runtime:state:send         — main.js _publishDualState で kind==='tournamentRuntime'
 *             #2 blindPreset:state:send     — main.js _publishDualState で kind==='tournamentBasics'
 *             #3 runtime:state:recv:hall    — dual-sync.js _applyDiffToState で kind==='tournamentRuntime'
 *             #4 blindPreset:state:recv:hall — dual-sync.js _applyDiffToState で kind==='tournamentBasics'
 *
 * すべて try { ... } catch (_) {} で wrap、never throw from logging。
 * 致命バグ保護 5 件（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）への影響なしも cross-check。
 *
 * 実行: node tests/v204-rc18-ring-buffer-and-labels.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT      = path.join(__dirname, '..');
const MAIN      = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const DUAL_SYNC = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');
const RENDERER  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const AUDIO     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

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
// タスク 3: ring buffer 化
// ============================================================

test('T6: main.js に _rollingLogBuffer 配列定義が存在', () => {
  assert.match(MAIN, /let\s+_rollingLogBuffer\s*=\s*\[\s*\]/,
    'main.js に let _rollingLogBuffer = [] の宣言が見つからない（rc18 タスク 3 不在）');
});

test('T7: ROLLING_LOG_BUFFER_MAX 定数が定義され値は 5000', () => {
  assert.match(MAIN, /const\s+ROLLING_LOG_BUFFER_MAX\s*=\s*5000\b/,
    'ROLLING_LOG_BUFFER_MAX = 5000 の宣言が見つからない');
});

test('T8: rollingLog 関数内で _rollingLogBuffer.push + 上限超過時 shift の経路が存在', () => {
  const body = extractFunctionBody(MAIN, /function\s+rollingLog\s*\(\s*label\s*,\s*data\s*\)\s*\{/);
  assert.ok(body, 'rollingLog 関数本体が見つからない');
  assert.match(body, /_rollingLogBuffer\.push\s*\(/,
    'rollingLog 内で _rollingLogBuffer.push 呼出が見つからない');
  assert.match(body, /_rollingLogBuffer\.length\s*>\s*ROLLING_LOG_BUFFER_MAX[\s\S]*?_rollingLogBuffer\.shift\s*\(/,
    'rollingLog 内で 上限超過時 shift() の経路が見つからない');
});

test('T9: _flushRollingLog 関数定義 + app:before-quit + logs:openFolder の各経路から呼出', () => {
  // 関数定義（async）
  assert.match(MAIN, /async\s+function\s+_flushRollingLog\s*\(\s*\)\s*\{/,
    '_flushRollingLog 関数定義が見つからない');
  // 関数本体で fs.promises.writeFile を使用
  const body = extractFunctionBody(MAIN, /async\s+function\s+_flushRollingLog\s*\(\s*\)\s*\{/);
  assert.ok(body, '_flushRollingLog 本体が見つからない');
  assert.match(body, /fs\.promises\.writeFile/,
    '_flushRollingLog 内で fs.promises.writeFile が使われていない（appendFile から writeFile への移行が完了していない）');
  // app:will-quit ハンドラから _flushRollingLog 呼出
  const willQuit = MAIN.match(/app\.on\(\s*['"]will-quit['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(willQuit, 'app.on("will-quit", ...) ハンドラが見つからない');
  assert.match(willQuit[0], /_flushRollingLog\s*\(/,
    'app.on("will-quit") ハンドラ内で _flushRollingLog が呼ばれていない');
  // logs:openFolder ハンドラ内で await _flushRollingLog
  const openFolder = MAIN.match(/ipcMain\.handle\(\s*['"]logs:openFolder['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(openFolder, 'logs:openFolder ハンドラが見つからない');
  assert.match(openFolder[0], /await\s+_flushRollingLog\s*\(/,
    'logs:openFolder ハンドラ内で await _flushRollingLog 呼出が見つからない');
});

// ============================================================
// タスク 4: 観測ラベル 4 個
// ============================================================

test('T10: main.js _publishDualState 内に runtime:state:send ラベル + tournamentRuntime ガード + try/catch', () => {
  const body = extractFunctionBody(MAIN, /function\s+_publishDualState\s*\([^)]*\)\s*\{/);
  assert.ok(body, '_publishDualState 関数本体が見つからない');
  assert.match(body, /'runtime:state:send'/,
    '_publishDualState 内に runtime:state:send ラベルが見つからない');
  // kind === 'tournamentRuntime' ガードのすぐ後で rollingLog 呼出
  const re = /if\s*\(\s*kind\s*===\s*['"]tournamentRuntime['"]\s*\)\s*\{[\s\S]*?try\s*\{[\s\S]*?rollingLog\(\s*['"]runtime:state:send['"]/;
  assert.match(body, re,
    'kind === "tournamentRuntime" ガード経路で try { rollingLog("runtime:state:send", ...) } の構造が見つからない');
  // catch (_) wrap の存在
  const idx = body.indexOf("'runtime:state:send'");
  const after = body.slice(idx, Math.min(body.length, idx + 300));
  assert.match(after, /catch\s*\(/,
    "runtime:state:send 直後に catch ( が見つからない（never throw 違反）");
});

test('T11: main.js _publishDualState 内に blindPreset:state:send ラベル + tournamentBasics ガード + try/catch', () => {
  const body = extractFunctionBody(MAIN, /function\s+_publishDualState\s*\([^)]*\)\s*\{/);
  assert.ok(body, '_publishDualState 関数本体が見つからない');
  assert.match(body, /'blindPreset:state:send'/,
    '_publishDualState 内に blindPreset:state:send ラベルが見つからない');
  const re = /if\s*\(\s*kind\s*===\s*['"]tournamentBasics['"]\s*\)\s*\{[\s\S]*?try\s*\{[\s\S]*?rollingLog\(\s*['"]blindPreset:state:send['"]/;
  assert.match(body, re,
    'kind === "tournamentBasics" ガード経路で try { rollingLog("blindPreset:state:send", ...) } の構造が見つからない');
  const idx = body.indexOf("'blindPreset:state:send'");
  const after = body.slice(idx, Math.min(body.length, idx + 300));
  assert.match(after, /catch\s*\(/,
    "blindPreset:state:send 直後に catch ( が見つからない（never throw 違反）");
});

test('T12: dual-sync.js _applyDiffToState 内に runtime:state:recv:hall ラベル + tournamentRuntime ガード + try/catch', () => {
  const body = extractFunctionBody(DUAL_SYNC, /function\s+_applyDiffToState\s*\([^)]*\)\s*\{/);
  assert.ok(body, '_applyDiffToState 関数本体が見つからない');
  assert.match(body, /'runtime:state:recv:hall'/,
    '_applyDiffToState 内に runtime:state:recv:hall ラベルが見つからない');
  const re = /if\s*\(\s*kind\s*===\s*['"]tournamentRuntime['"]\s*\)\s*\{[\s\S]*?try\s*\{[\s\S]*?window\.api\?\.log\?\.write\?\.\(\s*['"]runtime:state:recv:hall['"]/;
  assert.match(body, re,
    'kind === "tournamentRuntime" ガード経路で window.api.log.write("runtime:state:recv:hall", ...) が呼ばれていない');
  const idx = body.indexOf("'runtime:state:recv:hall'");
  const after = body.slice(idx, Math.min(body.length, idx + 300));
  assert.match(after, /catch\s*\(/,
    "runtime:state:recv:hall 直後に catch ( が見つからない（never throw 違反）");
});

test('T13: dual-sync.js _applyDiffToState 内に blindPreset:state:recv:hall ラベル + tournamentBasics ガード + try/catch', () => {
  const body = extractFunctionBody(DUAL_SYNC, /function\s+_applyDiffToState\s*\([^)]*\)\s*\{/);
  assert.ok(body, '_applyDiffToState 関数本体が見つからない');
  assert.match(body, /'blindPreset:state:recv:hall'/,
    '_applyDiffToState 内に blindPreset:state:recv:hall ラベルが見つからない');
  const re = /if\s*\(\s*kind\s*===\s*['"]tournamentBasics['"]\s*\)\s*\{[\s\S]*?try\s*\{[\s\S]*?window\.api\?\.log\?\.write\?\.\(\s*['"]blindPreset:state:recv:hall['"]/;
  assert.match(body, re,
    'kind === "tournamentBasics" ガード経路で window.api.log.write("blindPreset:state:recv:hall", ...) が呼ばれていない');
  const idx = body.indexOf("'blindPreset:state:recv:hall'");
  const after = body.slice(idx, Math.min(body.length, idx + 300));
  assert.match(after, /catch\s*\(/,
    "blindPreset:state:recv:hall 直後に catch ( が見つからない（never throw 違反）");
});

// ============================================================
// 致命バグ保護 5 件 cross-check（rc18 で影響なしを担保）
// ============================================================

test('致命バグ保護 C.2.7-A: resetBlindProgressOnly が renderer.js に存在', () => {
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'resetBlindProgressOnly が消失（C.2.7-A 破壊）');
});

test('致命バグ保護 C.2.7-D: setDisplaySettings の timerState destructure 除外維持', () => {
  const m = MAIN.match(/ipcMain\.handle\(\s*['"]tournaments:setDisplaySettings['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m);
  assert.doesNotMatch(m[0], /const\s*\{[^}]*\btimerState\b[^}]*\}\s*=/,
    'setDisplaySettings で timerState destructure が混入（C.2.7-D 致命バグ再発）');
});

test('致命バグ保護 C.1-A2: ensureEditorEditableState 関数定義が維持', () => {
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'ensureEditorEditableState が消失（C.1-A2 破壊）');
});

test('致命バグ保護 C.1.7: AudioContext suspend resume 経路が維持', () => {
  assert.match(AUDIO, /audioContext\.state\s*===?\s*['"]suspended['"]/,
    'audio.js から audioContext.state suspended 検出が消失（C.1.7 破壊）');
  assert.match(AUDIO, /audioContext\.resume\(\)/,
    'audio.js から audioContext.resume() 呼出が消失（C.1.7 破壊）');
});

test('致命バグ保護 C.1.8: tournaments:setRuntime IPC が維持', () => {
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]tournaments:setRuntime['"]/,
    'tournaments:setRuntime ハンドラが消失（C.1.8 破壊）');
});

// ============================================================
// rc15 / rc17 機構維持（rc18 で破壊しない）
// ============================================================

test('rc15 維持: rollingLog 関数定義 + _initRollingLog ヘルパが存在', () => {
  assert.match(MAIN, /function\s+rollingLog\s*\(\s*label\s*,\s*data\s*\)/,
    'rollingLog 関数定義が消失');
  assert.match(MAIN, /function\s+_initRollingLog\s*\(/,
    '_initRollingLog ヘルパが消失');
});

test('rc15 維持: 5 分保持 + 30 秒切捨間隔 定数が維持', () => {
  assert.match(MAIN, /ROLLING_LOG_RETENTION_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/,
    '5 分保持期間定数が消失');
  assert.match(MAIN, /ROLLING_LOG_TRUNCATE_INTERVAL_MS\s*=\s*30\s*\*\s*1000/,
    '30 秒切捨間隔定数が消失');
});

test('rc17 維持: timer:state:send / timer:state:recv:hall ラベル維持', () => {
  assert.match(MAIN, /'timer:state:send'/,
    'timer:state:send ラベルが消失（rc17 機構破壊）');
  assert.match(DUAL_SYNC, /'timer:state:recv:hall'/,
    'timer:state:recv:hall ラベルが消失（rc17 機構破壊）');
});

// ============================================================
// rc18 で削除されるべきもの（doesNotMatch で確認）
// ============================================================

test('rc18 削除確認: _truncateRollingLog 関数定義は削除済', () => {
  assert.doesNotMatch(MAIN, /async\s+function\s+_truncateRollingLog\s*\(/,
    '_truncateRollingLog 関数定義が残存（rc18 で _flushRollingLog に置換すべき）');
});

test('rc18 削除確認: rollingLog 関数本体に fs.promises.appendFile は使われていない', () => {
  const body = extractFunctionBody(MAIN, /function\s+rollingLog\s*\(\s*label\s*,\s*data\s*\)\s*\{/);
  assert.ok(body);
  assert.doesNotMatch(body, /fs\.promises\.appendFile/,
    'rollingLog 関数本体に fs.promises.appendFile が残存（rc18 で ring buffer 化すべき）');
});

test('rc18 削除確認: main.js 全体で fs.promises.appendFile が使われていない（ring buffer 化）', () => {
  assert.doesNotMatch(MAIN, /fs\.promises\.appendFile/,
    'main.js のどこかに fs.promises.appendFile が残存（rc18 で writeFile に統一すべき）');
});

// ============================================================
console.log('');
console.log(`Summary: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
