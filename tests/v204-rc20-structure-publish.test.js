/**
 * v2.0.4-rc20 タスク 1+3 静的解析テスト（案 A、問題 ⑥ 根治）
 *
 * 対象修正:
 *   タスク 1（案 A）: presets:saveUser ハンドラ末尾で _publishDualState('structure', sanitized) 強制発火 +
 *                    hall dual-sync handler に kind === 'structure' case 追加。
 *                    前原さん判断 ① β / ② B / ③ c により、進行中レベルの残り時間には影響しない設計。
 *   タスク 3       : 配布版常時記録ラベル structure:state:send / structure:state:recv:hall 追加。
 *
 * 致命バグ保護 5 件 cross-check（rc20 で全件影響なしを担保）。
 *
 * 実行: node tests/v204-rc20-structure-publish.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.join(__dirname, '..');
const MAIN     = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const AUDIO    = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS:', name); pass++; }
  catch (err) { console.log('FAIL:', name, '\n  ', err.message); fail++; }
}

// ヘルパ: presets:saveUser ハンドラ全体を抽出（balanced brace 走査、`});` が handler 内 rollingLog に含まれる対策）
function extractPresetsSaveUserHandler() {
  const startRe = /ipcMain\.handle\(\s*['"]presets:saveUser['"]\s*,\s*\([^)]*\)\s*=>\s*\{/;
  const m = MAIN.match(startRe);
  if (!m) throw new Error('presets:saveUser ハンドラが見つからない');
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

// ヘルパ: dual-sync の structure 分岐を抽出
function extractDualSyncStructureBranch() {
  const m = RENDERER.match(/else\s+if\s*\(\s*kind\s*===\s*['"]structure['"][\s\S]*?\}\s*catch\s*\(\s*err\s*\)\s*\{[^}]*\}/);
  return m ? m[0] : null;
}

// ============================================================
// タスク 1: 案 A 実装（main.js + renderer.js）
// ============================================================

test('T1: main.js presets:saveUser ハンドラ内に _publishDualState("structure", sanitized) 呼出存在', () => {
  const handler = extractPresetsSaveUserHandler();
  assert.match(handler, /_publishDualState\(\s*['"]structure['"]\s*,\s*sanitized\s*\)/,
    'presets:saveUser ハンドラ内に _publishDualState("structure", sanitized) 呼出が見つからない（案 A 不在）');
});

test('T2: T1 呼出が activeT.blindPresetId === id ガード内', () => {
  const handler = extractPresetsSaveUserHandler();
  const re = /if\s*\(\s*activeT\s*&&\s*activeT\.blindPresetId\s*===\s*id\s*\)\s*\{[\s\S]*?_publishDualState\(\s*['"]structure['"]/;
  assert.match(handler, re,
    '_publishDualState("structure", ...) が activeT.blindPresetId === id ガード内に無い（過剰 broadcast リスク）');
});

test('T3: T1 呼出が try / catch で wrap', () => {
  const handler = extractPresetsSaveUserHandler();
  const re = /try\s*\{[\s\S]*?_publishDualState\(\s*['"]structure['"][\s\S]*?\}\s*catch\s*\(\s*_\s*\)/;
  assert.match(handler, re,
    '_publishDualState("structure", ...) が try/catch で wrap されていない（never throw 違反）');
});

test('T4: renderer.js dual-sync handler に kind === "structure" 分岐存在', () => {
  const branch = extractDualSyncStructureBranch();
  assert.ok(branch, 'renderer.js dual-sync handler に kind === "structure" 分岐が見つからない（案 A 受信側不在）');
});

test('T5: T4 分岐内に setStructure(value) 呼出存在', () => {
  const branch = extractDualSyncStructureBranch();
  assert.match(branch, /setStructure\s*\(\s*value\s*\)/,
    'kind === "structure" 分岐内に setStructure(value) 呼出が見つからない');
});

test('T6: T4 分岐内に renderCurrentLevel / renderNextLevel 呼出存在', () => {
  const branch = extractDualSyncStructureBranch();
  assert.match(branch, /renderCurrentLevel\s*\(/,
    'kind === "structure" 分岐内に renderCurrentLevel 呼出が見つからない');
  assert.match(branch, /renderNextLevel\s*\(/,
    'kind === "structure" 分岐内に renderNextLevel 呼出が見つからない');
});

test('T7: T4 分岐内に targetTime / startAtLevel / applyTimerStateToTimer の機能呼出が無い（③ c 厳守、進行中レベル不変）', () => {
  const branch = extractDualSyncStructureBranch();
  // コメント文中の単語マッチを避けるため、JS コメント (// と /* ... */) を削除した上で機能呼出パターンのみ検査
  const stripped = branch
    .replace(/\/\*[\s\S]*?\*\//g, '')      // /* ... */ 形式のブロックコメント削除
    .replace(/\/\/[^\n]*/g, '');           // // 形式の行コメント削除
  // 関数呼出（identifier + `(` ）または代入（identifier + `=`）をチェック
  assert.doesNotMatch(stripped, /(?:targetTime\s*=|startAtLevel\s*\(|applyTimerStateToTimer\s*\()/,
    'kind === "structure" 分岐内に targetTime 再計算系の機能呼出が混入（③ c 違反、進行中レベルに影響する）');
});

// ============================================================
// タスク 3: 新規ログラベル structure:state:send / recv:hall
// ============================================================

test('T8: main.js に rollingLog("structure:state:send", ...) 呼出存在 + try/catch wrap', () => {
  const handler = extractPresetsSaveUserHandler();
  assert.match(handler, /rollingLog\(\s*['"]structure:state:send['"]/,
    'main.js presets:saveUser に rollingLog("structure:state:send", ...) が見つからない');
  // try/catch wrap 確認（never throw from logging）
  const re = /try\s*\{\s*rollingLog\(\s*['"]structure:state:send['"][\s\S]*?\}\s*catch\s*\(\s*_\s*\)/;
  assert.match(handler, re,
    'rollingLog("structure:state:send", ...) が try/catch で wrap されていない（never throw 違反）');
});

test('T9: renderer.js dual-sync の structure 分岐に structure:state:recv:hall ラベル送信 + try/catch wrap', () => {
  const branch = extractDualSyncStructureBranch();
  assert.match(branch, /['"]structure:state:recv:hall['"]/,
    'kind === "structure" 分岐に structure:state:recv:hall ラベルが見つからない');
  // window.api?.log?.write?.('structure:state:recv:hall', ...) を try/catch で wrap
  const re = /try\s*\{\s*window\.api\?\.log\?\.write\?\.\(\s*['"]structure:state:recv:hall['"][\s\S]*?\}\s*catch\s*\(\s*_\s*\)/;
  assert.match(branch, re,
    'structure:state:recv:hall ログが try/catch で wrap されていない（never throw 違反）');
});

// ============================================================
// 致命バグ保護 5 件 cross-check（rc20 全タスクで影響なし確認）
// ============================================================

test('致命バグ保護 C.2.7-A: resetBlindProgressOnly が renderer.js に存在', () => {
  assert.match(RENDERER, /function\s+resetBlindProgressOnly\s*\(/,
    'resetBlindProgressOnly が消失（C.2.7-A 破壊）');
});

test('致命バグ保護 C.2.7-D: setDisplaySettings の timerState destructure 除外維持', () => {
  const m = MAIN.match(/ipcMain\.handle\(\s*['"]tournaments:setDisplaySettings['"][\s\S]*?\}\s*\)\s*;/);
  assert.ok(m, 'tournaments:setDisplaySettings IPC ハンドラが見つからない');
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

test('致命バグ保護 C.1.8: tournaments:setRuntime IPC が維持 + presets:saveUser に schedulePersistRuntime 不在', () => {
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]tournaments:setRuntime['"]/,
    'tournaments:setRuntime ハンドラが消失（C.1.8 破壊）');
  // presets:saveUser ハンドラに schedulePersistRuntime / runtime 永続化系の呼出が混入していないこと
  // （preset 保存と runtime 永続化の境界保護）
  const handler = extractPresetsSaveUserHandler();
  assert.doesNotMatch(handler, /schedulePersistRuntime|tournaments:setRuntime/,
    'presets:saveUser に runtime 永続化系の呼出が混入（C.1.8 境界曖昧化、preset と runtime は別 kind で隔離されるべき）');
});

// ============================================================
// rc18 第 1 弾投入済 7 ラベル維持 cross-check（rc20 で破壊なし）
// ============================================================

test('rc17/rc18 第 1 弾維持: 既存 7 ラベル（timer:state:send / runtime:state:send / blindPreset:state:send 等）が維持', () => {
  assert.match(MAIN, /'timer:state:send'/,    'timer:state:send 消失');
  assert.match(MAIN, /'runtime:state:send'/,  'runtime:state:send 消失');
  assert.match(MAIN, /'blindPreset:state:send'/, 'blindPreset:state:send 消失');
});

test('rc19 (c) 並存方針: tournamentBasics の structure 同梱 dead code は履歴保護のため残置', () => {
  // main.js 側に structure: validated.structure が残っている（rc19 並存）
  const m = MAIN.match(/_publishDualState\(\s*['"]tournamentBasics['"]\s*,[\s\S]*?structure\s*:\s*validated\.structure[\s\S]*?\}\s*\)/);
  assert.ok(m, 'rc19 で投入した tournamentBasics.structure: validated.structure 同梱が消失（(c) 並存方針違反、履歴保護要）');
});

// ============================================================
// version assertion（rc20）
// ============================================================

test('version: package.json は 2.0.4-rc23', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.4-rc23',
    `package.json version が ${pkg.version}（期待 2.0.4-rc23）`);
});

// ============================================================
console.log('');
console.log(`Summary: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
