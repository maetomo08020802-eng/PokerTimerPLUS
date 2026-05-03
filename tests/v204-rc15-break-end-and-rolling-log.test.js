/**
 * v2.0.4-rc15 — break-end の onLevelEnd 移行 + 5 分 rolling ログ機構 + H 行完全削除 の静的解析テスト
 *
 * 対象修正:
 *   タスク 1: `playSound('break-end')` を handleAudioOnTick の BREAK ブロック (remainingSec===0) から
 *             onLevelEnd ハンドラの `lv.isBreak === true` 経路に移動。onTick 瞬間判定の event loop race を構造的に解消。
 *   タスク 2: 5 分 rolling ログ機構（案 A、単一ファイル + 30s 切捨）。
 *             main.js: rollingLog / _initRollingLog / _truncateRollingLog + IPC 'rolling-log:write' / 'logs:openFolder'
 *             preload.js: window.api.log.{write, openFolder}
 *             renderer.js: 主要イベント callsite + window state debounce + global error handlers
 *             audio.js: _play 内に audio:play:enter/resumed/exit ログ
 *             index.html: About タブに「ログフォルダを開く」ボタン
 *   タスク 3: H 行完全削除（index.html + specs.md + 関連テスト追従）
 *
 * 致命バグ保護 5 件 cross-check + rc10/rc12/rc13 維持 + version 同期も担保。
 *
 * 実行: node tests/v204-rc15-break-end-and-rolling-log.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const PRELOAD  = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const AUDIO    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');
const HTML     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const SPECS    = fs.readFileSync(path.join(ROOT, 'docs', 'specs.md'), 'utf8');

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
// タスク 1: break-end の onLevelEnd 移行
// ============================================================

test('T1: onLevelEnd ハンドラ内に lv.isBreak === true で playSound("break-end") が呼ばれる', () => {
  // onLevelEnd ハンドラ本体を抽出
  const m = RENDERER.match(/onLevelEnd\s*:\s*\(\s*index\s*\)\s*=>\s*\{[\s\S]*?\n\s{2,4}\}/);
  assert.ok(m, 'onLevelEnd ハンドラが見つからない');
  // lv.isBreak === true 経路で break-end が呼ばれる（true 比較は ==/=== 両対応で柔軟検証）
  assert.match(m[0], /lv\.isBreak[\s\S]*?playSound\(\s*['"]break-end['"]\s*\)/,
    'onLevelEnd 内で lv.isBreak 経路の playSound("break-end") が見つからない（rc15 タスク 1 不在）');
});

test('T2: onLevelEnd ハンドラ内に !lv.isBreak で playSound("level-end") が引き続き存在', () => {
  const m = RENDERER.match(/onLevelEnd\s*:\s*\(\s*index\s*\)\s*=>\s*\{[\s\S]*?\n\s{2,4}\}/);
  assert.ok(m);
  // !lv.isBreak または else 経路で level-end が呼ばれる
  assert.match(m[0], /playSound\(\s*['"]level-end['"]\s*\)/,
    'onLevelEnd 内で playSound("level-end") が消失（rc15 タスク 1 で破壊？）');
});

test('T3: BREAK ブロック (handleAudioOnTick) から playSound("break-end") が削除されている', () => {
  // if (status === States.BREAK) { ... } ブロックを抽出
  const m = RENDERER.match(/if\s*\(\s*status\s*===?\s*States\.BREAK\s*\)\s*\{[\s\S]*?\}/);
  assert.ok(m, 'BREAK ブロックが見つからない');
  assert.doesNotMatch(m[0], /playSound\(\s*['"]break-end['"]/,
    'BREAK ブロックに playSound("break-end") が残存（rc15 で onLevelEnd に移動済のはず）');
});

test('T4: BREAK ブロック内で remainingSec === 10 の playSound("warning-10sec") が維持（rc13 機能）', () => {
  const m = RENDERER.match(/if\s*\(\s*status\s*===?\s*States\.BREAK\s*\)\s*\{[\s\S]*?\}/);
  assert.ok(m);
  assert.match(m[0], /if\s*\(\s*remainingSec\s*===?\s*10\s*\)\s*playSound\(\s*['"]warning-10sec['"]\s*\)/,
    'BREAK 中の 10 秒前警告が消失（rc13 機能の回帰）');
});

test('T5: BREAK ブロック内で remainingSec 1〜5 の playSound("countdown-tick") が維持（rc13 機能）', () => {
  const m = RENDERER.match(/if\s*\(\s*status\s*===?\s*States\.BREAK\s*\)\s*\{[\s\S]*?\}/);
  assert.ok(m);
  assert.match(m[0], /remainingSec\s*>=\s*1\s*&&\s*remainingSec\s*<=\s*5[\s\S]*?playSound\(\s*['"]countdown-tick['"]\s*\)/,
    'BREAK 中の 5 秒カウントが消失（rc13 機能の回帰）');
});

// ============================================================
// タスク 2: 5 分 rolling ログ機構（案 A）
// ============================================================

test('T6-A: main.js に rollingLog 関数定義が存在', () => {
  assert.match(MAIN, /function\s+rollingLog\s*\(\s*label\s*,\s*data\s*\)/,
    'main.js に rollingLog(label, data) 関数定義が見つからない');
});

test('T6-B: main.js に _initRollingLog / _flushRollingLog ヘルパが存在 (rc18 で _truncateRollingLog → _flushRollingLog 置換)', () => {
  assert.match(MAIN, /function\s+_initRollingLog\s*\(/, '_initRollingLog が見つからない');
  assert.match(MAIN, /async\s+function\s+_flushRollingLog\s*\(/, '_flushRollingLog が見つからない（rc18 ring buffer 化で必要）');
});

test('T6-C: rolling ログは fs.promises 非同期 IO で書き込まれる（同期 IO 禁止、rc18 で writeFile 全体上書きに統一）', () => {
  // rc18: rollingLog は ring buffer に push、flush 時に writeFile で全体上書き（appendFile は廃止）
  const fnBody = extractFunctionBody(MAIN, /async\s+function\s+_flushRollingLog\s*\([^)]*\)\s*\{/);
  assert.ok(fnBody, '_flushRollingLog 本体が見つからない');
  assert.match(fnBody, /fs\.promises\.writeFile|fsp\.writeFile/,
    '_flushRollingLog で非同期 writeFile が使われていない');
});

test('T6-D: 5 分保持期間 + 30 秒切捨間隔の定数が定義されている', () => {
  assert.match(MAIN, /ROLLING_LOG_RETENTION_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/,
    '5 分保持期間定数が見つからない');
  assert.match(MAIN, /ROLLING_LOG_TRUNCATE_INTERVAL_MS\s*=\s*30\s*\*\s*1000/,
    '30 秒切捨間隔定数が見つからない');
});

test('T7: 30 秒定期 flush タイマーが setInterval で起動される（_initRollingLog 内、rc18 で _flushRollingLog 呼出に変更）', () => {
  const fnBody = extractFunctionBody(MAIN, /function\s+_initRollingLog\s*\(\s*\)\s*\{/);
  assert.ok(fnBody);
  assert.match(fnBody, /setInterval\(/,
    '_initRollingLog 内で setInterval によるタイマー起動が見つからない');
  assert.match(fnBody, /_flushRollingLog/,
    'setInterval で _flushRollingLog が呼ばれていない（rc18 で _truncateRollingLog から置換）');
});

test('T8-A: ipcMain.handle("logs:openFolder") が登録されている', () => {
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]logs:openFolder['"]/,
    'logs:openFolder ハンドラが見つからない');
  // shell.openPath で開く
  const m = MAIN.match(/ipcMain\.handle\(\s*['"]logs:openFolder['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m);
  assert.match(m[0], /shell\.openPath/, 'logs:openFolder で shell.openPath が呼ばれていない');
});

test('T8-B: ipcMain.on("rolling-log:write") が登録されている', () => {
  assert.match(MAIN, /ipcMain\.on\(\s*['"]rolling-log:write['"]/,
    'rolling-log:write ハンドラが見つからない');
});

test('T8-C: preload.js に window.api.log = { write, openFolder } が公開', () => {
  assert.match(PRELOAD, /log\s*:\s*\{[\s\S]*?write\s*:[\s\S]*?openFolder\s*:/,
    'preload.js に window.api.log.{write, openFolder} ブリッジが見つからない');
  // write は send (一方向)、openFolder は invoke (結果を返す)
  assert.match(PRELOAD, /ipcRenderer\.send\(\s*['"]rolling-log:write['"]/,
    'preload.js の log.write が ipcRenderer.send で実装されていない');
  assert.match(PRELOAD, /ipcRenderer\.invoke\(\s*['"]logs:openFolder['"]/,
    'preload.js の log.openFolder が ipcRenderer.invoke で実装されていない');
});

test('T9-A: renderer.js に window.addEventListener("error") の rolling ログが登録', () => {
  assert.match(RENDERER, /window\.addEventListener\(\s*['"]error['"]/,
    'renderer.js に window error リスナーが見つからない');
  assert.match(RENDERER, /window\.addEventListener\(\s*['"]unhandledrejection['"]/,
    'renderer.js に window unhandledrejection リスナーが見つからない');
});

test('T9-B: renderer.js の window state ログが debounce 200ms で実装', () => {
  // setTimeout(..., 200) のパターン
  assert.match(RENDERER, /setTimeout\([\s\S]*?,\s*200\s*\)/,
    'renderer.js に 200ms debounce が見つからない');
  // focus / blur / resize の addEventListener
  assert.match(RENDERER, /addEventListener\(\s*['"]focus['"]/,
    'window focus リスナーが見つからない');
  assert.match(RENDERER, /addEventListener\(\s*['"]resize['"]/,
    'window resize リスナーが見つからない');
});

test('T9-C: audio.js _play 内に audio:play:enter / audio:play:exit:ok ログ呼出が存在', () => {
  // audio.js _play 関数本体を抽出（v2.0.4-rc15 で変更されたもの）
  const fnBody = extractFunctionBody(AUDIO, /function\s+_play\s*\([^)]*\)\s*\{/);
  assert.ok(fnBody, '_play 関数本体が見つからない');
  assert.match(fnBody, /audio:play:enter/, '_play 内に audio:play:enter ログが見つからない');
  assert.match(fnBody, /audio:play:exit:ok/, '_play 内に audio:play:exit:ok ログが見つからない');
  assert.match(fnBody, /audio:play:resumed/, '_play 内に audio:play:resumed ログが見つからない');
});

test('T10-A: index.html に「ログフォルダを開く」ボタン (id=js-open-logs-folder) が存在', () => {
  assert.match(HTML, /<button[^>]*id="js-open-logs-folder"[^>]*>\s*ログフォルダを開く\s*<\/button>/,
    'index.html に「ログフォルダを開く」ボタンが見つからない');
});

test('T10-B: renderer.js に js-open-logs-folder click ハンドラが登録', () => {
  // initialize 内の click ハンドラ登録ロジック
  assert.match(RENDERER, /js-open-logs-folder/,
    'renderer.js に js-open-logs-folder の参照が見つからない');
  assert.match(RENDERER, /window\.api\?\.log\?\.openFolder/,
    'renderer.js から window.api.log.openFolder が呼ばれていない');
});

test('T10-C: rolling ログにタイマー 1 秒 tick 系のログ呼出が含まれない（負荷主因の不要記録を回避）', () => {
  // renderer.js handleAudioOnTick 関数全体を抽出
  const fnBody = extractFunctionBody(RENDERER, /function\s+handleAudioOnTick\s*\([^)]*\)\s*\{/);
  assert.ok(fnBody, 'handleAudioOnTick 本体が見つからない');
  // handleAudioOnTick 内で window.api.log.write を直接呼ばないこと（負荷主因）
  assert.doesNotMatch(fnBody, /window\.api\?\.log\?\.write/,
    'handleAudioOnTick 内に rolling ログ呼出が混入（タイマー 1 秒 tick の負荷主因）');
});

// ============================================================
// タスク 3: H 行完全削除
// ============================================================

test('T11: index.html から H ショートカット行が完全削除', () => {
  assert.doesNotMatch(HTML, /<kbd>H<\/kbd>/,
    'index.html に H 行が残存（rc15 タスク 3 で削除予定）');
});

test('T12: docs/specs.md §7 から H 行が完全削除', () => {
  assert.doesNotMatch(SPECS, /\|\s*H\s*\|\s*手元\s*PC/,
    'docs/specs.md §7 に H 行が残存（rc15 タスク 3 で削除予定）');
});

test('T13: H キー機能本体（renderer.js の KeyH dispatch）は維持', () => {
  // dispatchClockShortcut の case 'KeyH' は無変更で維持
  assert.match(RENDERER, /case\s+['"]KeyH['"]/,
    'renderer.js から case "KeyH" が消失（H キー機能本体が破壊された、削除予定外）');
});

// ============================================================
// 致命バグ保護 5 件 cross-check（rc15 で影響なしを担保）
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

test('致命バグ保護 C.1.7: AudioContext suspend resume 経路が維持（rolling ログは観測のみ）', () => {
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
// rc10 / rc12 / rc13 確定 Fix の維持確認
// ============================================================

test('rc10 維持: _dualStateCache に specialStack キー存在', () => {
  const m = MAIN.match(/const\s+_dualStateCache\s*=\s*\{[\s\S]*?\};/);
  assert.ok(m);
  assert.match(m[0], /specialStack\s*:\s*null/, 'specialStack キー消失（rc10 Fix 1-A 破壊）');
});

test('rc10 維持: app.requestSingleInstanceLock 維持', () => {
  assert.match(MAIN, /app\.requestSingleInstanceLock\s*\(\s*\)/,
    'requestSingleInstanceLock 消失（rc10 Fix 3 破壊）');
});

// rc21 第 2 弾追従: onRoleChanged ハンドラに計測ラベル（インライン object literal 含む）追加に伴い、
//   非貪欲な `\}\s*\)` 早期マッチ問題を解消するため balanced brace 抽出 (extractFunctionBody) に切替。
test('rc12 維持: onRoleChanged 内で setAttribute("data-role") が window.appRole 代入より前', () => {
  const handler = extractFunctionBody(RENDERER, /onRoleChanged\?\.\(\s*\(newRole\)\s*=>\s*\{/);
  assert.ok(handler, 'onRoleChanged ハンドラ抽出失敗');
  const setAttrIdx = handler.search(/setAttribute\(\s*['"]data-role['"]/);
  const assignIdx  = handler.search(/window\.appRole\s*=\s*newRole/);
  assert.ok(setAttrIdx >= 0 && assignIdx >= 0);
  assert.ok(setAttrIdx < assignIdx,
    'rc12 真因根治の順序が逆転（setAttribute → window.appRole の順を維持必須）');
});

test('rc12 維持: window.appRole = newRole が try-catch で防御', () => {
  assert.match(RENDERER, /try\s*\{\s*window\.appRole\s*=\s*newRole\s*;?\s*\}\s*catch/,
    'window.appRole 代入の try-catch 防御が消失（rc12 真因根治破壊）');
});

test('rc13 維持: _handleTournamentDuplicateImpl 内で ensureEditorEditableState() 2 回以上呼ばれる', () => {
  const body = extractFunctionBody(RENDERER, /async\s+function\s+_handleTournamentDuplicateImpl\s*\(\s*\)\s*\{/);
  assert.ok(body, '_handleTournamentDuplicateImpl が見つからない');
  const calls = body.match(/ensureEditorEditableState\s*\(\s*\)/g) || [];
  assert.ok(calls.length >= 2,
    `_handleTournamentDuplicateImpl 内の ensureEditorEditableState 呼出が ${calls.length} 回（期待 >= 2、rc13 Fix 1 破壊）`);
});

// ============================================================
// version 同期確認（rc15）
// ============================================================

test('version: package.json は 2.0.6', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.6',
    `package.json version が ${pkg.version}（期待 2.0.6）`);
});

test('version: scripts.test に v204-rc15-break-end-and-rolling-log.test.js が含まれる', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /v204-rc15-break-end-and-rolling-log\.test\.js/,
    'package.json scripts.test に v204-rc15-break-end-and-rolling-log.test.js がない');
});

// ============================================================
console.log('');
console.log(`Summary: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
