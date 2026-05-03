/**
 * v2.0.4-rc23 静的解析テスト
 *   タスク 1（問題 ⑩ 真因根治）: display-removed ハンドラを「hallWindow alive なら無条件 close + switchOperatorToSolo」に変更
 *     真因 = HDMI 抜き直後 Windows が hallWindow を新 primary display に瞬時移動 → isWindowOnDisplay 必ず false
 *           → switchOperatorToSolo 不発火 → タイマー画面消失。前原さん運用方針 A（PC + HDMI 1 本のみ）確定により
 *             display-removed = 会場モニター消失と同義で扱える。
 *   タスク 2（観測ラベル 8 件全削除）: rc22 第 2 弾投入の計測ラベルを真因確定済のため全削除
 *     - renderer.js から 6 件
 *     - preload.js から 2 件
 *     - rc12 修正コード（setAttribute + window.appRole 代入の try-catch 順序）は完全維持
 *     - preload.js の握り潰し try-catch パターン自体は rc12 防御として維持
 *
 * 致命バグ保護 5 件 + rc12 + rc18 ring buffer 設計 + rc22（⑨-A / ⑩-A / ⑩-D）すべて維持確認 + version assertion。
 *
 * 実行: node tests/v204-rc23-display-removed-fix.test.js
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

// display-removed ハンドラ全体を抽出（screen.on('display-removed', async (...) => { ... }) を balanced brace で）
function extractDisplayRemovedHandler() {
  const startRe = /screen\.on\s*\(\s*['"]display-removed['"][\s\S]*?async[\s\S]*?\(\s*_?event\s*,\s*removedDisplay\s*\)\s*=>\s*\{/;
  const m = MAIN.match(startRe);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < MAIN.length && depth > 0) {
    const c = MAIN[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return MAIN.slice(m.index, i);
}

// onRoleChanged ハンドラ全体を抽出（rc12 順序確認用）
function extractOnRoleChangedHandler() {
  const startRe = /window\.api\?\.dual\?\.onRoleChanged\?\.\(\s*\(\s*newRole\s*\)\s*=>\s*\{/;
  const m = RENDERER.match(startRe);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < RENDERER.length && depth > 0) {
    const c = RENDERER[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return RENDERER.slice(m.index, i);
}

// preload.js の onRoleChanged コールバック全体を抽出
function extractPreloadOnRoleChanged() {
  const startRe = /onRoleChanged\s*:\s*\(\s*callback\s*\)\s*=>\s*\{/;
  const m = PRELOAD.match(startRe);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < PRELOAD.length && depth > 0) {
    const c = PRELOAD[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return PRELOAD.slice(m.index, i);
}

// ============================================================
// タスク 1（問題 ⑩ 真因根治）: display-removed ハンドラ修正
// ============================================================

test('T1: display-removed ハンドラ内に isWindowOnDisplay 判定が存在しない（rc23 削除確認）', () => {
  const body = extractDisplayRemovedHandler();
  assert.ok(body, 'display-removed ハンドラが抽出できない');
  assert.doesNotMatch(body, /isWindowOnDisplay\s*\(/,
    'display-removed ハンドラ内に isWindowOnDisplay 判定が残存（rc23 で削除されているはず）');
});

test('T2: display-removed ハンドラ内に無条件 hallWindow.close() + switchOperatorToSolo() 経路存在', () => {
  const body = extractDisplayRemovedHandler();
  assert.ok(body, 'display-removed ハンドラが抽出できない');
  assert.match(body, /hallWindow\.close\s*\(\s*\)/,
    'display-removed ハンドラ内に hallWindow.close() 呼出が見つからない');
  assert.match(body, /await\s+switchOperatorToSolo\s*\(\s*\)/,
    'display-removed ハンドラ内に await switchOperatorToSolo() 呼出が見つからない');
  // hallWindow = null 経由で broadcast no-op ガード成立
  assert.match(body, /hallWindow\s*=\s*null/,
    'display-removed ハンドラ内に hallWindow = null 代入が見つからない');
});

test('T3: display-removed ハンドラ内の既存ガードが維持されている', () => {
  const body = extractDisplayRemovedHandler();
  assert.ok(body, 'display-removed ハンドラが抽出できない');
  assert.match(body, /_displayRemovedPending/,
    'display-removed ハンドラ内に _displayRemovedPending ガードが見つからない');
  assert.match(body, /hallWindow\.isDestroyed\s*\(\s*\)/,
    'display-removed ハンドラ内に hallWindow.isDestroyed() ガードが見つからない');
});

test('T4: rollingLog("display-removed", ...) 呼出が維持されている（配布版常時記録）', () => {
  const body = extractDisplayRemovedHandler();
  assert.ok(body, 'display-removed ハンドラが抽出できない');
  assert.match(body, /rollingLog\s*\(\s*['"]display-removed['"]/,
    'display-removed ハンドラ内に rollingLog("display-removed", ...) 呼出が見つからない');
  assert.match(body, /_safeDisplayRemovedSnapshot\s*\(/,
    'display-removed ハンドラ内に _safeDisplayRemovedSnapshot 呼出が見つからない');
});

// ============================================================
// タスク 2（観測ラベル 8 件全削除）: renderer.js 6 件 + preload.js 2 件
// ============================================================

test('T5: renderer.js から renderer:onRoleChanged:before-setAttribute ラベル送信が削除されている', () => {
  assert.ok(!RENDERER.includes('renderer:onRoleChanged:before-setAttribute'),
    'renderer.js に renderer:onRoleChanged:before-setAttribute ラベルが残存');
});

test('T6: renderer.js から renderer:onRoleChanged:after-setAttribute ラベル送信が削除されている', () => {
  assert.ok(!RENDERER.includes('renderer:onRoleChanged:after-setAttribute'),
    'renderer.js に renderer:onRoleChanged:after-setAttribute ラベルが残存');
});

test('T7: renderer.js から renderer:onRoleChanged:after-appRole-assign ラベル送信が削除されている', () => {
  assert.ok(!RENDERER.includes('renderer:onRoleChanged:after-appRole-assign'),
    'renderer.js に renderer:onRoleChanged:after-appRole-assign ラベルが残存');
});

test('T8: renderer.js から renderer:onRoleChanged:after-updateMuteIndicator ラベル送信が削除されている', () => {
  assert.ok(!RENDERER.includes('renderer:onRoleChanged:after-updateMuteIndicator'),
    'renderer.js に renderer:onRoleChanged:after-updateMuteIndicator ラベルが残存');
});

test('T9: renderer.js から renderer:onRoleChanged:after-updateOperatorPane ラベル送信が削除されている', () => {
  assert.ok(!RENDERER.includes('renderer:onRoleChanged:after-updateOperatorPane'),
    'renderer.js に renderer:onRoleChanged:after-updateOperatorPane ラベルが残存');
});

test('T10: renderer.js から renderer:onRoleChanged:after-updateFocusBanner ラベル送信が削除されている', () => {
  assert.ok(!RENDERER.includes('renderer:onRoleChanged:after-updateFocusBanner'),
    'renderer.js に renderer:onRoleChanged:after-updateFocusBanner ラベルが残存');
});

test('T11: preload.js から preload:onRoleChanged:enter ラベル送信が削除されている', () => {
  assert.ok(!PRELOAD.includes('preload:onRoleChanged:enter'),
    'preload.js に preload:onRoleChanged:enter ラベルが残存');
});

test('T12: preload.js から preload:onRoleChanged:catch ラベル送信が削除されている', () => {
  assert.ok(!PRELOAD.includes('preload:onRoleChanged:catch'),
    'preload.js に preload:onRoleChanged:catch ラベルが残存');
});

test('T13: preload.js の握り潰し try-catch パターン自体は維持（rc12 防御）', () => {
  const body = extractPreloadOnRoleChanged();
  assert.ok(body, 'preload.js onRoleChanged コールバックが抽出できない');
  // try { callback(newRole); } catch (...) { ... } の構造維持
  assert.match(body, /try\s*\{[\s\S]*?callback\s*\(\s*newRole\s*\)[\s\S]*?\}\s*catch\s*\(/,
    'preload.js onRoleChanged 内の try { callback(newRole); } catch ... パターンが見つからない（rc12 防御消失）');
});

test('T14: rc12 修正コード（setAttribute + window.appRole 代入の try-catch 順序）完全維持', () => {
  const handler = extractOnRoleChangedHandler();
  assert.ok(handler, 'onRoleChanged ハンドラ抽出失敗');
  const setAttrIdx = handler.search(/setAttribute\s*\(\s*['"]data-role['"]/);
  const appRoleIdx = handler.search(/window\.appRole\s*=/);
  assert.ok(setAttrIdx >= 0, 'onRoleChanged ハンドラ内で setAttribute(data-role, ...) が見つからない');
  assert.ok(appRoleIdx >= 0, 'onRoleChanged ハンドラ内で window.appRole 代入が見つからない');
  assert.ok(setAttrIdx < appRoleIdx,
    'rc12 修正: setAttribute 直後に window.appRole 代入の順序が崩れている');
  // setAttribute 周辺の try-catch、window.appRole 周辺の try-catch、それぞれ存在
  assert.match(handler, /try\s*\{[^}]*document\.documentElement[^}]*setAttribute/,
    'setAttribute を包む try ブロックが見つからない（rc12 防御消失）');
  assert.match(handler, /try\s*\{\s*window\.appRole\s*=/,
    'window.appRole 代入を包む try ブロックが見つからない（rc12 防御消失）');
});

// ============================================================
// 致命バグ保護 5 件 cross-check
// ============================================================

test('C.2.7-A: resetBlindProgressOnly 関数定義が存在', () => {
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'resetBlindProgressOnly 関数定義が見つからない（C.2.7-A 致命バグ保護違反）');
});

test('C.2.7-D: tournaments:setDisplaySettings ハンドラ内に timerState destructure が無い', () => {
  const handlerRe = /ipcMain\.handle\s*\(\s*['"]tournaments:setDisplaySettings['"][\s\S]*?\n\s*\}\s*\)\s*;/;
  const m = MAIN.match(handlerRe);
  assert.ok(m, 'tournaments:setDisplaySettings ハンドラが見つからない');
  assert.doesNotMatch(m[0], /\{\s*[^}]*\btimerState\b[^}]*\}\s*=/,
    'tournaments:setDisplaySettings ハンドラ内に timerState destructure が見つかった（C.2.7-D 致命バグ保護違反）');
});

test('C.1-A2: ensureEditorEditableState 関数定義が存在', () => {
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'ensureEditorEditableState 関数定義が見つからない（C.1-A2 致命バグ保護違反）');
});

test('C.1.7: AudioContext suspend resume 経路が _play() 冒頭に存在', () => {
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
// rc22 維持 cross-check（⑨-A / ⑩-A / ⑩-D）
// ============================================================

test('rc22 ⑨-A: subscribe 持続条件に IDLE && (remainingMs OR totalMs) 句が維持されている', () => {
  const idx = RENDERER.indexOf('schedulePersistTimerState();');
  assert.ok(idx >= 0, 'schedulePersistTimerState() 呼出が見つからない');
  const region = RENDERER.slice(Math.max(0, idx - 800), idx);
  assert.match(region, /state\.status\s*===\s*States\.IDLE\s*&&\s*\(\s*state\.remainingMs\s*!==\s*prev\.remainingMs\s*\|\|\s*state\.totalMs\s*!==\s*prev\.totalMs\s*\)/,
    'subscribe 持続条件に rc22 ⑨-A の IDLE OR 句が見つからない（rc22 修正消失）');
});

test('rc22 ⑩-A: registerShortcuts 内に CommandOrControl+Shift+L 登録が維持されている', () => {
  const body = extractFunctionBody(MAIN, /function\s+registerShortcuts\s*\(\s*\)\s*\{/);
  assert.ok(body, 'registerShortcuts 関数本体が見つからない');
  assert.match(body, /globalShortcut\.register\s*\(\s*['"]CommandOrControl\+Shift\+L['"]/,
    'registerShortcuts 内に CommandOrControl+Shift+L 登録が見つからない（rc22 修正消失）');
  // ハンドラ内 await _flushRollingLog() + shell.openPath 維持
  const ctrlBlockRe = /globalShortcut\.register\s*\(\s*['"]CommandOrControl\+Shift\+L['"][\s\S]*?\}\s*\)\s*;/;
  const m = body.match(ctrlBlockRe);
  assert.ok(m, 'CommandOrControl+Shift+L 登録ブロック全体が抽出できない');
  assert.match(m[0], /await\s+_flushRollingLog\s*\(\s*\)/,
    'CommandOrControl+Shift+L ハンドラ内 await _flushRollingLog() 消失');
  assert.match(m[0], /shell\.openPath\s*\(/,
    'CommandOrControl+Shift+L ハンドラ内 shell.openPath 消失');
});

test('rc22 ⑩-D: _initRollingLog 内に fs.readFileSync 経路が維持されている', () => {
  const body = extractFunctionBody(MAIN, /function\s+_initRollingLog\s*\(\s*\)\s*\{/);
  assert.ok(body, '_initRollingLog 関数本体が見つからない');
  assert.match(body, /fs\.readFileSync\s*\(\s*_rollingLogFilePath\s*,\s*['"]utf8['"]\s*\)/,
    '_initRollingLog 内に fs.readFileSync(_rollingLogFilePath, "utf8") 経路が見つからない（rc22 ⑩-D 消失）');
  assert.match(body, /JSON\.parse\s*\(/,
    '_initRollingLog 内に JSON.parse 復元ロジックが見つからない（rc22 ⑩-D 消失）');
  assert.match(body, /_rollingLogBuffer\.push\s*\(/,
    '_initRollingLog 内に _rollingLogBuffer.push 復元ロジックが見つからない（rc22 ⑩-D 消失）');
});

// ============================================================
// version assertion
// ============================================================

test('version: package.json は 2.0.6', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.6',
    `package.json version が ${pkg.version}（期待 2.0.6）`);
});

test('version: scripts.test に v204-rc23-display-removed-fix.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v204-rc23-display-removed-fix\.test\.js/,
    'package.json scripts.test に v204-rc23-display-removed-fix.test.js が含まれていない');
});

// ============================================================
console.log('');
console.log(`v204-rc23-display-removed-fix.test.js: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
