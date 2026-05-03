/**
 * v2.0.4-rc19 タスク 3+4 静的解析テスト
 *
 * 対象修正:
 *   タスク 3（案 ⑦-A）: adjustSpecialStack 末尾に updateOperatorPane(getState()) を 1 行追加（PAUSED 中 Ctrl+E specialStack 同期漏れ修正）
 *                       schedulePersistRuntime() を絶対に追加しないこと（C.1.8 不変条件保護）
 *   タスク 4（案 3）  : applyTournament 内で tournamentState.title と同時に tournamentState.name にも同期代入
 *
 * 致命バグ保護 5 件 cross-check（rc19 で全件影響なしを担保）
 *
 * 実行: node tests/v204-rc19-special-stack-and-name.test.js
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

// ヘルパ: 関数本体（function FOO( ... ) { ... } の中身）を抽出
function extractFunctionBody(source, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = source.match(re);
  if (!m) throw new Error(`function ${name} が見つからない`);
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return source.slice(m.index, i);
}

// ============================================================
// タスク 3: adjustSpecialStack 末尾に updateOperatorPane 追加
// ============================================================

test('T8: adjustSpecialStack 関数内に updateOperatorPane(getState()) 呼出あり', () => {
  const body = extractFunctionBody(RENDERER, 'adjustSpecialStack');
  assert.match(body, /updateOperatorPane\s*\(\s*getState\s*\(\s*\)\s*\)/,
    'adjustSpecialStack 内に updateOperatorPane(getState()) 呼出が見つからない（案 ⑦-A 不在、問題 ⑦ 同期漏れ未修正）');
  // try { ... } catch (_) で wrap されていること
  assert.match(body, /try\s*\{\s*updateOperatorPane\s*\(\s*getState\s*\(\s*\)\s*\)\s*;\s*\}\s*catch\s*\(\s*_\s*\)/,
    'adjustSpecialStack 内の updateOperatorPane(getState()) が try { ... } catch (_) で wrap されていない（never throw 違反）');
});

test('T9: adjustSpecialStack 関数内に schedulePersistRuntime 呼出が無い（C.1.8 不変条件保護）', () => {
  const body = extractFunctionBody(RENDERER, 'adjustSpecialStack');
  assert.doesNotMatch(body, /schedulePersistRuntime\s*\(/,
    'adjustSpecialStack に schedulePersistRuntime 呼出が混入（C.1.8 runtime 永続化境界の曖昧化、specialStack は runtime 構造ではない）');
});

// ============================================================
// タスク 4: applyTournament で .name 同期代入
// ============================================================

test('T10: applyTournament 関数内で tournamentState.name 代入が tournamentState.title 代入と同箇所', () => {
  const body = extractFunctionBody(RENDERER, 'applyTournament');
  // typeof titleSrc === 'string' のガード内で title と name の両方に代入
  const re = /if\s*\(\s*typeof\s+titleSrc\s*===\s*['"]string['"]\s*\)\s*\{[\s\S]*?tournamentState\.title\s*=\s*titleSrc\s*;[\s\S]*?tournamentState\.name\s*=\s*titleSrc\s*;[\s\S]*?\}/;
  assert.match(body, re,
    'applyTournament 内で tournamentState.title と tournamentState.name の同期代入ブロックが見つからない（案 3 不在）');
});

test('T11: tournamentState の initial state 定義に title プロパティが維持されている（破壊的変更なし）', () => {
  // tournamentState = { ... title: '...' ... } の形を確認
  const re = /tournamentState\s*=\s*\{[\s\S]*?title\s*:\s*['"]/;
  assert.match(RENDERER, re,
    'tournamentState の initial state から title プロパティが消失（破壊的変更）');
});

// ============================================================
// 致命バグ保護 5 件 cross-check（rc19 全タスクで影響なし確認）
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

test('致命バグ保護 C.1.8: tournaments:setRuntime IPC が維持 + adjustSpecialStack に schedulePersistRuntime 不在', () => {
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]tournaments:setRuntime['"]/,
    'tournaments:setRuntime ハンドラが消失（C.1.8 破壊）');
  // adjustSpecialStack は specialStack を扱うが runtime 永続化対象外
  const body = extractFunctionBody(RENDERER, 'adjustSpecialStack');
  assert.doesNotMatch(body, /schedulePersistRuntime\s*\(/,
    'adjustSpecialStack に schedulePersistRuntime が混入（C.1.8 境界曖昧化）');
});

// ============================================================
// version assertion（rc19）
// ============================================================

test('version: package.json は 2.0.6', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.6',
    `package.json version が ${pkg.version}（期待 2.0.6）`);
});

// ============================================================
console.log('');
console.log(`Summary: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
