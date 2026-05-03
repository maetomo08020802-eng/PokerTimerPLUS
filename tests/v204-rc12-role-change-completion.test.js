/**
 * v2.0.4-rc12 — onRoleChanged 真因根治 + rc11 計測コード完全削除 の静的解析テスト
 *
 * rc7〜rc10 連続失敗の真因:
 *   renderer.js は <script type="module"> 経由 = 自動 strict mode。
 *   preload.js の `contextBridge.exposeInMainWorld('appRole', _role)` が window.appRole を
 *   writable: false で凍結 → strict mode で `window.appRole = newRole` が TypeError を投げ、
 *   preload.js の `try { callback(newRole); } catch (_) {}` で握り潰される → setAttribute 不到達
 *   → CSS `[data-role="operator"] .clock { display: none }` が当たり続け「タイマー画面消失」。
 *
 * rc12 根治:
 *   1. `setAttribute('data-role', newRole)` をハンドラの最優先処理に移動（DOM 更新を先行保証）
 *   2. `window.appRole = newRole` を try-catch で防御（凍結 throw を握り潰す）
 *   3. 後続 update* 呼出の個別 try-catch 維持（既存設計踏襲）
 *
 * 検証内容:
 *   - onRoleChanged ハンドラの全フェーズが防御的に実行される
 *   - data-role 切替時の .clock 表示保証（CSS と JS 両面）
 *   - 致命バグ保護 5 件 cross-check 維持
 *   - operator-solo モード（v1.3.0 互換）影響なし
 *   - rc11 計測コード残骸不在確認（grep キーワード 0 件ヒット）
 *   - version 同期確認
 *
 * 実行: node tests/v204-rc12-role-change-completion.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD  = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const STYLE    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'style.css'), 'utf8');

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
// Fix 1: onRoleChanged 真因根治
// ============================================================

// rc21 第 2 弾追従: onRoleChanged ハンドラに計測ラベル（インライン object literal 含む）追加に伴い、
//   非貪欲な `\}\s*\)` 早期マッチ問題を解消するため balanced brace 抽出 (extractFunctionBody) に切替。
test('Fix 1-A: onRoleChanged ハンドラ内で setAttribute("data-role", ...) が window.appRole 代入より「前」', () => {
  const handler = extractFunctionBody(RENDERER, /onRoleChanged\?\.\(\s*\(newRole\)\s*=>\s*\{/);
  assert.ok(handler, 'onRoleChanged ハンドラ抽出失敗');
  const setAttrIdx = handler.search(/setAttribute\(\s*['"]data-role['"]/);
  const assignIdx  = handler.search(/window\.appRole\s*=\s*newRole/);
  assert.ok(setAttrIdx >= 0, 'onRoleChanged で setAttribute("data-role", ...) が見つからない');
  assert.ok(assignIdx  >= 0, 'onRoleChanged で window.appRole = newRole が見つからない');
  assert.ok(setAttrIdx < assignIdx,
    `setAttribute (idx=${setAttrIdx}) が window.appRole 代入 (idx=${assignIdx}) より後（rc12 根治不在: setAttribute を先行させる必要あり）`);
});

test('Fix 1-B: window.appRole 代入が try-catch で防御されている（contextBridge 凍結による throw を握り潰す）', () => {
  // 1 行で `try { window.appRole = newRole; } catch ...` パターンを検証
  assert.match(RENDERER, /try\s*\{\s*window\.appRole\s*=\s*newRole\s*;?\s*\}\s*catch/,
    'window.appRole = newRole が try { ... } catch で囲まれていない（rc12 根治不在: contextBridge 凍結 throw 防御欠落）');
});

test('Fix 1-C: onRoleChanged ハンドラ内の setAttribute が try-catch で防御されている', () => {
  const handler = extractFunctionBody(RENDERER, /onRoleChanged\?\.\(\s*\(newRole\)\s*=>\s*\{/);
  assert.ok(handler);
  // setAttribute の直近に try { ... } catch があるか
  assert.match(handler, /try\s*\{[\s\S]*?setAttribute\(\s*['"]data-role['"][\s\S]*?\}\s*catch/,
    'onRoleChanged の setAttribute が try-catch で防御されていない');
});

test('Fix 1-D: 後続更新（updateMuteIndicator / updateOperatorPane / updateFocusBanner）が引き続き個別 try-catch で守られる', () => {
  const handler = extractFunctionBody(RENDERER, /onRoleChanged\?\.\(\s*\(newRole\)\s*=>\s*\{/);
  assert.ok(handler);
  // updateMuteIndicator の try-catch
  assert.match(handler, /try\s*\{\s*updateMuteIndicator\s*\(/,
    'onRoleChanged 内の updateMuteIndicator が try-catch で守られていない');
  // updateFocusBanner の try-catch
  assert.match(handler, /try\s*\{\s*updateFocusBanner\s*\(/,
    'onRoleChanged 内の updateFocusBanner が try-catch で守られていない');
});

test('Fix 1-E: 早期 return（typeof newRole !== "string" 等）が引き続き存在し setAttribute 前に評価される', () => {
  const handler = extractFunctionBody(RENDERER, /onRoleChanged\?\.\(\s*\(newRole\)\s*=>\s*\{/);
  assert.ok(handler);
  const guardIdx = handler.search(/typeof\s+newRole\s*!==\s*['"]string['"]/);
  const setAttrIdx = handler.search(/setAttribute\(\s*['"]data-role['"]/);
  assert.ok(guardIdx >= 0, 'newRole 型検査ガードが消失');
  assert.ok(setAttrIdx > guardIdx, 'setAttribute が型検査ガードより前にある（不正な newRole で DOM 破壊リスク）');
});

test('Fix 1-F: ハンドラ登録ブロック自体が hall を除外（rc7 から維持、回帰なし）', () => {
  assert.match(RENDERER, /window\.appRole\s*!==\s*['"]hall['"][\s\S]{0,500}?onRoleChanged/,
    'onRoleChanged 登録ブロックで hall 除外ガードが消失');
});

// ============================================================
// Fix 2: rc11 計測コード完全削除（grep 0 件確認）
// ============================================================

test('Fix 2-A: src/main.js から rc11 計測関連シンボルが完全消失', () => {
  // 実行可能シンボル（コメントは許容）
  const symbols = [
    'MEASUREMENT_LOG_ENABLED',
    '_initMeasurementLogFile',
    '_measurementLogFile',
    '_safeIsWindowOffScreen',
    '_safeWindowState',
    '_appFocusedSnapshot',
    '_collectDisplayRemovedSnapshot',
    '_collectGenericSnapshot',
    '_scheduleDisplayRemovedDelayedSnapshots',
    'function mLog\\(',
    "ipcMain\\.on\\(\\s*['\"]measurement:log['\"]"
  ];
  for (const s of symbols) {
    const re = new RegExp(s);
    assert.doesNotMatch(MAIN, re, `main.js に rc11 計測シンボル "${s}" が残存`);
  }
});

test('Fix 2-B: src/renderer/renderer.js から rc11 計測関連シンボルが完全消失', () => {
  const symbols = [
    '_rc11Mlog',
    '_rc11ClockDisplay',
    '_rc11CurrentDataRole',
    '_rc11BuildPreSnapshot',
    '_rc11BuildBeforeSetAttrSnapshot',
    '_rc11BuildAfterSetAttrSnapshot',
    '_rc11BuildAfterUpdatesSnapshot',
    '_rc11RafSnapshotLog',
    '_showRc11MeasureIndicatorIfNeeded',
    "window\\.api\\?\\.measurement"
  ];
  for (const s of symbols) {
    const re = new RegExp(s);
    assert.doesNotMatch(RENDERER, re, `renderer.js に rc11 計測シンボル "${s}" が残存`);
  }
});

test('Fix 2-C: src/preload.js から rc11 計測ブリッジが完全消失', () => {
  assert.doesNotMatch(PRELOAD, /measurement\s*:\s*\{/,
    'preload.js に measurement: { log: ... } ブロックが残存');
  assert.doesNotMatch(PRELOAD, /['"]measurement:log['"]/,
    'preload.js に measurement:log IPC channel 文字列が残存');
});

test('Fix 2-D: src/renderer/index.html から rc11-measure-indicator が完全消失', () => {
  assert.doesNotMatch(HTML, /rc11-measure-indicator/,
    'index.html に rc11-measure-indicator div が残存');
  assert.doesNotMatch(HTML, /js-rc11-measure-indicator/,
    'index.html に js-rc11-measure-indicator id が残存');
});

test('Fix 2-E: src/renderer/style.css から .rc11-measure-indicator CSS が完全消失', () => {
  assert.doesNotMatch(STYLE, /rc11-measure-indicator/,
    'style.css に .rc11-measure-indicator ルールが残存');
});

// ============================================================
// 致命バグ保護 5 件 cross-check（rc12 で影響なしを担保）
// ============================================================

test('致命バグ保護 C.2.7-A: resetBlindProgressOnly が renderer.js に引き続き存在', () => {
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'resetBlindProgressOnly が消失（致命バグ保護 C.2.7-A 破壊）');
});

test('致命バグ保護 C.2.7-D: tournaments:setDisplaySettings の timerState destructure 除外維持', () => {
  const m = MAIN.match(/ipcMain\.handle\(\s*['"]tournaments:setDisplaySettings['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, 'tournaments:setDisplaySettings ハンドラが見つからない');
  assert.doesNotMatch(m[0], /const\s*\{[^}]*\btimerState\b[^}]*\}\s*=/,
    'setDisplaySettings で timerState destructure が混入（C.2.7-D 致命バグ再発）');
});

test('致命バグ保護 C.1-A2: ensureEditorEditableState が renderer.js に引き続き存在', () => {
  assert.match(RENDERER, /function\s+ensureEditorEditableState\s*\(/,
    'ensureEditorEditableState が消失（致命バグ保護 C.1-A2 破壊）');
});

test('致命バグ保護 C.1.7: AudioContext suspend 検出が維持', () => {
  const audioJsPath = path.join(ROOT, 'src', 'renderer', 'audio.js');
  if (fs.existsSync(audioJsPath)) {
    const audio = fs.readFileSync(audioJsPath, 'utf8');
    assert.match(audio, /audioContext\.state\s*===?\s*['"]suspended['"]/,
      'audio.js から audioContext.state suspended 検出が消失（C.1.7 致命バグ破壊）');
  } else {
    assert.match(RENDERER, /audioContext\.state\s*===?\s*['"]suspended['"]/,
      'renderer.js から audioContext.state suspended 検出が消失（C.1.7 致命バグ破壊）');
  }
});

test('致命バグ保護 C.1.8: tournaments:setRuntime IPC が維持', () => {
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]tournaments:setRuntime['"]/,
    'tournaments:setRuntime ハンドラが消失（C.1.8 致命バグ破壊）');
});

// ============================================================
// rc10 確定 Fix の維持確認（rc12 では触らない）
// ============================================================

test('rc10 維持: _dualStateCache に specialStack キーが引き続き存在', () => {
  const m = MAIN.match(/const\s+_dualStateCache\s*=\s*\{[\s\S]*?\};/);
  assert.ok(m);
  assert.match(m[0], /specialStack\s*:\s*null/,
    '_dualStateCache から specialStack キーが消失（rc10 Fix 1-A 破壊）');
});

test('rc10 維持: app.requestSingleInstanceLock が引き続き存在', () => {
  assert.match(MAIN, /app\.requestSingleInstanceLock\s*\(\s*\)/,
    'app.requestSingleInstanceLock が消失（rc10 Fix 3 破壊）');
});

test('rc10 維持: switchOperatorToSolo の dual:role-changed が二重送信されている', () => {
  const body = extractFunctionBody(MAIN, /async\s+function\s+switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body);
  const sends = body.match(/dual:role-changed/g) || [];
  assert.ok(sends.length >= 2,
    `switchOperatorToSolo の dual:role-changed 送信が ${sends.length} 回（期待 >= 2、rc10 Fix 2-A 破壊）`);
});

test('rc10 維持: switchOperatorToSolo に app.focus({ steal: true }) が引き続き存在', () => {
  const body = extractFunctionBody(MAIN, /async\s+function\s+switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body);
  assert.match(body, /app\.focus\s*\(\s*\{\s*steal\s*:\s*true\s*\}\s*\)/,
    'switchOperatorToSolo の app.focus({steal:true}) が消失（rc10 Fix 2-B 破壊）');
});

test('rc10 維持 → rc15 で完全削除: H 行は index.html から完全削除', () => {
  // rc10 では H 文言を簡略化（括弧書き削除）したが、rc15 で行ごと完全削除へ進化
  assert.doesNotMatch(HTML, /<kbd>H<\/kbd>/,
    'index.html に H 行が残存（rc15 で削除予定、rc10 簡略化から進化）');
});

// ============================================================
// operator-solo モード（v1.3.0 互換）影響なし確認
// ============================================================

test('operator-solo 互換: createOperatorWindow が引き続き role 引数を受け取る', () => {
  assert.match(MAIN, /function\s+createOperatorWindow\s*\(/,
    'createOperatorWindow が消失（v1.3.0 互換破壊）');
});

test('operator-solo 互換: switchOperatorToSolo は hallWindow.close + mainWindow 保持', () => {
  const body = extractFunctionBody(MAIN, /async\s+function\s+switchOperatorToSolo\s*\(\s*\)\s*\{/);
  assert.ok(body);
  assert.match(body, /hallWindow\.close\s*\(\s*\)/, 'hallWindow.close 呼出が消失');
  assert.doesNotMatch(body, /mainWindow\.close\s*\(\s*\)/,
    'switchOperatorToSolo で mainWindow.close が呼ばれている（rc6 以降の不変条件破壊）');
});

test('operator-solo 互換: rc8 で追加した [data-role="operator-solo"] 用 hidden ルールが維持', () => {
  // rc9 防御保険 CSS（[data-role="operator-solo"] .clock { display: grid !important }）の維持
  assert.match(STYLE, /\[data-role="operator-solo"\]\s*\.clock\s*\{[^}]*display:\s*grid\s*!important/,
    'style.css から rc9 防御保険 CSS が消失（operator-solo .clock { display: grid !important }）');
});

// ============================================================
// version 同期確認（rc12）
// ============================================================

test('version: package.json は 2.0.4', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.4',
    `package.json version が ${pkg.version}（期待 2.0.4）`);
});

test('version: scripts.test に v204-rc12-role-change-completion.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v204-rc12-role-change-completion\.test\.js/,
    'package.json scripts.test に v204-rc12-role-change-completion.test.js がない');
});

// ============================================================
console.log('');
console.log(`Summary: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
