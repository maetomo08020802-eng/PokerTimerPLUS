/**
 * v2.0.4-rc18 第 1 弾 — タスク 1+2 静的解析テスト
 *
 * 対象修正:
 *   タスク 1 (修正案 ⑥-A): hall 側 dual-sync handler の `kind === 'tournamentBasics'` 経路で
 *             blindPresetId 更新時に setStructure を呼び、renderCurrentLevel / renderNextLevel で即時再描画。
 *   タスク 2 (問題 ⑤): addNewEntry / cancelNewEntry / eliminatePlayer / revivePlayer /
 *             adjustReentry / adjustAddOn / resetTournamentRuntime の 7 関数末尾に
 *             updateOperatorPane(getState()) を追加（AC operator-pane の即時更新）。
 *
 * すべて try { ... } catch (_) {} で wrap、never throw。
 * 致命バグ保護 5 件（C.2.7-A / C.2.7-D / C.1-A2 / C.1.7 / C.1.8）への影響なしも cross-check。
 *
 * 実行: node tests/v204-rc18-structure-and-pane-sync.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT      = path.join(__dirname, '..');
const MAIN      = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const RENDERER  = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'renderer.js'), 'utf8');
const AUDIO     = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'audio.js'), 'utf8');

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
// タスク 1: hall 側 dual-sync handler に setStructure 追加（修正案 ⑥-A）
// ============================================================

test('T1: hall 側 dual-sync handler kind === "tournamentBasics" 経路で setStructure 呼出が存在', () => {
  // tournamentBasics 分岐内に setStructure 呼出が含まれる
  const re = /kind\s*===\s*['"]tournamentBasics['"][\s\S]*?setStructure\s*\(/;
  assert.match(RENDERER, re,
    'kind === "tournamentBasics" 経路で setStructure 呼出が見つからない（タスク 1 不在）');
});

test('T2: blindPresetId が空の場合 setStructure を呼ばない（null guard 確認）', () => {
  // typeof t.blindPresetId === 'string' && t.blindPresetId のガード条件式が存在
  const re = /if\s*\(\s*typeof\s+t\.blindPresetId\s*===\s*['"]string['"]\s*&&\s*t\.blindPresetId\s*\)/;
  assert.match(RENDERER, re,
    'blindPresetId の null/empty guard 条件式が見つからない（空 ID で setStructure 呼ばれるリスク）');
});

test('T3: setStructure 呼出周辺で renderCurrentLevel / renderNextLevel も呼ばれる（即時再描画）', () => {
  // setStructure(preset) 後に renderCurrentLevel / renderNextLevel が同一スコープで呼ばれる
  const re = /setStructure\s*\(\s*preset\s*\)[\s\S]{0,200}?renderCurrentLevel\s*\([\s\S]{0,200}?renderNextLevel\s*\(/;
  assert.match(RENDERER, re,
    'setStructure(preset) 後の renderCurrentLevel / renderNextLevel 連続呼出が見つからない（即時再描画なし）');
});

test('T4-bonus: タスク 1 の追加コードは try/catch で例外保護されている', () => {
  // setStructure 周辺で try { ... } catch (err) { ... } が含まれる（never throw）
  const re = /try\s*\{[\s\S]{0,500}?setStructure\s*\([\s\S]{0,500}?\}\s*catch\s*\(\s*err\s*\)/;
  assert.match(RENDERER, re,
    'setStructure 経路が try/catch でラップされていない（never throw 違反）');
});

// ============================================================
// タスク 2: 7 関数末尾に updateOperatorPane(getState()) 追加
// ============================================================

const targetFns = [
  'addNewEntry',
  'cancelNewEntry',
  'eliminatePlayer',
  'revivePlayer',
  'adjustReentry',
  'adjustAddOn',
  'resetTournamentRuntime',
];

test('T5: 7 関数すべてで updateOperatorPane(getState()) 呼出が存在', () => {
  for (const fnName of targetFns) {
    const body = extractFunctionBody(RENDERER, fnName);
    assert.match(body, /updateOperatorPane\s*\(\s*getState\s*\(\s*\)\s*\)/,
      `${fnName} 関数内に updateOperatorPane(getState()) 呼出が見つからない`);
  }
});

test('T6: 各 updateOperatorPane(getState()) 呼出は try { ... } catch (_) で wrap されている', () => {
  for (const fnName of targetFns) {
    const body = extractFunctionBody(RENDERER, fnName);
    // try { updateOperatorPane(getState()); } catch (_) { ... } の形で wrap
    const re = /try\s*\{\s*updateOperatorPane\s*\(\s*getState\s*\(\s*\)\s*\)\s*;\s*\}\s*catch\s*\(\s*_\s*\)/;
    assert.match(body, re,
      `${fnName} 内の updateOperatorPane(getState()) が try { ... } catch (_) で wrap されていない（never throw 違反）`);
  }
});

test('T7: schedulePersistRuntime() の呼出はそのまま維持（500ms debounce 経路に変更なし）', () => {
  // 6 関数（resetTournamentRuntime 除く 6 つ）で schedulePersistRuntime() が引き続き呼ばれている
  const debounceFns = ['addNewEntry', 'cancelNewEntry', 'eliminatePlayer', 'revivePlayer',
                       'adjustReentry', 'adjustAddOn', 'resetTournamentRuntime'];
  for (const fnName of debounceFns) {
    const body = extractFunctionBody(RENDERER, fnName);
    assert.match(body, /schedulePersistRuntime\s*\(\s*\)/,
      `${fnName} 内で schedulePersistRuntime() 呼出が消失（C.1.8 永続化経路破壊）`);
  }
});

test('T8: hall ロード時の各関数 early return は維持（hall でランタイム mutate 禁止）', () => {
  // window.appRole === 'hall' の早期 return ガードが消えていないこと
  // resetTournamentRuntime には hall ガードがない（handleReset 経由でのみ呼ばれる前提）
  const hallGuardFns = ['addNewEntry', 'cancelNewEntry', 'eliminatePlayer', 'revivePlayer',
                        'adjustReentry', 'adjustAddOn'];
  for (const fnName of hallGuardFns) {
    const body = extractFunctionBody(RENDERER, fnName);
    assert.match(body, /window\.appRole\s*===\s*['"]hall['"]/,
      `${fnName} の hall role early return ガードが消失（C.1.8 不変条件違反）`);
  }
});

// ============================================================
// 致命バグ保護 5 件 cross-check（rc18 タスク 1+2 で影響なしを担保）
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

test('致命バグ保護 C.1.8: tournaments:setRuntime IPC が維持', () => {
  assert.match(MAIN, /ipcMain\.handle\(\s*['"]tournaments:setRuntime['"]/,
    'tournaments:setRuntime ハンドラが消失（C.1.8 破壊）');
});

// ============================================================
// rc15/rc17 機構維持 cross-check（rc18 タスク 1+2 で破壊しない）
// ============================================================

test('rc17 維持: subscribe ガード PAUSED 中 remainingMs 変化条件式が維持', () => {
  const re = /state\.status\s*===\s*States\.PAUSED\s*&&\s*state\.remainingMs\s*!==\s*prev\.remainingMs/;
  assert.match(RENDERER, re,
    'rc17 で追加した PAUSED 中の remainingMs 変化トリガ条件式が消失');
});

test('rc17 維持: 3 ラベル rolling ログ（timer:state:send / timer:state:recv:hall / render:tick:hall）が維持', () => {
  assert.match(MAIN, /'timer:state:send'/, 'main.js の timer:state:send ラベル消失');
  const DUAL_SYNC = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'dual-sync.js'), 'utf8');
  assert.match(DUAL_SYNC, /'timer:state:recv:hall'/, 'dual-sync.js の timer:state:recv:hall ラベル消失');
  assert.match(RENDERER, /'render:tick:hall'/, 'renderer.js の render:tick:hall ラベル消失');
});

// ============================================================
console.log('');
console.log(`Summary: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
