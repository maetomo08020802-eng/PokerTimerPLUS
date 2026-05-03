/**
 * v2.0.4-rc22 第 2 弾静的解析テスト
 *   タスク 1（問題 ⑨ 案 ⑨-A）: subscribe 持続条件に IDLE remainingMs/totalMs 変化 OR 句追加
 *   タスク 2（問題 ⑩ 案 ⑩-A）: globalShortcut 'CommandOrControl+Shift+L' 登録
 *   タスク 3（問題 ⑩ 案 ⑩-D）: 起動時 _initRollingLog で旧 rolling-current.log を readFileSync で復元
 *
 * 致命バグ保護 5 件 + rc12 + rc18 ring buffer 設計 cross-check + 計測ラベル 8 件維持確認 + version assertion。
 *
 * 実行: node tests/v204-rc22-subscribe-and-log.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT      = path.join(__dirname, '..');
const MAIN      = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD   = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
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
// タスク 1（問題 ⑨ 案 ⑨-A）: subscribe 持続条件 IDLE OR 句追加
// ============================================================

// subscribe 内 schedulePersistTimerState ブロック直前の if 条件を抽出
function extractSubscribePersistIf() {
  // schedulePersistTimerState() 呼出を含む直前の if (...) を逆方向に探索
  const idx = RENDERER.indexOf('schedulePersistTimerState();');
  if (idx < 0) return null;
  // schedulePersistTimerState() 直前から逆走査して最寄りの「if (...) {」ブロックを取得
  // 単純化: 直前 600 文字を抽出
  return RENDERER.slice(Math.max(0, idx - 800), idx);
}

test('T1: subscribe 持続条件に States.IDLE && (remainingMs OR totalMs 変化) 句が存在', () => {
  const region = extractSubscribePersistIf();
  assert.ok(region, 'subscribe 内 schedulePersistTimerState 直前領域が抽出できない');
  // IDLE 限定 OR 句の存在確認（remainingMs / totalMs どちらの変化も含む）
  const re = /state\.status\s*===\s*States\.IDLE\s*&&\s*\(\s*state\.remainingMs\s*!==\s*prev\.remainingMs\s*\|\|\s*state\.totalMs\s*!==\s*prev\.totalMs\s*\)/;
  assert.match(region, re,
    'subscribe 内に「state.status === States.IDLE && (state.remainingMs !== prev.remainingMs || state.totalMs !== prev.totalMs)」句が見つからない');
});

test('T2: 既存 3 句（status / currentLevelIndex / PAUSED && remainingMs）が破壊されていない', () => {
  const region = extractSubscribePersistIf();
  assert.ok(region, 'subscribe 内 schedulePersistTimerState 直前領域が抽出できない');
  assert.match(region, /state\.status\s*!==\s*prev\.status/,
    '既存句「state.status !== prev.status」が見つからない（破壊された可能性）');
  assert.match(region, /state\.currentLevelIndex\s*!==\s*prev\.currentLevelIndex/,
    '既存句「state.currentLevelIndex !== prev.currentLevelIndex」が見つからない（破壊された可能性）');
  assert.match(region, /state\.status\s*===\s*States\.PAUSED\s*&&\s*state\.remainingMs\s*!==\s*prev\.remainingMs/,
    '既存句「state.status === States.PAUSED && state.remainingMs !== prev.remainingMs」が見つからない（破壊された可能性）');
});

test('T3: IDLE 句は IDLE 限定 — PAUSED 進行中に誤発火しないことを静的に確認（③ c 厳守）', () => {
  const region = extractSubscribePersistIf();
  assert.ok(region, 'subscribe 内 schedulePersistTimerState 直前領域が抽出できない');
  // IDLE 句が PAUSED 句と独立に書かれており、IDLE 限定 (status === IDLE) を伴うことを確認
  // 「remainingMs/totalMs 変化を IDLE 制約なしに trigger に追加」という ③ c 違反パターンが存在しないこと
  // = if 条件式直下に「state.remainingMs !== prev.remainingMs」を IDLE/PAUSED ガードなしで書いていない
  // 検査: region 内の条件式行群で「(state\.remainingMs !== prev\.remainingMs)」が IDLE/PAUSED ガード付きで囲まれている
  const idleClause = /state\.status\s*===\s*States\.IDLE\s*&&\s*\(/;
  const pausedClause = /state\.status\s*===\s*States\.PAUSED\s*&&\s*state\.remainingMs\s*!==\s*prev\.remainingMs/;
  assert.match(region, idleClause, 'IDLE 限定ガードが見つからない（無条件 trigger 化禁止）');
  assert.match(region, pausedClause, 'PAUSED 限定ガードが見つからない');
});

// ============================================================
// タスク 2（問題 ⑩ 案 ⑩-A）: globalShortcut 'Ctrl+Shift+L' 登録
// ============================================================

test('T4: main.js registerShortcuts に CommandOrControl+Shift+L 登録が存在', () => {
  const body = extractFunctionBody(MAIN, /function\s+registerShortcuts\s*\(\s*\)\s*\{/);
  assert.ok(body, 'registerShortcuts 関数本体が見つからない');
  assert.match(body, /globalShortcut\.register\s*\(\s*['"]CommandOrControl\+Shift\+L['"]/,
    "registerShortcuts 内に globalShortcut.register('CommandOrControl+Shift+L', ...) が見つからない");
});

test('T5: Ctrl+Shift+L ハンドラ内に await _flushRollingLog() 呼出が存在（rc18 I/O 順序保証）', () => {
  const body = extractFunctionBody(MAIN, /function\s+registerShortcuts\s*\(\s*\)\s*\{/);
  assert.ok(body, 'registerShortcuts 関数本体が見つからない');
  // Ctrl+Shift+L ブロック内に「await _flushRollingLog()」が存在
  const ctrlBlockRe = /globalShortcut\.register\s*\(\s*['"]CommandOrControl\+Shift\+L['"][\s\S]*?\}\s*\)\s*;/;
  const m = body.match(ctrlBlockRe);
  assert.ok(m, 'Ctrl+Shift+L 登録ブロック全体が抽出できない');
  assert.match(m[0], /await\s+_flushRollingLog\s*\(\s*\)/,
    'Ctrl+Shift+L ハンドラ内に await _flushRollingLog() が見つからない（I/O 順序保証違反）');
});

test('T6: Ctrl+Shift+L ハンドラ内に shell.openPath 呼出が存在', () => {
  const body = extractFunctionBody(MAIN, /function\s+registerShortcuts\s*\(\s*\)\s*\{/);
  assert.ok(body, 'registerShortcuts 関数本体が見つからない');
  const ctrlBlockRe = /globalShortcut\.register\s*\(\s*['"]CommandOrControl\+Shift\+L['"][\s\S]*?\}\s*\)\s*;/;
  const m = body.match(ctrlBlockRe);
  assert.ok(m, 'Ctrl+Shift+L 登録ブロック全体が抽出できない');
  assert.match(m[0], /shell\.openPath\s*\(/,
    'Ctrl+Shift+L ハンドラ内に shell.openPath 呼出が見つからない');
  assert.match(m[0], /_resolveLogsDir\s*\(\s*\)/,
    'Ctrl+Shift+L ハンドラ内に _resolveLogsDir() 呼出が見つからない');
});

// ============================================================
// タスク 3（問題 ⑩ 案 ⑩-D）: 起動時 _initRollingLog で旧 log buffer 復元
// ============================================================

test('T7: _initRollingLog 内に fs.readFileSync(_rollingLogFilePath, ...) 呼出が存在', () => {
  const body = extractFunctionBody(MAIN, /function\s+_initRollingLog\s*\(\s*\)\s*\{/);
  assert.ok(body, '_initRollingLog 関数本体が見つからない');
  assert.match(body, /fs\.readFileSync\s*\(\s*_rollingLogFilePath\s*,\s*['"]utf8['"]\s*\)/,
    "_initRollingLog 内に fs.readFileSync(_rollingLogFilePath, 'utf8') が見つからない");
});

test('T8: _initRollingLog 復元経路に JSON.parse + _rollingLogBuffer.push が存在', () => {
  const body = extractFunctionBody(MAIN, /function\s+_initRollingLog\s*\(\s*\)\s*\{/);
  assert.ok(body, '_initRollingLog 関数本体が見つからない');
  assert.match(body, /JSON\.parse\s*\(/,
    '_initRollingLog 内に JSON.parse 呼出が見つからない（復元ロジック不在）');
  assert.match(body, /_rollingLogBuffer\.push\s*\(/,
    '_initRollingLog 内に _rollingLogBuffer.push 呼出が見つからない（復元ロジック不在）');
});

test('T9: rc18 設計厳守 — _initRollingLog 内に appendFile が復活していない', () => {
  const body = extractFunctionBody(MAIN, /function\s+_initRollingLog\s*\(\s*\)\s*\{/);
  assert.ok(body, '_initRollingLog 関数本体が見つからない');
  assert.doesNotMatch(body, /\bappendFile\b/,
    '_initRollingLog 内に appendFile 呼出が見つかった — rc18 第 1 弾 ring buffer 設計破壊');
});

// ============================================================
// 致命バグ保護 5 件 cross-check
// ============================================================

test('C.2.7-A: resetBlindProgressOnly 関数定義が存在', () => {
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'resetBlindProgressOnly 関数定義が見つからない（C.2.7-A 致命バグ保護違反）');
});

test('C.2.7-D: tournaments:setDisplaySettings ハンドラ内に timerState destructure が無い', () => {
  // setDisplaySettings ハンドラ全体を抽出
  const handlerRe = /ipcMain\.handle\s*\(\s*['"]tournaments:setDisplaySettings['"][\s\S]*?\n\s*\}\s*\)\s*;/;
  const m = MAIN.match(handlerRe);
  assert.ok(m, 'tournaments:setDisplaySettings ハンドラが見つからない');
  // ハンドラ内 destructure に timerState が含まれていないこと
  // 厳密には destructure 構文中の timerState 出現を禁止
  assert.doesNotMatch(m[0], /\{\s*[^}]*\btimerState\b[^}]*\}\s*=/,
    'tournaments:setDisplaySettings ハンドラ内に timerState destructure が見つかった（C.2.7-D 致命バグ保護違反）');
});

test('C.1-A2: ensureEditorEditableState 関数定義が存在', () => {
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'ensureEditorEditableState 関数定義が見つからない（C.1-A2 致命バグ保護違反）');
});

test('C.1.7: AudioContext suspend resume 経路が _play() 冒頭に存在', () => {
  // audio.js の _play 関数本体内で audioContext.state === 'suspended' チェック + resume() 呼出
  assert.match(AUDIO, /audioContext\.state\s*===\s*['"]suspended['"]/,
    'audio.js に AudioContext suspended 検出経路が見つからない（C.1.7 致命バグ保護違反）');
  assert.match(AUDIO, /audioContext\.resume\s*\(/,
    'audio.js に audioContext.resume() 呼出が見つからない（C.1.7 致命バグ保護違反）');
});

test('C.1.8: tournaments:setRuntime IPC ハンドラが存在', () => {
  assert.match(MAIN, /ipcMain\.handle\s*\(\s*['"]tournaments:setRuntime['"]/,
    'tournaments:setRuntime IPC ハンドラが見つからない（C.1.8 致命バグ保護違反）');
});

// ============================================================
// rc12 保護 cross-check
// ============================================================

test('rc12: renderer.js onRoleChanged ハンドラ内 setAttribute + window.appRole 代入の try-catch 順序維持', () => {
  // onRoleChanged ハンドラ内で setAttribute 呼出後に window.appRole 代入が来ること
  // try { ... setAttribute ... appRole 代入 ... } の順序保護
  const handlerRe = /window\.api\?\.dual\?\.onRoleChanged\?\.\(\s*\(\s*newRole\s*\)\s*=>\s*\{[\s\S]*?\n\s*\}\s*\)\s*;/;
  const m = RENDERER.match(handlerRe);
  assert.ok(m, 'onRoleChanged ハンドラが見つからない');
  const setAttrIdx = m[0].search(/setAttribute\s*\(\s*['"]data-role['"]/);
  const appRoleIdx = m[0].search(/window\.appRole\s*=/);
  assert.ok(setAttrIdx >= 0, 'onRoleChanged ハンドラ内で setAttribute(data-role, ...) が見つからない');
  assert.ok(appRoleIdx >= 0, 'onRoleChanged ハンドラ内で window.appRole 代入が見つからない');
  assert.ok(setAttrIdx < appRoleIdx,
    'rc12 修正: setAttribute 直後に window.appRole 代入の順序が崩れている');
});

// ============================================================
// rc18 ring buffer 設計 cross-check
// ============================================================

test('rc18: _flushRollingLog 内で fs.promises.writeFile を使用（appendFile 不在）', () => {
  const body = extractFunctionBody(MAIN, /async\s+function\s+_flushRollingLog\s*\(\s*\)\s*\{/);
  assert.ok(body, '_flushRollingLog 関数本体が見つからない');
  assert.match(body, /fs\.promises\.writeFile\s*\(/,
    '_flushRollingLog 内に fs.promises.writeFile 呼出が見つからない（rc18 設計違反）');
  assert.doesNotMatch(body, /\bappendFile\b/,
    '_flushRollingLog 内に appendFile 呼出が見つかった（rc18 第 1 弾 ring buffer 設計破壊）');
});

test('rc18: ROLLING_LOG_BUFFER_MAX 5000 / _rollingLogBuffer 配列定義が維持されている', () => {
  assert.match(MAIN, /const\s+ROLLING_LOG_BUFFER_MAX\s*=\s*5000\b/,
    'ROLLING_LOG_BUFFER_MAX = 5000 が見つからない');
  assert.match(MAIN, /let\s+_rollingLogBuffer\s*=\s*\[\s*\]/,
    'let _rollingLogBuffer = [] 宣言が見つからない');
});

// ============================================================
// 計測ラベル 8 件削除確認（rc23 で問題 ⑩ 真因確定済 → 全削除）
// ============================================================

test('計測ラベル: renderer:onRoleChanged: 系 6 件が renderer.js から削除されている', () => {
  const labels = [
    'renderer:onRoleChanged:before-setAttribute',
    'renderer:onRoleChanged:after-setAttribute',
    'renderer:onRoleChanged:after-appRole-assign',
    'renderer:onRoleChanged:after-updateMuteIndicator',
    'renderer:onRoleChanged:after-updateOperatorPane',
    'renderer:onRoleChanged:after-updateFocusBanner',
  ];
  for (const lbl of labels) {
    assert.ok(!RENDERER.includes(lbl),
      `計測ラベル '${lbl}' が renderer.js に残存（rc23 で全削除されているはず）`);
  }
});

test('計測ラベル: preload:onRoleChanged: 系 2 件が preload.js から削除されている', () => {
  const labels = [
    'preload:onRoleChanged:enter',
    'preload:onRoleChanged:catch',
  ];
  for (const lbl of labels) {
    assert.ok(!PRELOAD.includes(lbl),
      `計測ラベル '${lbl}' が preload.js に残存（rc23 で全削除されているはず）`);
  }
});

// ============================================================
// version assertion
// ============================================================

test('version: package.json は 2.0.5', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.5',
    `package.json version が ${pkg.version}（期待 2.0.5）`);
});

test('version: scripts.test に v204-rc22-subscribe-and-log.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v204-rc22-subscribe-and-log\.test\.js/,
    'package.json scripts.test に v204-rc22-subscribe-and-log.test.js が含まれていない');
});

// ============================================================
console.log('');
console.log(`v204-rc22-subscribe-and-log.test.js: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
